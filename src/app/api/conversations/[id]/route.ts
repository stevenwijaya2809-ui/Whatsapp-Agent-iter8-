import type { NextRequest } from "next/server";
import { isUuid, updateConversation } from "@/lib/conversations";
import { errorResponse } from "@/lib/http";
import type { Conversation } from "@/lib/types";

/** Updates a conversation. Body: `{ "mode": "agent" | "human" }` and/or `{ "read": true }`. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return errorResponse("Conversation not found", 404);

  const body = await request.json().catch(() => null);
  const changes: Partial<Pick<Conversation, "mode" | "last_read_at">> = {};

  if (body?.mode !== undefined) {
    if (body.mode !== "agent" && body.mode !== "human") {
      return errorResponse('mode must be "agent" or "human"', 400);
    }
    changes.mode = body.mode;
  }
  if (body?.read === true) changes.last_read_at = new Date().toISOString();

  if (Object.keys(changes).length === 0) {
    return errorResponse('Nothing to update: send "mode" and/or "read": true', 400);
  }

  try {
    const conversation = await updateConversation(id, changes);
    return conversation ? Response.json(conversation) : errorResponse("Conversation not found", 404);
  } catch (error) {
    return errorResponse(error);
  }
}
