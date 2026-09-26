import "server-only";
import type { ReplyAnalysis } from "@/lib/ai/analysis";
import { ensureCustomer } from "@/lib/customers";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organization";
import { notifyDashboard } from "@/lib/realtime";
import { getSupabase } from "@/lib/supabase";
import type {
  Conversation,
  ConversationWithLastMessage,
  LastMessage,
  Message,
  MessageRole,
  MessageSender,
  MessageStatus,
} from "@/lib/types";

/** Postgres unique_violation, raised when Meta redelivers a message that is already stored. */
const UNIQUE_VIOLATION = "23505";

/** Delivery reports can arrive out of order, so a message never moves backwards. */
const STATUS_RANK: Record<MessageStatus, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

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

/**
 * Returns the conversation for a phone number, creating it on first contact, keeping the
 * name current, and making sure it is attached to a customer record.
 */
export async function upsertConversation(phone: string, name: string | null): Promise<Conversation> {
  const customer = await ensureCustomer(phone, name);
  const { data, error } = await getSupabase()
    .from("conversations")
    .upsert(
      {
        phone,
        ...(name ? { name } : {}),
        organization_id: DEFAULT_ORGANIZATION_ID,
        customer_id: customer.id,
      },
      { onConflict: "phone" }
    )
    .select()
    .single();
  if (error) throw new Error(`Failed to save conversation: ${error.message}`);
  return data;
}

type ConversationChanges = Partial<Pick<Conversation, "mode" | "last_read_at" | "draft_reply" | "draft_created_at">>;

/** Applies changes to a conversation. Returns null if it doesn't exist. */
export async function updateConversation(id: string, changes: ConversationChanges): Promise<Conversation | null> {
  const { data, error } = await getSupabase()
    .from("conversations")
    .update(changes)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Failed to update conversation: ${error.message}`);

  // Marking as read is not worth a ping, and pinging on it would make dashboards loop
  if (data && (changes.mode !== undefined || changes.draft_reply !== undefined)) await notifyDashboard(id);
  return data;
}

/** Stores the reply the AI prepared in draft mode, for a human to approve. */
export async function saveDraft(conversationId: string, reply: string): Promise<void> {
  const { error } = await getSupabase()
    .from("conversations")
    .update({ draft_reply: reply, draft_created_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) throw new Error(`Failed to save draft: ${error.message}`);
  await notifyDashboard(conversationId);
}

/** Clears a pending draft once it has been sent, replaced or discarded. */
export async function clearDraft(conversationId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("conversations")
    .update({ draft_reply: null, draft_created_at: null })
    .eq("id", conversationId);
  if (error) console.error("Failed to clear draft:", error.message);
}

/**
 * Applies one of Meta's delivery reports to the message it refers to, ignoring reports
 * that would move a message backwards. Returns the conversation it belongs to, or null
 * when nothing was updated.
 */
export async function updateMessageStatus(
  whatsappMsgId: string,
  status: MessageStatus,
  detail: string | null
): Promise<string | null> {
  const earlier = Object.keys(STATUS_RANK).filter((s) => STATUS_RANK[s as MessageStatus] < STATUS_RANK[status]);
  let query = getSupabase()
    .from("messages")
    .update({ status, status_detail: detail, status_updated_at: new Date().toISOString() })
    .eq("whatsapp_msg_id", whatsappMsgId);
  query = earlier.length ? query.or(`status.is.null,status.in.(${earlier.join(",")})`) : query.is("status", null);

  const { data, error } = await query.select("conversation_id").maybeSingle();
  if (error) throw new Error(`Failed to update message status: ${error.message}`);
  if (!data) return null;

  await notifyDashboard(data.conversation_id);
  return data.conversation_id;
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
  status?: MessageStatus;
}

/**
 * Stores a message, moves its conversation to the top of the list, and tells open
 * dashboards to reload it. Returns null when the WhatsApp message ID is already
 * stored (a webhook redelivery).
 */
export async function saveMessage({
  conversationId,
  role,
  content,
  sentBy,
  whatsappMsgId,
  status,
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
      ...(status && { status, status_updated_at: new Date().toISOString() }),
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

  await notifyDashboard(conversationId);
  return data;
}

/**
 * Records what the model understood: the conversation keeps the latest reading for the inbox,
 * and each analysed message keeps its own for quality reporting. A hand-over flag is only ever
 * raised here, never cleared, so an operator stays in control once involved.
 */
export async function applyAnalysis(
  conversationId: string,
  messageId: string | null,
  analysis: ReplyAnalysis
): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase
    .from("conversations")
    .update({
      intent: analysis.intent,
      sub_intent: analysis.subIntent,
      sentiment: analysis.sentiment,
      urgency: analysis.urgency,
      ai_confidence: analysis.confidence,
      ...(analysis.needsHuman
        ? {
            needs_human: true,
            escalation_reason: analysis.escalationReason ?? "The assistant asked for a person",
            escalated_at: new Date().toISOString(),
          }
        : {}),
    })
    .eq("id", conversationId);
  if (error) console.error("Failed to record conversation analysis:", error.message);

  if (!messageId) return;
  const { error: analysisError } = await supabase.from("message_analysis").upsert(
    {
      message_id: messageId,
      intent: analysis.intent,
      sub_intent: analysis.subIntent,
      sentiment: analysis.sentiment,
      urgency: analysis.urgency,
      confidence: analysis.confidence,
    },
    { onConflict: "message_id" }
  );
  if (analysisError) console.error("Failed to record message analysis:", analysisError.message);
}
