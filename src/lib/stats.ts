import "server-only";
import { clinicDateKey, clinicDayStart, isAfterHours } from "@/lib/clinic";
import { getSupabase } from "@/lib/supabase";
import type { MessageRole, MessageSender } from "@/lib/types";

/** Plenty for a clinic; keeps one bad query from pulling the whole table. */
const MAX_ROWS = 10_000;

export interface DailyCount {
  /** YYYY-MM-DD in the clinic's timezone */
  date: string;
  messages: number;
}

export interface DashboardStats {
  days: number;
  /** Conversations with at least one message in the period */
  conversations: number;
  customerMessages: number;
  aiReplies: number;
  humanReplies: number;
  /** Conversations the AI handled without a human sending anything */
  handledByAiOnly: number;
  /** Customer messages that arrived while the clinic was closed */
  afterHours: number;
  /** Median minutes from a customer's first message in a burst to the next reply */
  medianReplyMinutes: number | null;
  /** Conversations whose latest message is still from the customer */
  awaitingReply: number;
  /** Customer messages per day, oldest first */
  daily: DailyCount[];
}

interface Row {
  conversation_id: string;
  role: MessageRole;
  sent_by: MessageSender | null;
  created_at: string;
}

export async function getDashboardStats(days: number): Promise<DashboardStats> {
  // Whole clinic days, so the totals and the daily columns cover the same period
  const start = clinicDayStart(days - 1);
  const { data, error } = await getSupabase()
    .from("messages")
    .select("conversation_id, role, sent_by, created_at")
    .gte("created_at", start.toISOString())
    .order("created_at", { ascending: true })
    .limit(MAX_ROWS);
  if (error) throw new Error(`Failed to load statistics: ${error.message}`);

  return summarise(data as Row[], days, start);
}

function summarise(rows: Row[], days: number, start: Date): DashboardStats {
  const byConversation = new Map<string, Row[]>();
  for (const row of rows) {
    const existing = byConversation.get(row.conversation_id);
    if (existing) existing.push(row);
    else byConversation.set(row.conversation_id, [row]);
  }

  const stats: DashboardStats = {
    days,
    conversations: byConversation.size,
    customerMessages: 0,
    aiReplies: 0,
    humanReplies: 0,
    handledByAiOnly: 0,
    afterHours: 0,
    medianReplyMinutes: null,
    awaitingReply: 0,
    daily: emptyDays(days, start),
  };
  const perDay = new Map(stats.daily.map((day) => [day.date, day]));
  const replyDelays: number[] = [];

  for (const messages of byConversation.values()) {
    let humanReplied = false;
    let aiReplied = false;

    for (const [i, message] of messages.entries()) {
      if (message.role === "user") {
        stats.customerMessages++;
        const sentAt = new Date(message.created_at);
        if (isAfterHours(sentAt)) stats.afterHours++;
        const day = perDay.get(clinicDateKey(sentAt));
        if (day) day.messages++;

        // Only the first message of a burst starts the clock
        if (i === 0 || messages[i - 1].role !== "user") {
          const reply = messages.slice(i + 1).find((m) => m.role === "assistant");
          if (reply) {
            replyDelays.push((Date.parse(reply.created_at) - Date.parse(message.created_at)) / 60_000);
          }
        }
        continue;
      }

      if (message.sent_by === "human") {
        stats.humanReplies++;
        humanReplied = true;
      } else {
        stats.aiReplies++;
        aiReplied = true;
      }
    }

    if (aiReplied && !humanReplied) stats.handledByAiOnly++;
    if (messages[messages.length - 1].role === "user") stats.awaitingReply++;
  }

  stats.medianReplyMinutes = median(replyDelays);
  return stats;
}

/** One bucket per day of the period, oldest first, so quiet days still show. */
function emptyDays(days: number, start: Date): DailyCount[] {
  const buckets: DailyCount[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < days; i++) {
    const date = clinicDateKey(new Date(start.getTime() + i * 86_400_000));
    if (seen.has(date)) continue;
    seen.add(date);
    buckets.push({ date, messages: 0 });
  }
  return buckets;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10) / 10;
}
