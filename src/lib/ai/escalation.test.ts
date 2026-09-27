import { describe, expect, it } from "vitest";
import type { ReplyAnalysis } from "@/lib/ai/analysis";
import { buildHandoffSummary, decideEscalation, type EscalationInput } from "@/lib/ai/escalation";

const analysis = (overrides: Partial<ReplyAnalysis> = {}): ReplyAnalysis => ({
  intent: "GENERAL_QUESTION",
  subIntent: null,
  sentiment: "neutral",
  urgency: "normal",
  confidence: 0.9,
  needsHuman: false,
  escalationReason: null,
  ...overrides,
});

const input = (overrides: Partial<EscalationInput> = {}): EscalationInput => ({
  analysis: analysis(),
  knowledgeMiss: false,
  toolFailed: false,
  handedOff: false,
  handoffReason: null,
  previousConfidence: null,
  settings: { confidenceThreshold: 0.6 },
  ...overrides,
});

describe("decideEscalation", () => {
  it("leaves a confident, ordinary answer alone", () => {
    expect(decideEscalation(input())).toBeNull();
  });

  it("hands over when an action failed, and stops the assistant", () => {
    expect(decideEscalation(input({ toolFailed: true }))).toEqual({
      reason: "An action could not be completed",
      pauseAi: true,
    });
  });

  it("hands over when the assistant used its hand-over tool, keeping what it said", () => {
    expect(
      decideEscalation(input({ handedOff: true, handoffReason: "customer waited two weeks for a call" }))
    ).toEqual({ reason: "customer waited two weeks for a call", pauseAi: true });

    // Nothing said to the tool: the model's own reason, then the detected intent, then a plain fallback
    expect(
      decideEscalation(input({ handedOff: true, analysis: analysis({ escalationReason: "customer is upset" }) }))
    ).toEqual({ reason: "customer is upset", pauseAi: true });
    expect(decideEscalation(input({ handedOff: true, analysis: analysis({ intent: "COMPLAINT" }) }))).toEqual({
      reason: "The customer raised a complaint",
      pauseAi: true,
    });
    expect(decideEscalation(input({ handedOff: true, analysis: null }))).toEqual({
      reason: "The assistant handed the conversation over",
      pauseAi: true,
    });
  });

  it("hands over when the customer asks for a person", () => {
    const decision = decideEscalation(input({ analysis: analysis({ intent: "HUMAN_REQUEST" }) }));
    expect(decision).toEqual({ reason: "The customer asked to speak to a person", pauseAi: true });
  });

  it("hands over on a complaint, unless the business turns that off", () => {
    const complaint = analysis({ intent: "COMPLAINT", sentiment: "negative" });
    expect(decideEscalation(input({ analysis: complaint }))).toEqual({
      reason: "The customer raised a complaint",
      pauseAi: true,
    });
    expect(
      decideEscalation(input({ analysis: complaint, settings: { confidenceThreshold: 0.6, escalateOnComplaint: false } }))
    ).toBeNull();
  });

  it("hands over on urgency and on payment trouble", () => {
    expect(decideEscalation(input({ analysis: analysis({ urgency: "high" }) }))).toMatchObject({ pauseAi: true });
    expect(
      decideEscalation(input({ analysis: analysis({ intent: "PAYMENT", sentiment: "negative" }) }))
    ).toMatchObject({ reason: "A payment problem" });
  });

  it("does not hand over for a neutral payment question", () => {
    expect(decideEscalation(input({ analysis: analysis({ intent: "PAYMENT" }) }))).toBeNull();
  });

  it("respects the model's own request, using its reason", () => {
    const decision = decideEscalation(
      input({ analysis: analysis({ needsHuman: true, escalationReason: "customer is distressed" }) })
    );
    expect(decision).toEqual({ reason: "customer is distressed", pauseAi: true });
  });

  it("hands over softly after two uncertain answers", () => {
    expect(decideEscalation(input({ analysis: analysis({ confidence: 0.5 }), previousConfidence: 0.4 }))).toEqual({
      reason: "Two uncertain answers in a row",
      pauseAi: false,
    });
    // A single wobble is not enough
    expect(decideEscalation(input({ analysis: analysis({ confidence: 0.5 }) }))).toBeNull();
  });

  it("hands over when the assistant was clearly guessing", () => {
    expect(decideEscalation(input({ analysis: analysis({ confidence: 0.2 }) }))).toMatchObject({
      reason: "The assistant was not confident in its answer",
      pauseAi: false,
    });
  });

  it("hands over when nothing was known and the answer was shaky", () => {
    expect(decideEscalation(input({ analysis: analysis({ confidence: 0.5 }), knowledgeMiss: true }))).toMatchObject({
      reason: "Nothing in the business knowledge answered the question",
    });
    // Knowledge miss alone, answered confidently, is fine
    expect(decideEscalation(input({ knowledgeMiss: true }))).toBeNull();
  });

  it("cannot judge confidence when the model ignored the contract", () => {
    expect(decideEscalation(input({ analysis: null }))).toBeNull();
    expect(decideEscalation(input({ analysis: null, toolFailed: true }))).toMatchObject({ pauseAi: true });
  });
});

describe("buildHandoffSummary", () => {
  const facts = {
    customerName: "Dewi",
    phone: "6285110525118",
    customerStatus: "RETURNING_CUSTOMER",
    intent: "RESCHEDULE",
    confidence: 0.62,
    reason: "An action could not be completed",
    recentMessages: [
      { role: "user", sentBy: null, content: "Saya mau ubah jadwal" },
      { role: "assistant", sentBy: "ai", content: "Maaf, saya tidak menemukan janji temu Anda." },
    ],
    appointments: [{ service: "cleaning", when: "Monday 28 September, 10:00", status: "booked" }],
  };

  it("briefs the operator with the facts, not prose", () => {
    const summary = buildHandoffSummary(facts);
    expect(summary).toContain("Dewi");
    expect(summary).toContain("RETURNING_CUSTOMER");
    expect(summary).toContain("Reason: An action could not be completed");
    expect(summary).toContain("RESCHEDULE, 62% confident");
    expect(summary).toContain("cleaning Monday 28 September, 10:00 (booked)");
    expect(summary).toContain("Customer: Saya mau ubah jadwal");
    expect(summary).toContain("AI: Maaf");
  });

  it("says plainly when there are no appointments", () => {
    expect(buildHandoffSummary({ ...facts, appointments: [] })).toContain("Appointments: none upcoming");
  });

  it("keeps only the last few messages, shortened", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ role: "user", sentBy: null, content: `message ${i} ${"x".repeat(200)}` }));
    const summary = buildHandoffSummary({ ...facts, recentMessages: many });
    expect(summary).not.toContain("message 3");
    expect(summary).toContain("message 7");
    expect(summary.split("\n").every((line) => line.length <= 160)).toBe(true);
  });

  it("labels who said what", () => {
    const summary = buildHandoffSummary({
      ...facts,
      recentMessages: [{ role: "assistant", sentBy: "human", content: "I will call you" }],
    });
    expect(summary).toContain("You: I will call you");
  });
});
