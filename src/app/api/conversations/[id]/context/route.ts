import { listCustomerAppointments } from "@/lib/appointments";
import { countMessages, getConversation, isUuid } from "@/lib/conversations";
import { getCustomer } from "@/lib/customers";
import { errorResponse } from "@/lib/http";
import { listNotes } from "@/lib/notes";
import type { Appointment, Customer, Note } from "@/lib/types";

export interface ConversationContext {
  /** Null on the few conversations that predate customer records */
  customer: Customer | null;
  upcoming: Appointment[];
  past: Appointment[];
  notes: Note[];
  messageCount: number;
}

/** Everything known about the person behind a conversation, for the panel beside the chat. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return errorResponse("Conversation not found", 404);

  try {
    const conversation = await getConversation(id);
    if (!conversation) return errorResponse("Conversation not found", 404);

    const messageCount = await countMessages(id);
    const customer = conversation.customer_id ? await getCustomer(conversation.customer_id) : null;
    if (!customer) {
      return Response.json({ customer: null, upcoming: [], past: [], notes: [], messageCount } satisfies ConversationContext);
    }

    const [appointments, notes] = await Promise.all([listCustomerAppointments(customer.id), listNotes(customer.id)]);
    const now = Date.now();
    const active = (appointment: Appointment) => appointment.status !== "cancelled";

    return Response.json({
      customer,
      upcoming: appointments
        .filter((appointment) => Date.parse(appointment.starts_at) >= now && active(appointment))
        .reverse(),
      past: appointments.filter((appointment) => Date.parse(appointment.starts_at) < now),
      notes,
      messageCount,
    } satisfies ConversationContext);
  } catch (error) {
    return errorResponse(error);
  }
}
