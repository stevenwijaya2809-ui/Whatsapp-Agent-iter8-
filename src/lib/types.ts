export type ConversationMode = "agent" | "human";

export type MessageRole = "user" | "assistant";

/** Who wrote an assistant message: the AI agent or a human from the dashboard. */
export type MessageSender = "ai" | "human";

export interface Conversation {
  id: string;
  phone: string;
  name: string | null;
  mode: ConversationMode;
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
  created_at: string;
}

export type LastMessage = Pick<Message, "content" | "role" | "created_at">;

export interface ConversationWithLastMessage extends Conversation {
  last_message: LastMessage | null;
}
