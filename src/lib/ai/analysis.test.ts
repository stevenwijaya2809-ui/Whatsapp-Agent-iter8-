import { describe, expect, it } from "vitest";
import { parseModelOutput } from "@/lib/ai/analysis";

const full = JSON.stringify({
  reply: "We are open 9am to 1pm on Saturday.",
  intent: "OPERATING_HOURS",
  sub_intent: "saturday hours",
  sentiment: "neutral",
  urgency: "low",
  confidence: 0.92,
  needs_human: false,
  escalation_reason: null,
});

describe("parseModelOutput", () => {
  it("reads the reply and its metadata", () => {
    const { text, analysis } = parseModelOutput(full);
    expect(text).toBe("We are open 9am to 1pm on Saturday.");
    expect(analysis).toEqual({
      intent: "OPERATING_HOURS",
      subIntent: "saturday hours",
      sentiment: "neutral",
      urgency: "low",
      confidence: 0.92,
      needsHuman: false,
      escalationReason: null,
    });
  });

  it("copes with code fences and surrounding prose", () => {
    expect(parseModelOutput("```json\n" + full + "\n```").analysis?.intent).toBe("OPERATING_HOURS");
    expect(parseModelOutput(`Here you go:\n${full}\nHope that helps.`).text).toBe("We are open 9am to 1pm on Saturday.");
  });

  it("falls back to plain text when the model ignores the contract", () => {
    const { text, analysis } = parseModelOutput("Sure, we open at 9am on Saturday.");
    expect(text).toBe("Sure, we open at 9am on Saturday.");
    expect(analysis).toBeNull();
  });

  it("falls back when the JSON is malformed or has no reply", () => {
    expect(parseModelOutput('{"reply": "half').analysis).toBeNull();
    expect(parseModelOutput('{"intent": "BOOKING"}').analysis).toBeNull();
  });

  it("normalises confidence however the model expresses it", () => {
    const confidenceOf = (value: string) => parseModelOutput(`{"reply":"hi","confidence":${value}}`).analysis?.confidence;
    expect(confidenceOf("0.94")).toBe(0.94);
    expect(confidenceOf("94")).toBe(0.94);
    expect(confidenceOf('"94%"')).toBe(0.94);
    expect(confidenceOf('"nonsense"')).toBe(0);
    expect(confidenceOf("250")).toBe(1);
  });

  it("falls back to safe defaults for unknown values", () => {
    const { analysis } = parseModelOutput('{"reply":"hi","intent":"chit chat","sentiment":"grumpy","urgency":"later"}');
    expect(analysis).toMatchObject({ intent: "UNKNOWN", sentiment: "neutral", urgency: "normal" });
  });

  it("accepts loosely written intents", () => {
    expect(parseModelOutput('{"reply":"hi","intent":"human request"}').analysis?.intent).toBe("HUMAN_REQUEST");
    expect(parseModelOutput('{"reply":"hi","intent":"service-information"}').analysis?.intent).toBe("SERVICE_INFORMATION");
  });

  it("treats a stated escalation reason as needing a human", () => {
    const { analysis } = parseModelOutput('{"reply":"hi","needs_human":false,"escalation_reason":"customer is angry"}');
    expect(analysis?.needsHuman).toBe(true);
    expect(analysis?.escalationReason).toBe("customer is angry");
  });

  it("treats null-ish strings as absent", () => {
    const { analysis } = parseModelOutput('{"reply":"hi","sub_intent":"null","escalation_reason":"none"}');
    expect(analysis?.subIntent).toBeNull();
    expect(analysis?.escalationReason).toBeNull();
    expect(analysis?.needsHuman).toBe(false);
  });
});
