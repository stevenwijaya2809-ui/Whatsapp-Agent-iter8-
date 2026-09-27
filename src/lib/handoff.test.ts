import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Organization } from "@/lib/organization";
import type { Conversation, Customer } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  getUpcomingAppointments: vi.fn(),
  escalateConversation: vi.fn(),
}));

vi.mock("@/lib/appointments", () => ({ getUpcomingAppointments: mocks.getUpcomingAppointments }));
vi.mock("@/lib/conversations", () => ({ escalateConversation: mocks.escalateConversation }));

const { escalateIfNeeded } = await import("@/lib/handoff");

const organization: Organization = {
  id: "org-1",
  name: "Senyum Dental Studio",
  timezone: "Asia/Jakarta",
  business: { name: "Senyum Dental Studio" },
  ai: { confidenceThreshold: 0.6 },
};

const conversation = (overrides: Partial<Conversation> = {}): Conversation =>
  ({
    id: "con-1",
    phone: "6285110525118",
    name: "Dewi",
    intent: "BOOKING",
    ai_confidence: 0.8,
    ...overrides,
  }) as Conversation;

const customer = { id: "cus-1", name: "Dewi", status: "RETURNING_CUSTOMER" } as Customer;

const check = (overrides: Record<string, unknown> = {}) => ({
  organization,
  conversation: conversation(),
  customer,
  analysis: {
    intent: "COMPLAINT" as const,
    subIntent: null,
    sentiment: "negative" as const,
    urgency: "normal" as const,
    confidence: 0.7,
    needsHuman: false,
    escalationReason: null,
  },
  knowledgeMiss: false,
  toolFailed: false,
  handedOff: false,
  handoffReason: null,
  history: [{ role: "user" as const, sent_by: null, content: "Nobody called me back" }],
  reply: "I am sorry about that — a colleague will call you today.",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUpcomingAppointments.mockResolvedValue([]);
});

describe("escalateIfNeeded", () => {
  it("records the reason and a briefing that includes the reply about to be sent", async () => {
    mocks.getUpcomingAppointments.mockResolvedValue([
      { service: "cleaning", starts_at: "2026-09-28T03:00:00.000Z", status: "booked" },
    ]);

    const decision = await escalateIfNeeded(check());

    expect(decision).toEqual({ reason: "The customer raised a complaint", pauseAi: true });
    const [conversationId, reason, summary] = mocks.escalateConversation.mock.calls[0];
    expect(conversationId).toBe("con-1");
    expect(reason).toBe("The customer raised a complaint");
    expect(summary).toContain("Dewi (+6285110525118), RETURNING_CUSTOMER");
    expect(summary).toContain("COMPLAINT, 70% confident");
    // 03:00 UTC is 10:00 in Jakarta, and the briefing speaks the business's local time
    expect(summary).toContain("cleaning Monday 28 September at 10:00 (booked)");
    expect(summary).toContain("Customer: Nobody called me back");
    expect(summary).toContain("AI: I am sorry about that");
  });

  it("judges confidence against the previous reply, not the one being written", async () => {
    const uncertain = { confidence: 0.4, intent: "GENERAL_QUESTION" as const };
    // The row still holds the previous reply's confidence, which was also low
    await escalateIfNeeded(
      check({ analysis: { ...check().analysis, ...uncertain }, conversation: conversation({ ai_confidence: 0.5 }) })
    );
    expect(mocks.escalateConversation).toHaveBeenCalledWith("con-1", "Two uncertain answers in a row", expect.any(String));
  });

  it("does nothing when no rule fires", async () => {
    const decision = await escalateIfNeeded(
      check({ analysis: { ...check().analysis, intent: "BOOKING" as const, sentiment: "neutral" as const } })
    );
    expect(decision).toBeNull();
    expect(mocks.escalateConversation).not.toHaveBeenCalled();
    expect(mocks.getUpcomingAppointments).not.toHaveBeenCalled();
  });

  it("still reports the decision when the briefing cannot be written", async () => {
    mocks.getUpcomingAppointments.mockRejectedValue(new Error("database down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    // The reply must go out even if the hand-over could not be recorded
    await expect(escalateIfNeeded(check())).resolves.toEqual({
      reason: "The customer raised a complaint",
      pauseAi: true,
    });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("copes with a conversation that has no customer record yet", async () => {
    const decision = await escalateIfNeeded(check({ customer: null }));
    expect(decision?.pauseAi).toBe(true);
    expect(mocks.getUpcomingAppointments).not.toHaveBeenCalled();
    expect(mocks.escalateConversation.mock.calls[0][2]).toContain("Dewi (+6285110525118), NEW");
  });
});
