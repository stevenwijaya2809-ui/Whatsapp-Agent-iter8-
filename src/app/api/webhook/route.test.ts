import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplyResult } from "@/lib/ai";
import type { Conversation } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  /** Work the route deferred with `after`, awaited by the test's own `post` helper */
  deferred: [] as Promise<unknown>[],
  generateReply: vi.fn(),
  getCustomer: vi.fn(),
  applyAnalysis: vi.fn(),
  getConversation: vi.fn(),
  getRecentMessages: vi.fn(),
  saveDraft: vi.fn(),
  saveMessage: vi.fn(),
  updateConversation: vi.fn(),
  updateMessageStatus: vi.fn(),
  upsertConversation: vi.fn(),
  escalateIfNeeded: vi.fn(),
  sendWhatsAppMessage: vi.fn(),
  getOrganization: vi.fn(),
}));

// `after` defers work until the response is sent, so the test starts it and waits for it
vi.mock("next/server", () => ({
  after: (callback: () => Promise<void>) => {
    mocks.deferred.push(callback());
  },
}));
vi.mock("@/lib/ai", () => ({ generateReply: mocks.generateReply }));
vi.mock("@/lib/customers", () => ({ getCustomer: mocks.getCustomer }));
vi.mock("@/lib/conversations", () => ({
  applyAnalysis: mocks.applyAnalysis,
  getConversation: mocks.getConversation,
  getRecentMessages: mocks.getRecentMessages,
  saveDraft: mocks.saveDraft,
  saveMessage: mocks.saveMessage,
  updateConversation: mocks.updateConversation,
  updateMessageStatus: mocks.updateMessageStatus,
  upsertConversation: mocks.upsertConversation,
}));
vi.mock("@/lib/handoff", () => ({ escalateIfNeeded: mocks.escalateIfNeeded }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: mocks.sendWhatsAppMessage }));
vi.mock("@/lib/organization", () => ({ getOrganization: mocks.getOrganization }));

const { POST } = await import("@/app/api/webhook/route");

const conversation = (overrides: Partial<Conversation> = {}): Conversation =>
  ({
    id: "con-1",
    phone: "6285110525118",
    name: "Dewi",
    mode: "agent",
    customer_id: "cus-1",
    ai_confidence: 0.8,
    needs_human: false,
    draft_reply: null,
    ...overrides,
  }) as Conversation;

const completion = (overrides: Partial<ReplyResult> = {}): ReplyResult => ({
  text: "A colleague will call you shortly.",
  analysis: {
    intent: "COMPLAINT",
    subIntent: null,
    sentiment: "negative",
    urgency: "normal",
    confidence: 0.7,
    needsHuman: false,
    escalationReason: null,
  },
  knowledgeMiss: false,
  knowledgeUsed: 1,
  toolsUsed: [],
  toolFailed: false,
  ...overrides,
});

function incoming(text: string): Request {
  return new Request("https://example.test/api/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                contacts: [{ profile: { name: "Dewi" }, wa_id: "6285110525118" }],
                messages: [{ from: "6285110525118", id: "wamid.1", timestamp: "1", type: "text", text: { body: text } }],
              },
            },
          ],
        },
      ],
    }),
  });
}

/** Posts to the route and waits for the reply it prepares in the background. */
async function post(request: Request): Promise<Response> {
  // The route takes a NextRequest; a plain Request carries everything it actually reads
  const response = await POST(request as never);
  await Promise.all(mocks.deferred.splice(0));
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.deferred.length = 0;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  mocks.upsertConversation.mockResolvedValue(conversation());
  mocks.saveMessage.mockResolvedValue({ id: "msg-1", created_at: "2026-09-27T00:00:00Z" });
  mocks.getRecentMessages.mockResolvedValue([
    { id: "msg-1", role: "user", sent_by: null, content: "This is unacceptable", created_at: "2026-09-27T00:00:00Z" },
  ]);
  mocks.getConversation.mockResolvedValue(conversation());
  mocks.getCustomer.mockResolvedValue({ id: "cus-1", name: "Dewi", status: "ACTIVE_CUSTOMER" });
  mocks.getOrganization.mockResolvedValue({ id: "org-1", timezone: "Asia/Jakarta", ai: {}, business: {} });
  mocks.generateReply.mockResolvedValue(completion());
  mocks.escalateIfNeeded.mockResolvedValue(null);
  mocks.sendWhatsAppMessage.mockResolvedValue("wamid.out");
});

describe("webhook replies", () => {
  it("answers Meta straight away and replies in the background", async () => {
    const response = await post(incoming("What are your opening hours?"));
    expect(response.status).toBe(200);
    expect(mocks.sendWhatsAppMessage).toHaveBeenCalledWith("6285110525118", "A colleague will call you shortly.");
    expect(mocks.saveMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ role: "assistant", sentBy: "ai", status: "sent" })
    );
  });

  it("decides the hand-over before the new analysis overwrites the previous confidence", async () => {
    await post(incoming("This is unacceptable"));

    expect(mocks.escalateIfNeeded).toHaveBeenCalledWith(
      expect.objectContaining({
        // The conversation as loaded before this turn, so its confidence is the previous reply's
        conversation: expect.objectContaining({ ai_confidence: 0.8 }),
        analysis: expect.objectContaining({ intent: "COMPLAINT" }),
        reply: "A colleague will call you shortly.",
      })
    );
    expect(mocks.escalateIfNeeded.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.applyAnalysis.mock.invocationCallOrder[0]
    );
  });

  it("tells the assistant's hand-over tool apart from an ordinary tool call", async () => {
    mocks.generateReply.mockResolvedValue(
      completion({
        toolsUsed: [
          { tool: "handoff_to_human", ok: true, detail: "customer waited two weeks for a call" },
          { tool: "get_appointments", ok: true },
        ],
      })
    );
    await post(incoming("I want to speak to someone"));
    expect(mocks.escalateIfNeeded).toHaveBeenCalledWith(
      expect.objectContaining({ handedOff: true, handoffReason: "customer waited two weeks for a call" })
    );

    mocks.generateReply.mockResolvedValue(completion({ toolsUsed: [{ tool: "check_availability", ok: true }] }));
    await post(incoming("Any slots tomorrow?"));
    expect(mocks.escalateIfNeeded).toHaveBeenLastCalledWith(
      expect.objectContaining({ handedOff: false, handoffReason: null })
    );
  });

  it("stops the assistant only after the customer has been told a person is coming", async () => {
    mocks.escalateIfNeeded.mockResolvedValue({ reason: "The customer raised a complaint", pauseAi: true });

    await post(incoming("This is unacceptable"));

    expect(mocks.updateConversation).toHaveBeenCalledWith("con-1", { mode: "human" });
    const [paused] = mocks.updateConversation.mock.invocationCallOrder;
    expect(paused).toBeGreaterThan(mocks.sendWhatsAppMessage.mock.invocationCallOrder[0]);
    expect(paused).toBeGreaterThan(mocks.saveMessage.mock.invocationCallOrder.at(-1) as number);
  });

  it("leaves the mode alone for a soft hand-over", async () => {
    mocks.escalateIfNeeded.mockResolvedValue({ reason: "Two uncertain answers in a row", pauseAi: false });
    await post(incoming("Do you take my insurance?"));
    expect(mocks.sendWhatsAppMessage).toHaveBeenCalled();
    expect(mocks.updateConversation).not.toHaveBeenCalled();
  });

  it("keeps the operator's own mode: a draft is stored and nothing is sent or paused", async () => {
    mocks.upsertConversation.mockResolvedValue(conversation({ mode: "draft" }));
    mocks.getConversation.mockResolvedValue(conversation({ mode: "draft" }));
    mocks.escalateIfNeeded.mockResolvedValue({ reason: "The customer raised a complaint", pauseAi: true });

    await post(incoming("This is unacceptable"));

    expect(mocks.saveDraft).toHaveBeenCalledWith("con-1", "A colleague will call you shortly.");
    expect(mocks.sendWhatsAppMessage).not.toHaveBeenCalled();
    expect(mocks.updateConversation).not.toHaveBeenCalled();
  });

  it("does not reply at all while a person is handling the conversation", async () => {
    mocks.upsertConversation.mockResolvedValue(conversation({ mode: "human" }));
    await post(incoming("Are you there?"));
    expect(mocks.generateReply).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it("makes Meta redeliver when the message could not be stored", async () => {
    mocks.upsertConversation.mockRejectedValue(new Error("database down"));
    const response = await post(incoming("Hello"));
    expect(response.status).toBe(500);
    expect(mocks.generateReply).not.toHaveBeenCalled();
  });

  it("rejects a payload that is not signed by Meta", async () => {
    process.env.WHATSAPP_APP_SECRET = "app-secret";
    const response = await post(incoming("Hello"));
    expect(response.status).toBe(401);
    expect(mocks.upsertConversation).not.toHaveBeenCalled();
  });
});
