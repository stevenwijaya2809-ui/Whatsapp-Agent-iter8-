/**
 * End-to-end check of hand-over: an ordinary question is answered by the assistant, a complaint
 * is handed to a person with a written briefing, and the dashboard can close it again.
 *
 * Runs in draft mode, so nothing reaches WhatsApp. Test data is removed afterwards.
 *
 *   npm run dev -- -p 3100
 *   node scripts/e2e/escalation.mjs [baseUrl]
 */
import crypto from "node:crypto";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });

const BASE = process.argv[2] ?? "http://localhost:3100";
const PHONE = "15550006666";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

async function send(text) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: {
      contacts: [{ profile: { name: "Escalation Test" }, wa_id: PHONE }],
      messages: [{ from: PHONE, id: `wamid.esc.${Date.now()}`, timestamp: "1", type: "text", text: { body: text } }],
    } }] }],
  });
  const headers = { "Content-Type": "application/json" };
  if (process.env.WHATSAPP_APP_SECRET) {
    headers["X-Hub-Signature-256"] = "sha256=" + crypto.createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(body).digest("hex");
  }
  return (await fetch(`${BASE}/api/webhook`, { method: "POST", headers, body })).status;
}

const conversation = async () => (await admin.from("conversations").select("*").eq("phone", PHONE).maybeSingle()).data;

async function waitForDraft(previous) {
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const current = await conversation();
    if (current?.draft_reply && current.draft_reply !== previous) return current;
  }
  return null;
}

/** A signed-in session, so the test can use the dashboard's own API. Null when auth is off. */
async function signIn() {
  if (!process.env.DASHBOARD_PASSWORD) return null;
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.DASHBOARD_PASSWORD }),
  });
  if (!response.ok) throw new Error(`Could not sign in: ${response.status}`);
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
}

async function cleanup() {
  await admin.from("conversations").delete().eq("phone", PHONE);
  await admin.from("customers").delete().eq("phone", PHONE);
}

async function main() {
  for (let i = 0; i < 90; i++) {
    try { await fetch(`${BASE}/api/webhook`); break; } catch { await sleep(1000); }
  }
  await cleanup();
  await admin.from("conversations").insert({ phone: PHONE, name: "Escalation Test", mode: "draft" });

  // An ordinary question the assistant can answer must not pull in a person
  check("Ordinary question accepted", (await send("Jam berapa klinik buka hari Senin?")) === 200);
  const answered = await waitForDraft(null);
  check("Ordinary question answered", Boolean(answered), (answered?.draft_reply ?? "none after 90s").slice(0, 100));
  if (!answered) return;
  check("No hand-over for an ordinary question", answered.needs_human === false, answered.escalation_reason ?? "");

  // A complaint must always reach a person
  check("Complaint accepted", (await send("Saya sudah menunggu dua minggu dan tidak ada yang menghubungi saya. Pelayanan ini sangat buruk!")) === 200);
  const escalated = await waitForDraft(answered.draft_reply);
  check("Complaint answered", Boolean(escalated), (escalated?.draft_reply ?? "none after 90s").slice(0, 100));
  if (!escalated) return;

  check("Handed to a person", escalated.needs_human === true, escalated.escalation_reason ?? "no reason recorded");
  check("Hand-over is timestamped", Boolean(escalated.escalated_at), escalated.escalated_at ?? "");
  check("The operator's own mode is untouched", escalated.mode === "draft", escalated.mode);

  const summary = escalated.escalation_summary ?? "";
  check("A briefing was written", summary.length > 0);
  check("The briefing names the customer", summary.includes("Escalation Test") && summary.includes(PHONE));
  check("The briefing gives the reason", summary.includes("Reason:"), summary.split("\n")[1] ?? "");
  check("The briefing quotes the conversation", summary.includes("Last messages:"));
  check("The briefing states the appointment position", summary.includes("Appointments: none upcoming"));
  console.log(`  briefing:\n${summary.split("\n").map((line) => `    ${line}`).join("\n")}`);

  // The dashboard can close the hand-over again
  const cookie = await signIn();
  const response = await fetch(`${BASE}/api/conversations/${escalated.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ resolve: true }),
  });
  check("Marking it handled is accepted", response.status === 200, `status ${response.status}`);

  const resolved = await conversation();
  check("The hand-over is closed", resolved?.needs_human === false);
  check("Closing it is timestamped", Boolean(resolved?.resolved_at), resolved?.resolved_at ?? "");
  check("The record of what happened is kept", Boolean(resolved?.escalation_summary));
}

main()
  .catch((error) => { failed++; console.log("ERROR", error.stack); })
  .finally(async () => {
    await cleanup();
    console.log(failed ? `\n${failed} FAILED` : "\nEscalation and hand-over verified");
    process.exitCode = failed ? 1 : 0;
  });
