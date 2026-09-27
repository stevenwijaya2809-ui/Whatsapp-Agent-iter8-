/**
 * End-to-end check of the customer panel's API: what it reads beside a conversation, and the
 * three things an operator can change from there.
 *
 *   npm run dev -- -p 3100
 *   node scripts/e2e/customer-context.mjs [baseUrl]
 */
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true, { info() {}, error: console.error });

const BASE = process.argv[2] ?? "http://localhost:3100";
const PHONE = "15550007777";
const ORGANIZATION = "00000000-0000-0000-0000-000000000001";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

let cookie = "";
async function call(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}), ...options.headers },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function signIn() {
  if (!process.env.DASHBOARD_PASSWORD) return;
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.DASHBOARD_PASSWORD }),
  });
  if (!response.ok) throw new Error(`Could not sign in: ${response.status}`);
  cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}

async function cleanup() {
  const { data: customer } = await admin.from("customers").select("id").eq("phone", PHONE).maybeSingle();
  if (customer) {
    await admin.from("appointments").delete().eq("customer_id", customer.id);
    await admin.from("notes").delete().eq("customer_id", customer.id);
  }
  await admin.from("conversations").delete().eq("phone", PHONE);
  await admin.from("customers").delete().eq("phone", PHONE);
}

async function main() {
  for (let i = 0; i < 90; i++) {
    try { await fetch(`${BASE}/api/webhook`); break; } catch { await sleep(1000); }
  }
  await signIn();
  await cleanup();

  const { data: customer } = await admin
    .from("customers")
    .insert({ organization_id: ORGANIZATION, phone: PHONE, name: "Context Test", status: "NEW" })
    .select()
    .single();
  const { data: conversation } = await admin
    .from("conversations")
    .insert({ phone: PHONE, name: "Context Test", mode: "human", organization_id: ORGANIZATION, customer_id: customer.id })
    .select()
    .single();
  await admin.from("messages").insert([
    { conversation_id: conversation.id, role: "user", content: "Halo" },
    { conversation_id: conversation.id, role: "assistant", sent_by: "ai", content: "Halo, ada yang bisa dibantu?" },
  ]);

  const soon = new Date(Date.now() + 3 * 86_400_000);
  const later = new Date(soon.getTime() + 45 * 60_000);
  const past = new Date(Date.now() - 30 * 86_400_000);
  await admin.from("appointments").insert([
    { organization_id: ORGANIZATION, customer_id: customer.id, conversation_id: conversation.id, service: "cleaning", starts_at: soon.toISOString(), ends_at: later.toISOString(), status: "booked", created_by: "ai" },
    { organization_id: ORGANIZATION, customer_id: customer.id, service: "check-up", starts_at: past.toISOString(), ends_at: new Date(past.getTime() + 1_800_000).toISOString(), status: "completed", created_by: "human" },
  ]);

  const context = await call(`/api/conversations/${conversation.id}/context`);
  check("Context loads", context.status === 200, `status ${context.status}`);
  check("It knows the customer", context.body?.customer?.phone === PHONE, context.body?.customer?.status ?? "");
  check("It counts the messages", context.body?.messageCount === 2, String(context.body?.messageCount));
  check("It separates upcoming from past", context.body?.upcoming?.length === 1 && context.body?.past?.length === 1,
    `${context.body?.upcoming?.length} upcoming, ${context.body?.past?.length} past`);
  check("The upcoming one is the booking", context.body?.upcoming?.[0]?.service === "cleaning");
  check("There are no notes yet", context.body?.notes?.length === 0);

  const note = await call(`/api/conversations/${conversation.id}/notes`, {
    method: "POST",
    body: JSON.stringify({ body: "Prefers appointments after 17:00." }),
  });
  check("A note can be added", note.status === 200, `status ${note.status}`);
  check("An empty note is refused", (await call(`/api/conversations/${conversation.id}/notes`, { method: "POST", body: JSON.stringify({ body: "  " }) })).status === 400);

  const status = await call(`/api/customers/${customer.id}`, { method: "PATCH", body: JSON.stringify({ status: "QUALIFIED", tag: "evenings" }) });
  check("Status and tag can be set together", status.status === 200, `status ${status.status}`);
  check("An unknown status is refused", (await call(`/api/customers/${customer.id}`, { method: "PATCH", body: JSON.stringify({ status: "VIP" }) })).status === 400);

  const after = await call(`/api/conversations/${conversation.id}/context`);
  check("The note is there", after.body?.notes?.[0]?.body === "Prefers appointments after 17:00.", after.body?.notes?.[0]?.body ?? "none");
  check("The note is attributed to a person", after.body?.notes?.[0]?.author === "human");
  check("The status stuck", after.body?.customer?.status === "QUALIFIED", after.body?.customer?.status ?? "");
  check("The tag stuck", after.body?.customer?.tags?.includes("evenings"), JSON.stringify(after.body?.customer?.tags ?? []));

  const missing = await call("/api/conversations/00000000-0000-0000-0000-0000000000ff/context");
  check("An unknown conversation is a 404", missing.status === 404, `status ${missing.status}`);
}

main()
  .catch((error) => { failed++; console.log("ERROR", error.stack); })
  .finally(async () => {
    await cleanup();
    console.log(failed ? `\n${failed} FAILED` : "\nCustomer context verified");
    process.exitCode = failed ? 1 : 0;
  });
