export type ConversationMode = "agent" | "draft" | "human";

export type MessageRole = "user" | "assistant";

/** Who wrote an assistant message: the AI agent or a human from the dashboard. */
export type MessageSender = "ai" | "human";

/** Delivery state Meta reports for a message we sent. */
export type MessageStatus = "sent" | "delivered" | "read" | "failed";

export type CustomerStatus =
  | "NEW"
  | "LEAD"
  | "QUALIFIED"
  | "BOOKED"
  | "ACTIVE_CUSTOMER"
  | "RETURNING_CUSTOMER"
  | "INACTIVE";

export type LeadStatus = "NEW" | "CONTACTED" | "QUALIFIED" | "CONVERTED" | "LOST";

/** What the customer is trying to do, detected per message. */
export type Intent =
  | "BOOKING"
  | "RESCHEDULE"
  | "CANCELLATION"
  | "SERVICE_INFORMATION"
  | "PRICE"
  | "LOCATION"
  | "OPERATING_HOURS"
  | "PAYMENT"
  | "COMPLAINT"
  | "FOLLOW_UP"
  | "PROMOTION"
  | "GENERAL_QUESTION"
  | "HUMAN_REQUEST"
  | "UNKNOWN";

export type Sentiment = "positive" | "neutral" | "negative";
export type Urgency = "low" | "normal" | "high";

export interface Customer {
  id: string;
  organization_id: string;
  phone: string;
  name: string | null;
  status: CustomerStatus;
  lead_status: LeadStatus | null;
  tags: string[];
  preferences: Record<string, unknown>;
  ai_summary: string | null;
  first_contact_at: string;
  last_interaction_at: string | null;
  conversation_count: number;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  organization_id: string | null;
  customer_id: string | null;
  phone: string;
  name: string | null;
  mode: ConversationMode;
  /** Reply the AI prepared in draft mode, waiting for approval */
  draft_reply: string | null;
  draft_created_at: string | null;
  last_read_at: string | null;
  intent: Intent | null;
  sub_intent: string | null;
  sentiment: Sentiment | null;
  urgency: Urgency | null;
  ai_confidence: number | null;
  needs_human: boolean;
  escalation_reason: string | null;
  escalation_summary: string | null;
  escalated_at: string | null;
  resolved_at: string | null;
  updated_at: string;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  sent_by: MessageSender | null;
  content: string;
  whatsapp_msg_id: string | null;
  status: MessageStatus | null;
  /** Why a failed message failed */
  status_detail: string | null;
  status_updated_at: string | null;
  created_at: string;
}

export type LastMessage = Pick<Message, "content" | "role" | "sent_by" | "created_at">;

export interface ConversationWithLastMessage extends Conversation {
  last_message: LastMessage | null;
  /** From the linked customer record, for filtering the inbox */
  customer_status: CustomerStatus | null;
}

export interface Note {
  id: string;
  customer_id: string;
  conversation_id: string | null;
  author: "human" | "ai";
  body: string;
  created_at: string;
}

export interface Appointment {
  id: string;
  customer_id: string;
  conversation_id: string | null;
  service: string;
  starts_at: string;
  ends_at: string;
  status: "requested" | "booked" | "rescheduled" | "cancelled" | "completed" | "no_show";
  created_by: "ai" | "human";
  notes: string | null;
  created_at: string;
}
