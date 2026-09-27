import { getConversation, isUuid } from "@/lib/conversations";
import { errorResponse } from "@/lib/http";
import { addNote } from "@/lib/notes";

const MAX_NOTE_LENGTH = 2000;

/** Adds an operator's note about the customer behind this conversation: `{ "body": "..." }`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return errorResponse("Conversation not found", 404);

  const payload = await request.json().catch(() => null);
  const body = typeof payload?.body === "string" ? payload.body.trim() : "";
  if (!body) return errorResponse('Send the note as { "body": "..." }', 400);
  if (body.length > MAX_NOTE_LENGTH) return errorResponse(`A note can be at most ${MAX_NOTE_LENGTH} characters`, 400);

  try {
    const conversation = await getConversation(id);
    if (!conversation) return errorResponse("Conversation not found", 404);
    if (!conversation.customer_id) return errorResponse("This conversation has no customer record to note against", 409);

    return Response.json(await addNote({ customerId: conversation.customer_id, conversationId: id, body }));
  } catch (error) {
    return errorResponse(error);
  }
}
