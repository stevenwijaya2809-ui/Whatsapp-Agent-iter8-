/**
 * End-to-end check that the AI answers from the knowledge base rather than a hardcoded prompt.
 *
 * Sends a webhook message to a locally running app, in draft mode so nothing reaches WhatsApp,
 * and asserts the drafted reply used the seeded business facts. Test data is removed afterwards.
 *
 *   npm run dev -- -p 3100
 *   node scripts/e2e/knowledge-reply.mjs [baseUrl]
 */
import crypto from "node:crypto";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });

const BASE = process.argv[2] ?? "http://localhost:3100";
const PHONE = "15550009876";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

async function postWebhook(text) {
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              contacts: [{ profile: { name: "KB Test" }, wa_id: PHONE }],
              messages: [{ from: PHONE, id: `wamid.kb.${Date.now()}`, timestamp: "1", type: "text", text: { body: text } }],
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
  const res = await fetch(`${BASE}/api/webhook`, { method: "POST", headers, body });
  return res.status;
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

  // Draft mode: the AI writes a reply but nothing is sent to WhatsApp
  await admin.from("conversations").insert({ phone: PHONE, name: "KB Test", mode: "draft" });
  check("Webhook accepted the question", (await postWebhook("Halo, jam buka klinik hari Sabtu?")) === 200);

  let conversation = null;
  for (let i = 0; i < 60 && !conversation?.draft_reply; i++) {
    await sleep(1000);
    ({ data: conversation } = await admin.from("conversations").select("*").eq("phone", PHONE).maybeSingle());
  }
  check("AI produced a reply", Boolean(conversation?.draft_reply), (conversation?.draft_reply ?? "none after 60s").slice(0, 120));
  if (!conversation?.draft_reply) return;

  const reply = conversation.draft_reply.toLowerCase();
  check("Reply used the seeded Saturday hours", /9|13|1\s?pm|siang/.test(reply), conversation.draft_reply.slice(0, 120));
  check("Reply is in the customer's language", /jam|buka|sabtu|kami/.test(reply), "expected Indonesian");
  check("Reply did not leak the prompt scaffolding", !/business knowledge|## /i.test(reply));

  // The customer record is created and linked by the same webhook
  const { data: customer } = await admin.from("customers").select("*").eq("phone", PHONE).maybeSingle();
  check("Customer record created", Boolean(customer), customer ? `status ${customer.status}` : "missing");
  check("Conversation linked to the customer", conversation.customer_id === customer?.id);
  check("Conversation carries the organization", Boolean(conversation.organization_id));
}

main()
  .catch((error) => {
    failed++;
    console.log("ERROR", error.stack);
  })
  .finally(async () => {
    await cleanup();
    console.log(failed ? `\n${failed} FAILED` : "\nKnowledge-based reply verified");
    process.exitCode = failed ? 1 : 0;
  });
