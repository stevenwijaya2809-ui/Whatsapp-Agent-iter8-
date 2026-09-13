import "server-only";
import { getSupabase } from "@/lib/supabase";
import type {
  Conversation,
  ConversationWithLastMessage,
  LastMessage,
  Message,
  MessageRole,
  MessageSender,
} from "@/lib/types";

/** Postgres unique_violation, raised when Meta redelivers a message that is already stored. */
const UNIQUE_VIOLATION = "23505";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** All conversations, most recently active first, each with its latest message. */
export async function listConversations(): Promise<ConversationWithLastMessage[]> {
  const { data, error } = await getSupabase()
    .from("conversations")
    .select("*, messages(content, role, created_at)")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { referencedTable: "messages", ascending: false })
    .limit(1, { referencedTable: "messages" });
  if (error) throw new Error(`Failed to load conversations: ${error.message}`);

  return data.map(({ messages, ...conversation }) => ({
    ...(conversation as Conversation),
    last_message: (messages as LastMessage[])[0] ?? null,
  }));
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const { data, error } = await getSupabase().from("conversations").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Failed to load conversation: ${error.message}`);
  return data;
}

/** Returns the conversation for a phone number, creating it on first contact and keeping the name current. */
export async function upsertConversation(phone: string, name: string | null): Promise<Conversation> {
  const { data, error } = await getSupabase()
    .from("conversations")
    .upsert(name ? { phone, name } : { phone }, { onConflict: "phone" })
    .select()
    .single();
  if (error) throw new Error(`Failed to save conversation: ${error.message}`);
  return data;
}

/** Applies changes to a conversation. Returns null if it doesn't exist. */
export async function updateConversation(
  id: string,
  changes: Partial<Pick<Conversation, "mode" | "last_read_at">>
): Promise<Conversation | null> {
  const { data, error } = await getSupabase()
    .from("conversations")
    .update(changes)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Failed to update conversation: ${error.message}`);
  return data;
}

/** The latest messages of a conversation, returned oldest first. */
export async function getRecentMessages(conversationId: string, limit: number): Promise<Message[]> {
  const { data, error } = await getSupabase()
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load messages: ${error.message}`);
  return data.reverse();
}

interface NewMessage {
  conversationId: string;
  role: MessageRole;
  content: string;
  sentBy?: MessageSender;
  whatsappMsgId?: string | null;
}

/**
 * Stores a message and moves its conversation to the top of the list.
 * Returns null when the WhatsApp message ID is already stored (a webhook redelivery).
 */
export async function saveMessage({
  conversationId,
  role,
  content,
  sentBy,
  whatsappMsgId,
}: NewMessage): Promise<Message | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role,
      content,
      whatsapp_msg_id: whatsappMsgId ?? null,
      ...(sentBy && { sent_by: sentBy }),
    })
    .select()
    .single();
  if (error?.code === UNIQUE_VIOLATION) return null;
  if (error) throw new Error(`Failed to save message: ${error.message}`);

  const { error: touchError } = await supabase
    .from("conversations")
    .update({ updated_at: data.created_at })
    .eq("id", conversationId);
  if (touchError) console.error("Failed to update conversation timestamp:", touchError.message);

  return data;
}
