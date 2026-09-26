import { after, type NextRequest } from "next/server";
import { generateReply } from "@/lib/ai";
import { getCustomer } from "@/lib/customers";
import {
  getConversation,
  getRecentMessages,
  saveDraft,
  saveMessage,
  updateMessageStatus,
  upsertConversation,
} from "@/lib/conversations";
import { parseStatusUpdates, parseWebhookPayload, verifySignature, type WebhookPayload } from "@/lib/webhook";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { toWhatsAppFormat } from "@/lib/whatsapp-text";

// Time allowed for the AI reply that runs after the response is sent (see `after` below)
export const maxDuration = 60;

/** How many recent messages the model gets as context */
const HISTORY_LIMIT = 20;

const FALLBACK_REPLY = "Sorry, I couldn't generate a response.";

/** Webhook verification: Meta calls this when the callback URL is saved in the App Dashboard. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (verifyToken && params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === verifyToken) {
    return new Response(params.get("hub.challenge"), { headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = Buffer.from(await request.arrayBuffer());

  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (appSecret && !verifySignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: WebhookPayload | null;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Store messages before acknowledging, so a storage failure makes Meta redeliver instead of
  // losing the message. saveMessage skips redeliveries of messages that were already stored.
  const needsReply = new Map<string, string>(); // conversation ID -> phone number
  let storeFailed = false;
  for (const message of parseWebhookPayload(payload, process.env.WHATSAPP_PHONE_NUMBER_ID)) {
    try {
      const conversation = await upsertConversation(message.from, message.name);
      const saved = await saveMessage({
        conversationId: conversation.id,
        role: "user",
        content: message.text,
        whatsappMsgId: message.id,
      });
      if (saved && conversation.mode !== "human") needsReply.set(conversation.id, conversation.phone);
    } catch (error) {
      console.error("[webhook] Failed to store incoming message:", error);
      storeFailed = true;
      break;
    }
  }

  // Delivery reports and AI replies run after the response, so Meta gets its 200 well
  // within its 5 second timeout. One reply per conversation covers every message stored above.
  const statusUpdates = parseStatusUpdates(payload);
  if (statusUpdates.length > 0 || needsReply.size > 0) {
    after(async () => {
      for (const update of statusUpdates) {
        try {
          await updateMessageStatus(update.messageId, update.status, update.detail);
        } catch (error) {
          console.error("[webhook] Failed to record delivery status:", error);
        }
      }
      for (const [conversationId, phone] of needsReply) {
        await prepareReply(conversationId, phone);
      }
    });
  }

  if (storeFailed) return new Response("Failed to store message", { status: 500 });
  return Response.json({ status: "ok" });
}

/** Writes the AI's reply, then either sends it (agent mode) or leaves it for approval (draft mode). */
async function prepareReply(conversationId: string, phone: string) {
  try {
    const [history, conversation] = await Promise.all([
      getRecentMessages(conversationId, HISTORY_LIMIT),
      getConversation(conversationId),
    ]);
    const customer = conversation?.customer_id ? await getCustomer(conversation.customer_id) : null;

    const completion = await generateReply({
      history: history.map(({ role, content }) => ({ role, content })),
      customer,
    });
    const reply = toWhatsAppFormat(completion.text) || FALLBACK_REPLY;
    if (completion.knowledgeMiss) {
      console.warn(`[webhook] No knowledge matched the question in conversation ${conversationId}`);
    }

    // The operator may have changed the mode while the model was generating
    const current = await getConversation(conversationId);
    if (current?.mode === "draft") {
      await saveDraft(conversationId, reply);
      return;
    }
    if (current?.mode !== "agent") return;

    const whatsappMsgId = await sendWhatsAppMessage(phone, reply);
    await saveMessage({
      conversationId,
      role: "assistant",
      sentBy: "ai",
      content: reply,
      whatsappMsgId,
      status: "sent",
    });
  } catch (error) {
    console.error(`[webhook] Failed to prepare AI reply for conversation ${conversationId}:`, error);
  }
}
