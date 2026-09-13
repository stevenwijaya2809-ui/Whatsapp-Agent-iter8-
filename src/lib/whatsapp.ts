import "server-only";
import { requireEnv } from "@/lib/env";
import { splitMessage } from "@/lib/whatsapp-text";

const GRAPH_API_URL = "https://graph.facebook.com/v22.0";

/**
 * Sends a text message, split into several messages if it exceeds WhatsApp's length limit.
 * Returns the WhatsApp ID of the first message sent. Throws if the API rejects the message.
 */
export async function sendWhatsAppMessage(to: string, text: string): Promise<string | null> {
  let firstId: string | null = null;
  for (const chunk of splitMessage(text)) {
    const id = await sendText(to, chunk);
    firstId ??= id;
  }
  return firstId;
}

async function sendText(to: string, body: string): Promise<string | null> {
  const res = await fetch(`${GRAPH_API_URL}/${requireEnv("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("WHATSAPP_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = data?.error;
    const detail = error?.error_data?.details ?? error?.message ?? `HTTP ${res.status}`;
    throw new Error(`WhatsApp API error${error?.code ? ` ${error.code}` : ""}: ${detail}`);
  }
  return data?.messages?.[0]?.id ?? null;
}
