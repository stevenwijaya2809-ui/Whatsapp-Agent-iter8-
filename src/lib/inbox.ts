import type { ConversationWithLastMessage } from "@/lib/types";

/** Intents that mean the customer is trying to arrange an appointment. */
const BOOKING_INTENTS = new Set(["BOOKING", "RESCHEDULE", "CANCELLATION"]);

const LEAD_STATUSES = new Set(["NEW", "LEAD", "QUALIFIED"]);

export type InboxFilterId =
  | "all"
  | "needs_person"
  | "waiting"
  | "drafts"
  | "bookings"
  | "complaints"
  | "leads"
  | "ai_handled";

export interface InboxFilter {
  id: InboxFilterId;
  label: string;
  /** What the filter means, shown on hover */
  hint: string;
  matches(conversation: ConversationWithLastMessage): boolean;
}

/** The questions an operator actually asks of an inbox, in the order they tend to ask them. */
export const INBOX_FILTERS: InboxFilter[] = [
  { id: "all", label: "All", hint: "Every conversation", matches: () => true },
  {
    id: "needs_person",
    label: "Needs a person",
    hint: "The assistant handed these over and nobody has closed them yet",
    matches: (conversation) => conversation.needs_human,
  },
  {
    // Excludes the hand-overs above, so a conversation is never work in two places at once.
    // Catches the assistant failing silently, where nothing is flagged and nobody notices.
    id: "waiting",
    label: "Unanswered",
    hint: "Nobody has replied to the customer's last message, and it has not been handed over",
    matches: (conversation) => conversation.last_message?.role === "user" && !conversation.needs_human,
  },
  {
    id: "drafts",
    label: "Drafts to approve",
    hint: "The assistant has written a reply that is waiting for your approval",
    matches: (conversation) => Boolean(conversation.draft_reply),
  },
  {
    id: "bookings",
    label: "Bookings",
    hint: "Booking, rescheduling or cancelling an appointment",
    matches: (conversation) => Boolean(conversation.intent && BOOKING_INTENTS.has(conversation.intent)),
  },
  {
    id: "complaints",
    label: "Complaints",
    hint: "A complaint, or an unhappy customer",
    matches: (conversation) => conversation.intent === "COMPLAINT" || conversation.sentiment === "negative",
  },
  {
    id: "leads",
    label: "New leads",
    hint: "People who have not booked yet",
    matches: (conversation) => Boolean(conversation.customer_status && LEAD_STATUSES.has(conversation.customer_status)),
  },
  {
    id: "ai_handled",
    label: "AI handled",
    hint: "The assistant answered last and nobody was needed",
    matches: (conversation) =>
      conversation.last_message?.sent_by === "ai" && !conversation.needs_human && !conversation.draft_reply,
  },
];

export type InboxSortId = "recent" | "waiting" | "urgency";

export interface InboxSort {
  id: InboxSortId;
  label: string;
  /** For the toolbar button, where the full label would crowd out the filter beside it */
  short: string;
  compare(a: ConversationWithLastMessage, b: ConversationWithLastMessage): number;
}

export const INBOX_SORTS: InboxSort[] = [
  { id: "recent", label: "Most recent", short: "Recent", compare: (a, b) => lastActivity(b) - lastActivity(a) },
  {
    id: "waiting",
    label: "Longest waiting",
    short: "Waiting",
    // Conversations nobody owes a reply to have waited no time at all, so they sink
    compare: (a, b) => waitingSince(a) - waitingSince(b) || lastActivity(b) - lastActivity(a),
  },
  {
    id: "urgency",
    label: "Most urgent",
    short: "Urgent",
    compare: (a, b) => urgencyRank(a) - urgencyRank(b) || lastActivity(b) - lastActivity(a),
  },
];

/** Conversations matching a filter and a search of names, numbers and the last message. */
export function filterConversations(
  conversations: ConversationWithLastMessage[],
  filterId: InboxFilterId,
  search = ""
): ConversationWithLastMessage[] {
  const filter = INBOX_FILTERS.find((candidate) => candidate.id === filterId) ?? INBOX_FILTERS[0];
  const term = search.trim().toLowerCase();

  return conversations.filter((conversation) => {
    if (!filter.matches(conversation)) return false;
    if (!term) return true;
    return [conversation.name, conversation.phone, conversation.last_message?.content].some((field) =>
      field?.toLowerCase().includes(term)
    );
  });
}

export function sortConversations(
  conversations: ConversationWithLastMessage[],
  sortId: InboxSortId
): ConversationWithLastMessage[] {
  const sort = INBOX_SORTS.find((candidate) => candidate.id === sortId) ?? INBOX_SORTS[0];
  return [...conversations].sort(sort.compare);
}

/** How many conversations each filter would show, for the counts on the filter buttons. */
export function countByFilter(conversations: ConversationWithLastMessage[]): Record<InboxFilterId, number> {
  const counts = {} as Record<InboxFilterId, number>;
  for (const filter of INBOX_FILTERS) {
    counts[filter.id] = conversations.reduce((total, conversation) => total + (filter.matches(conversation) ? 1 : 0), 0);
  }
  return counts;
}

/** How long the customer has been waiting for an answer, in milliseconds. */
export function waitingFor(conversation: ConversationWithLastMessage, now = Date.now()): number | null {
  const since = waitingSince(conversation);
  return Number.isFinite(since) ? now - since : null;
}

function lastActivity(conversation: ConversationWithLastMessage): number {
  return Date.parse(conversation.last_message?.created_at ?? conversation.updated_at);
}

function waitingSince(conversation: ConversationWithLastMessage): number {
  const last = conversation.last_message;
  return last?.role === "user" ? Date.parse(last.created_at) : Number.POSITIVE_INFINITY;
}

function urgencyRank(conversation: ConversationWithLastMessage): number {
  if (conversation.needs_human) return 0;
  if (conversation.urgency === "high") return 1;
  if (conversation.sentiment === "negative") return 2;
  if (conversation.urgency === "low") return 4;
  return 3;
}
