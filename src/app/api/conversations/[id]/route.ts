import type { NextRequest } from "next/server";
import { isUuid, updateConversation } from "@/lib/conversations";
import { errorResponse } from "@/lib/http";
import type { Conversation } from "@/lib/types";

const MODES = ["agent", "draft", "human"];

/** Updates a conversation: `{ "mode": ... }`, `{ "read": true }` and/or `{ "discardDraft": true }`. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return errorResponse("Conversation not found", 404);

  const body = await request.json().catch(() => null);
  const changes: Partial<Pick<Conversation, "mode" | "last_read_at" | "draft_reply" | "draft_created_at">> = {};

  if (body?.mode !== undefined) {
    if (!MODES.includes(body.mode)) {
      return errorResponse(`mode must be one of: ${MODES.join(", ")}`, 400);
    }
    changes.mode = body.mode;
  }
  if (body?.read === true) changes.last_read_at = new Date().toISOString();
  if (body?.discardDraft === true) {
    changes.draft_reply = null;
    changes.draft_created_at = null;
  }

  if (Object.keys(changes).length === 0) {
    return errorResponse('Nothing to update: send "mode", "read": true and/or "discardDraft": true', 400);
  }

  try {
    const conversation = await updateConversation(id, changes);
    return conversation ? Response.json(conversation) : errorResponse("Conversation not found", 404);
  } catch (error) {
    return errorResponse(error);
  }
}
