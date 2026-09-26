export type ConversationMode = "agent" | "draft" | "human";

export type MessageRole = "user" | "assistant";

/** Who wrote an assistant message: the AI agent or a human from the dashboard. */
export type MessageSender = "ai" | "human";

/** Delivery state Meta reports for a message we sent. */
export type MessageStatus = "sent" | "delivered" | "read" | "failed";

export interface Conversation {
  id: string;
  phone: string;
  name: string | null;
  mode: ConversationMode;
  /** Reply the AI prepared in draft mode, waiting for approval */
  draft_reply: string | null;
  draft_created_at: string | null;
  last_read_at: string | null;
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

export type LastMessage = Pick<Message, "content" | "role" | "created_at">;

export interface ConversationWithLastMessage extends Conversation {
  last_message: LastMessage | null;
}
