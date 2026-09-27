import "server-only";
import { getUpcomingAppointments } from "@/lib/appointments";
import type { ReplyAnalysis } from "@/lib/ai/analysis";
import { buildHandoffSummary, decideEscalation, type EscalationDecision } from "@/lib/ai/escalation";
import { escalateConversation } from "@/lib/conversations";
import type { Organization } from "@/lib/organization";
import type { Conversation, Customer, Message } from "@/lib/types";

export interface HandoffCheck {
  organization: Organization;
  /** As loaded before this turn's analysis was applied, so it still holds the previous confidence */
  conversation: Conversation;
  customer: Customer | null;
  analysis: ReplyAnalysis | null;
  knowledgeMiss: boolean;
  toolFailed: boolean;
  handedOff: boolean;
  /** What the assistant told its hand-over tool, when it used one */
  handoffReason: string | null;
  /** The conversation so far, oldest first */
  history: Pick<Message, "role" | "sent_by" | "content">[];
  /** The reply about to be sent, which the operator should see in the briefing */
  reply: string;
}

/**
 * Decides whether this turn needs a person and, if so, records the reason and a briefing.
 * Returns the decision so the caller can stop the assistant *after* the reply has gone out —
 * a customer who asks for a human should still be told one is coming.
 *
 * Never throws: a hand-over that cannot be recorded must not cost the customer their reply.
 */
export async function escalateIfNeeded(check: HandoffCheck): Promise<EscalationDecision | null> {
  const { organization, conversation, customer, analysis, history, reply } = check;

  const decision = decideEscalation({
    analysis,
    knowledgeMiss: check.knowledgeMiss,
    toolFailed: check.toolFailed,
    handedOff: check.handedOff,
    handoffReason: check.handoffReason,
    previousConfidence: conversation.ai_confidence,
    settings: organization.ai,
  });
  if (!decision) return null;

  try {
    const appointments = customer ? await getUpcomingAppointments(customer.id) : [];
    const summary = buildHandoffSummary({
      customerName: customer?.name ?? conversation.name,
      phone: conversation.phone,
      customerStatus: customer?.status ?? "NEW",
      intent: analysis?.intent ?? conversation.intent,
      confidence: analysis?.confidence ?? null,
      reason: decision.reason,
      recentMessages: [
        ...history.map((message) => ({ role: message.role, sentBy: message.sent_by, content: message.content })),
        { role: "assistant", sentBy: "ai", content: reply },
      ],
      appointments: appointments.map((appointment) => ({
        service: appointment.service,
        when: localTime(new Date(appointment.starts_at), organization.timezone),
        status: appointment.status,
      })),
    });
    await escalateConversation(conversation.id, decision.reason, summary);
  } catch (error) {
    console.error(`[handoff] Failed to record the hand-over for conversation ${conversation.id}:`, error);
  }

  return decision;
}

function localTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
