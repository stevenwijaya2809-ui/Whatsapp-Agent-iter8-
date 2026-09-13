import type { NextRequest } from "next/server";
import { getRecentMessages, isUuid } from "@/lib/conversations";
import { errorResponse } from "@/lib/http";

/** How many of a conversation's latest messages the dashboard loads */
const MESSAGE_LIMIT = 500;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return errorResponse("Conversation not found", 404);

  try {
    return Response.json(await getRecentMessages(id, MESSAGE_LIMIT));
  } catch (error) {
    return errorResponse(error);
  }
}
