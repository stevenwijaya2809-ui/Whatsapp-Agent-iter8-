import { describe, expect, it } from "vitest";
import {
  countByFilter,
  filterConversations,
  INBOX_FILTERS,
  sortConversations,
  waitingFor,
} from "@/lib/inbox";
import type { ConversationWithLastMessage, LastMessage } from "@/lib/types";

const at = (minutesAgo: number) => new Date(Date.UTC(2026, 8, 27, 12, 0) - minutesAgo * 60_000).toISOString();

const message = (role: "user" | "assistant", minutesAgo: number, sentBy: "ai" | "human" | null = null): LastMessage => ({
  role,
  sent_by: sentBy,
  content: "Halo",
  created_at: at(minutesAgo),
});

const conversation = (overrides: Partial<ConversationWithLastMessage> = {}): ConversationWithLastMessage =>
  ({
    id: "con-1",
    phone: "6285110525118",
    name: "Dewi",
    mode: "agent",
    intent: null,
    sentiment: null,
    urgency: "normal",
    needs_human: false,
    draft_reply: null,
    customer_status: "ACTIVE_CUSTOMER",
    updated_at: at(10),
    last_message: message("assistant", 10, "ai"),
    ...overrides,
  }) as ConversationWithLastMessage;

describe("inbox filters", () => {
  const list = [
    conversation({ id: "answered" }),
    conversation({ id: "escalated", needs_human: true, last_message: message("assistant", 5, "ai") }),
    conversation({ id: "asked", last_message: message("user", 3) }),
    conversation({ id: "booking", intent: "BOOKING" }),
    conversation({ id: "cancelling", intent: "CANCELLATION" }),
    conversation({ id: "complaint", intent: "COMPLAINT", sentiment: "negative" }),
    conversation({ id: "unhappy", intent: "PRICE", sentiment: "negative" }),
    conversation({ id: "lead", customer_status: "LEAD" }),
    conversation({ id: "draft", draft_reply: "Shall I book you in?" }),
  ];

  const ids = (filter: Parameters<typeof filterConversations>[1]) =>
    filterConversations(list, filter).map((conversation) => conversation.id);

  it("shows everything by default", () => {
    expect(ids("all")).toHaveLength(list.length);
  });

  it("finds the conversations a person has to deal with", () => {
    expect(ids("needs_person")).toEqual(["escalated"]);
  });

  it("counts only an unanswered customer as waiting on us", () => {
    // Matches the results page's "Awaiting your reply", so the two numbers can be compared
    expect(ids("waiting")).toEqual(["asked"]);
  });

  it("keeps replies that only need approving in their own queue", () => {
    expect(ids("drafts")).toEqual(["draft"]);
  });

  it("groups the appointment intents together", () => {
    expect(ids("bookings")).toEqual(["booking", "cancelling"]);
  });

  it("catches unhappiness as well as explicit complaints", () => {
    expect(ids("complaints")).toEqual(["complaint", "unhappy"]);
  });

  it("separates people who have not booked yet", () => {
    expect(ids("leads")).toEqual(["lead"]);
  });

  it("counts a conversation as AI handled only when nothing is outstanding", () => {
    const handled = ids("ai_handled");
    expect(handled).toContain("answered");
    expect(handled).not.toContain("escalated");
    expect(handled).not.toContain("draft");
    expect(handled).not.toContain("asked");
  });

  it("searches names, numbers and the last message", () => {
    const people = [
      conversation({ id: "a", name: "Dewi Lestari", phone: "628111", last_message: message("user", 1) }),
      conversation({ id: "b", name: "Budi", phone: "628222", last_message: { ...message("user", 1), content: "Berapa biaya scaling?" } }),
    ];
    expect(filterConversations(people, "all", "dewi").map((c) => c.id)).toEqual(["a"]);
    expect(filterConversations(people, "all", "628222").map((c) => c.id)).toEqual(["b"]);
    expect(filterConversations(people, "all", "scaling").map((c) => c.id)).toEqual(["b"]);
    expect(filterConversations(people, "all", "  ")).toHaveLength(2);
    expect(filterConversations(people, "all", "nothing here")).toHaveLength(0);
  });

  it("applies the search within the chosen filter", () => {
    expect(filterConversations(list, "complaints", "Halo").map((c) => c.id)).toEqual(["complaint", "unhappy"]);
    expect(filterConversations(list, "needs_person", "Budi")).toHaveLength(0);
  });

  it("counts what each filter would show", () => {
    const counts = countByFilter(list);
    expect(counts.all).toBe(list.length);
    expect(counts.needs_person).toBe(1);
    expect(counts.complaints).toBe(2);
    // Every filter is counted, so none can be missing from the interface
    expect(Object.keys(counts).sort()).toEqual(INBOX_FILTERS.map((filter) => filter.id).sort());
  });
});

describe("inbox sorting", () => {
  it("puts the most recent activity first", () => {
    const list = [
      conversation({ id: "old", last_message: message("user", 60) }),
      conversation({ id: "new", last_message: message("user", 1) }),
    ];
    expect(sortConversations(list, "recent").map((c) => c.id)).toEqual(["new", "old"]);
  });

  it("puts the longest unanswered customer first, and sinks the ones nobody owes a reply", () => {
    const list = [
      conversation({ id: "answered", last_message: message("assistant", 2, "ai") }),
      conversation({ id: "waiting-20m", last_message: message("user", 20) }),
      conversation({ id: "waiting-2h", last_message: message("user", 120) }),
    ];
    expect(sortConversations(list, "waiting").map((c) => c.id)).toEqual(["waiting-2h", "waiting-20m", "answered"]);
  });

  it("puts hand-overs above urgent messages, then unhappy, then the rest", () => {
    const list = [
      conversation({ id: "ordinary" }),
      conversation({ id: "quiet", urgency: "low" }),
      conversation({ id: "unhappy", sentiment: "negative" }),
      conversation({ id: "urgent", urgency: "high" }),
      conversation({ id: "escalated", needs_human: true }),
    ];
    expect(sortConversations(list, "urgency").map((c) => c.id)).toEqual([
      "escalated",
      "urgent",
      "unhappy",
      "ordinary",
      "quiet",
    ]);
  });

  it("leaves the caller's array alone", () => {
    const list = [conversation({ id: "a", last_message: message("user", 1) }), conversation({ id: "b", last_message: message("user", 90) })];
    sortConversations(list, "waiting");
    expect(list.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("waitingFor", () => {
  it("measures how long the customer has been waiting", () => {
    const now = Date.parse(at(0));
    expect(waitingFor(conversation({ last_message: message("user", 45) }), now)).toBe(45 * 60_000);
  });

  it("is nothing when the customer is not waiting", () => {
    expect(waitingFor(conversation({ last_message: message("assistant", 45, "ai") }))).toBeNull();
    expect(waitingFor(conversation({ last_message: null }))).toBeNull();
  });
});
