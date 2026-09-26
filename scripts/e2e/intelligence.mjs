/**
 * End-to-end check that every reply also produces usable metadata, and that the JSON
 * contract never leaks to the customer.
 *
 * Runs in draft mode, so nothing is sent to WhatsApp. Test data is removed afterwards.
 *
 *   npm run dev -- -p 3100
 *   node scripts/e2e/intelligence.mjs [baseUrl]
 */
import crypto from "node:crypto";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });

const BASE = process.argv[2] ?? "http://localhost:3100";
const PHONE = "15550004321";
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
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              contacts: [{ profile: { name: "Intel Test" }, wa_id: PHONE }],
              messages: [{ from: PHONE, id: `wamid.intel.${Date.now()}`, timestamp: "1", type: "text", text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
  const headers = { "Content-Type": "application/json" };
  if (process.env.WHATSAPP_APP_SECRET) {
    headers["X-Hub-Signature-256"] =
      "sha256=" + crypto.createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(body).digest("hex");
  }
  return (await fetch(`${BASE}/api/webhook`, { method: "POST", headers, body })).status;
}

const conversation = async () => (await admin.from("conversations").select("*").eq("phone", PHONE).maybeSingle()).data;

/** Waits for the background reply to land, returning the conversation once a new draft appears. */
async function waitForDraft(previousDraft) {
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const current = await conversation();
    if (current?.draft_reply && current.draft_reply !== previousDraft) return current;
  }
  return null;
}

const cleanup = async () => {
  await admin.from("conversations").delete().eq("phone", PHONE);
  await admin.from("customers").delete().eq("phone", PHONE);
};

async function main() {
  for (let i = 0; i < 90; i++) {
    try {
      await fetch(`${BASE}/api/webhook`);
      break;
    } catch {
      await sleep(1000);
    }
  }
  await cleanup();
  await admin.from("conversations").insert({ phone: PHONE, name: "Intel Test", mode: "draft" });

  check("Booking question accepted", (await send("Saya mau booking pembersihan karang gigi hari Jumat sore")) === 200);
  const booking = await waitForDraft(null);
  check("Reply produced", Boolean(booking?.draft_reply), (booking?.draft_reply ?? "none after 60s").slice(0, 100));
  if (!booking) return;

  check(
    "Customer never sees the JSON contract",
    !/^\s*[{[]/.test(booking.draft_reply) && !/"reply"\s*:|needs_human|sub_intent/i.test(booking.draft_reply),
    booking.draft_reply.slice(0, 100)
  );
  check("Intent detected", booking.intent === "BOOKING", `intent ${booking.intent}`);
  check("Confidence recorded", typeof booking.ai_confidence === "number" && booking.ai_confidence > 0, `${booking.ai_confidence}`);
  check("Sentiment and urgency recorded", Boolean(booking.sentiment) && Boolean(booking.urgency), `${booking.sentiment}/${booking.urgency}`);

  const { data: analysed } = await admin
    .from("message_analysis")
    .select("intent, confidence, message_id, messages!inner(conversation_id)")
    .eq("messages.conversation_id", booking.id);
  check("Message analysis stored for reporting", (analysed ?? []).length === 1, `${(analysed ?? []).length} row(s)`);

  check("Hand-over request accepted", (await send("Tolong hubungkan saya dengan staf manusia")) === 200);
  const handover = await waitForDraft(booking.draft_reply);
  check("Second reply produced", Boolean(handover), handover?.draft_reply?.slice(0, 80) ?? "none");
  if (handover) {
    check("Conversation flagged for a person", handover.needs_human === true, `needs_human ${handover.needs_human}`);
    check("Hand-over reason recorded", Boolean(handover.escalation_reason), handover.escalation_reason ?? "missing");
  }
}

main()
  .catch((error) => {
    failed++;
    console.log("ERROR", error.stack);
  })
  .finally(async () => {
    await cleanup();
    console.log(failed ? `\n${failed} FAILED` : "\nConversation intelligence verified");
    process.exitCode = failed ? 1 : 0;
  });
