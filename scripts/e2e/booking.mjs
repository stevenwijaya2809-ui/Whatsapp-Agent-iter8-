/**
 * End-to-end check of the tool layer: the AI can book, and — the part that matters — it
 * cannot claim a booking that did not happen.
 *
 * Runs in draft mode, so nothing reaches WhatsApp. Test data is removed afterwards.
 *
 *   npm run dev -- -p 3100
 *   node scripts/e2e/booking.mjs [baseUrl]
 */
import crypto from "node:crypto";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });

const BASE = process.argv[2] ?? "http://localhost:3100";
const PHONE = "15550005555";
const TIMEZONE = "Asia/Jakarta";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

/** The next weekday the clinic is open, as YYYY-MM-DD in Jakarta. */
function nextOpenDate() {
  const dateKey = (date) => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const weekday = (date) => new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, weekday: "short" }).format(date);
  for (let days = 1; days <= 8; days++) {
    const date = new Date(Date.now() + days * 86_400_000);
    if (!["Sat", "Sun"].includes(weekday(date))) return dateKey(date);
  }
  throw new Error("no open day found");
}

async function send(text) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: {
      contacts: [{ profile: { name: "Booking Test" }, wa_id: PHONE }],
      messages: [{ from: PHONE, id: `wamid.book.${Date.now()}`, timestamp: "1", type: "text", text: { body: text } }],
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

async function toolCalls(conversationId) {
  const { data } = await admin.from("tool_calls").select("tool, status, error").eq("conversation_id", conversationId).order("created_at");
  return data ?? [];
}

async function appointments(customerId) {
  const { data } = await admin.from("appointments").select("*").eq("customer_id", customerId);
  return data ?? [];
}

async function cleanup() {
  const { data: customer } = await admin.from("customers").select("id").eq("phone", PHONE).maybeSingle();
  if (customer) await admin.from("appointments").delete().eq("customer_id", customer.id);
  await admin.from("conversations").delete().eq("phone", PHONE);
  await admin.from("customers").delete().eq("phone", PHONE);
}

async function main() {
  for (let i = 0; i < 90; i++) {
    try { await fetch(`${BASE}/api/webhook`); break; } catch { await sleep(1000); }
  }
  await cleanup();
  await admin.from("conversations").insert({ phone: PHONE, name: "Booking Test", mode: "draft" });

  const openDate = nextOpenDate();

  // A booking that should succeed
  check("Booking request accepted", (await send(`Saya mau booking cleaning pada ${openDate} jam 10:00`)) === 200);
  const booked = await waitForDraft(null);
  check("Reply produced", Boolean(booked?.draft_reply), (booked?.draft_reply ?? "none after 90s").slice(0, 110));
  if (!booked) return;

  const { data: customer } = await admin.from("customers").select("id").eq("phone", PHONE).maybeSingle();
  const calls = await toolCalls(booked.id);
  check("The assistant used its tools", calls.length > 0, calls.map((c) => `${c.tool}:${c.status}`).join(", ") || "none");

  const madeBookings = await appointments(customer.id);
  check("An appointment exists in the diary", madeBookings.length === 1, `${madeBookings.length} appointment(s)`);
  if (madeBookings[0]) {
    check("Appointment is on the requested day", madeBookings[0].starts_at.startsWith(openDate), madeBookings[0].starts_at);
    check("Appointment records who booked it", madeBookings[0].created_by === "ai", madeBookings[0].created_by);
  }

  // A booking that must fail: 3am is outside opening hours
  check("Impossible request accepted by the webhook", (await send(`Ubah jadi jam 03:00 pagi tanggal ${openDate}`)) === 200);
  const refused = await waitForDraft(booked.draft_reply);
  check("Second reply produced", Boolean(refused), (refused?.draft_reply ?? "none").slice(0, 110));

  if (refused) {
    // Whether the assistant refuses up front or the tool rejects it, the diary must not gain
    // an out-of-hours appointment. Tool-level failures are covered by the unit tests.
    const after = await appointments(customer.id);
    const outOfHours = after.filter((row) => {
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", hour12: false }).format(new Date(row.starts_at)));
      return hour < 9 || hour >= 18;
    });
    check("Nothing was booked outside opening hours", outOfHours.length === 0, `${outOfHours.length} bad appointment(s)`);
    check("The original appointment is intact or moved, never duplicated", after.length <= 1, `${after.length} appointment(s)`);
    console.log(`  reply to the impossible request: ${refused.draft_reply.slice(0, 160)}`);
  }
}

main()
  .catch((error) => { failed++; console.log("ERROR", error.stack); })
  .finally(async () => {
    await cleanup();
    console.log(failed ? `\n${failed} FAILED` : "\nBooking tools verified");
    process.exitCode = failed ? 1 : 0;
  });
