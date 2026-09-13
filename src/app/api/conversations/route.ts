import { listConversations } from "@/lib/conversations";
import { errorResponse } from "@/lib/http";

export async function GET() {
  try {
    return Response.json(await listConversations());
  } catch (error) {
    return errorResponse(error);
  }
}
