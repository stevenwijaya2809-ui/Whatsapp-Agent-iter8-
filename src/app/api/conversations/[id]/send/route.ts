import type { NextRequest } from "next/server";
import { getConversation, isUuid, saveMessage } from "@/lib/conversations";
import { errorResponse } from "@/lib/http";
import type { Conversation } from "@/lib/types";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

/** Sends a manual reply from the dashboard to the customer on WhatsApp, then stores it. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return errorResponse("Conversation not found", 404);

  const body = await request.json().catch(() => null);
  const text = typeof body?.message === "string" ? body.message.trim() : "";
  if (!text) return errorResponse("Message is required", 400);

  let conversation: Conversation | null;
  try {
    conversation = await getConversation(id);
  } catch (error) {
    return errorResponse(error);
  }
  if (!conversation) return errorResponse("Conversation not found", 404);

  let whatsappMsgId: string | null;
  try {
    whatsappMsgId = await sendWhatsAppMessage(conversation.phone, text);
  } catch (error) {
    return errorResponse(error, 502);
  }

  try {
    const message = await saveMessage({
      conversationId: id,
      role: "assistant",
      sentBy: "human",
      content: text,
      whatsappMsgId,
    });
    return Response.json(message);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return errorResponse(`Message was delivered on WhatsApp, but saving it failed: ${detail}`);
  }
}
