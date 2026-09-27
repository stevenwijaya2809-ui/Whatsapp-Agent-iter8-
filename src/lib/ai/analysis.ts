import type { Intent, Sentiment, Urgency } from "@/lib/types";

/** Operational metadata the model returns alongside its reply. Never its reasoning. */
export interface ReplyAnalysis {
  intent: Intent;
  subIntent: string | null;
  sentiment: Sentiment;
  urgency: Urgency;
  /** How sure the model is that its reply is correct and complete, 0 to 1 */
  confidence: number;
  needsHuman: boolean;
  escalationReason: string | null;
}

/** The model asking to do something before it answers. */
export interface ToolRequest {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface ParsedReply {
  /** The message for the customer; empty while the model is still taking an action */
  text: string;
  /** Null when the model ignored the contract, so callers can tell "unknown" from "neutral" */
  analysis: ReplyAnalysis | null;
  action: ToolRequest | null;
}

const INTENTS: Intent[] = [
  "BOOKING",
  "RESCHEDULE",
  "CANCELLATION",
  "SERVICE_INFORMATION",
  "PRICE",
  "LOCATION",
  "OPERATING_HOURS",
  "PAYMENT",
  "COMPLAINT",
  "FOLLOW_UP",
  "PROMOTION",
  "GENERAL_QUESTION",
  "HUMAN_REQUEST",
  "UNKNOWN",
];

const SENTIMENTS: Sentiment[] = ["positive", "neutral", "negative"];
const URGENCIES: Urgency[] = ["low", "normal", "high"];

/**
 * Reads the model's reply. The contract asks for one JSON object, but small models wrap it in
 * code fences or add a sentence around it, so this recovers the object where it can and falls
 * back to treating the whole output as the reply rather than losing the customer's answer.
 */
export function parseModelOutput(raw: string): ParsedReply {
  const cleaned = stripFences(raw).trim();
  const candidate = extractObject(cleaned);

  if (candidate) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
      const action = readAction(parsed.action);
      if (reply || action) return { text: reply, analysis: readAnalysis(parsed), action };
    } catch {
      // Malformed JSON: fall through and treat the output as plain text
    }
  }

  return { text: cleaned, analysis: null, action: null };
}

/** Accepts {tool, arguments} and the {name, args} shape some models prefer. */
function readAction(value: unknown): ToolRequest | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const tool = typeof raw.tool === "string" ? raw.tool : typeof raw.name === "string" ? raw.name : null;
  if (!tool) return null;

  const args = raw.arguments ?? raw.args ?? {};
  return { tool: tool.trim(), arguments: typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {} };
}

function readAnalysis(parsed: Record<string, unknown>): ReplyAnalysis {
  const escalationReason = asText(parsed.escalation_reason);
  return {
    intent: matchEnum(parsed.intent, INTENTS, "UNKNOWN", (value) => value.toUpperCase().replace(/[\s-]+/g, "_")),
    subIntent: asText(parsed.sub_intent),
    sentiment: matchEnum(parsed.sentiment, SENTIMENTS, "neutral", (value) => value.toLowerCase()),
    urgency: matchEnum(parsed.urgency, URGENCIES, "normal", (value) => value.toLowerCase()),
    confidence: readConfidence(parsed.confidence),
    needsHuman: parsed.needs_human === true || parsed.needs_human === "true" || Boolean(escalationReason),
    escalationReason,
  };
}

/** Accepts 0.94, "0.94", 94 and "94%" — models are inconsistent about scale. */
function readConfidence(value: unknown): number {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace("%", ""));
  if (!Number.isFinite(number) || number < 0) return 0;
  const scaled = number > 1 ? number / 100 : number;
  return Math.min(1, Math.round(scaled * 100) / 100);
}

function matchEnum<T extends string>(value: unknown, allowed: T[], fallback: T, normalise: (value: string) => string): T {
  if (typeof value !== "string") return fallback;
  const candidate = normalise(value.trim());
  return (allowed as string[]).includes(candidate) ? (candidate as T) : fallback;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.toLowerCase() !== "null" && text.toLowerCase() !== "none" ? text : null;
}

function stripFences(raw: string): string {
  return raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
}

/** The outermost {...} in the text, which is the reply object even when prose surrounds it. */
function extractObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start !== -1 && end > start ? text.slice(start, end + 1) : null;
}
