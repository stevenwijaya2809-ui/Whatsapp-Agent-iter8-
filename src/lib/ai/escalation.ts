import type { ReplyAnalysis } from "@/lib/ai/analysis";
import type { AiSettings } from "@/lib/organization";

/** How far below the confidence threshold counts as "the assistant was guessing". */
const VERY_UNSURE_RATIO = 0.6;

const DEFAULT_THRESHOLD = 0.55;

export interface EscalationInput {
  analysis: ReplyAnalysis | null;
  knowledgeMiss: boolean;
  toolFailed: boolean;
  /** The assistant used its hand-over tool */
  handedOff: boolean;
  /** What it told that tool, which is the most specific reason available */
  handoffReason: string | null;
  /** Confidence of the assistant's previous reply here, if it has replied before */
  previousConfidence: number | null;
  settings: AiSettings;
}

export interface EscalationDecision {
  reason: string;
  /** Hard reasons also stop the assistant replying, so a person is not talked over */
  pauseAi: boolean;
}

/**
 * Decides whether a person should take over, independently of what the model claims. The first
 * matching rule wins, and the reason is written for the operator who will read it in the inbox.
 */
export function decideEscalation({
  analysis,
  knowledgeMiss,
  toolFailed,
  handedOff,
  handoffReason,
  previousConfidence,
  settings,
}: EscalationInput): EscalationDecision | null {
  const threshold = settings.confidenceThreshold ?? DEFAULT_THRESHOLD;

  if (toolFailed) {
    return { reason: "An action could not be completed", pauseAi: true };
  }

  // What the assistant said when it handed over beats anything inferred below
  const statedReason = handedOff ? (handoffReason ?? analysis?.escalationReason) : null;
  if (statedReason) {
    return { reason: statedReason, pauseAi: true };
  }

  if (analysis?.intent === "HUMAN_REQUEST") {
    return { reason: "The customer asked to speak to a person", pauseAi: true };
  }

  if (analysis?.intent === "COMPLAINT" && settings.escalateOnComplaint !== false) {
    return { reason: "The customer raised a complaint", pauseAi: true };
  }

  if (analysis?.needsHuman) {
    return { reason: analysis.escalationReason ?? "The assistant asked for a person", pauseAi: true };
  }

  if (analysis?.urgency === "high") {
    return { reason: "The customer's message is urgent", pauseAi: true };
  }

  if (analysis?.intent === "PAYMENT" && analysis.sentiment === "negative") {
    return { reason: "A payment problem", pauseAi: true };
  }

  // A hand-over with nothing more specific to say still stands
  if (handedOff) {
    return { reason: "The assistant handed the conversation over", pauseAi: true };
  }

  if (!analysis) return null;

  if (analysis.confidence < threshold && previousConfidence !== null && previousConfidence < threshold) {
    return { reason: "Two uncertain answers in a row", pauseAi: false };
  }

  if (analysis.confidence < threshold * VERY_UNSURE_RATIO) {
    return { reason: "The assistant was not confident in its answer", pauseAi: false };
  }

  if (knowledgeMiss && analysis.confidence < threshold) {
    return { reason: "Nothing in the business knowledge answered the question", pauseAi: false };
  }

  return null;
}

export interface HandoffFacts {
  customerName: string | null;
  phone: string;
  customerStatus: string;
  intent: string | null;
  confidence: number | null;
  reason: string;
  /** Most recent first is fine; they are printed oldest first */
  recentMessages: { role: string; sentBy: string | null; content: string }[];
  appointments: { service: string; when: string; status: string }[];
}

const MAX_SUMMARY_MESSAGES = 4;
const MAX_QUOTE_LENGTH = 140;

/**
 * A short briefing for whoever picks the conversation up. Assembled from facts rather than
 * written by the model, so it cannot invent an appointment that does not exist.
 */
export function buildHandoffSummary(facts: HandoffFacts): string {
  const lines = [
    `Customer: ${facts.customerName ?? "unknown"} (+${facts.phone}), ${facts.customerStatus}`,
    `Reason: ${facts.reason}`,
  ];

  if (facts.intent) {
    const confidence = facts.confidence !== null ? `, ${Math.round(facts.confidence * 100)}% confident` : "";
    lines.push(`Detected intent: ${facts.intent}${confidence}`);
  }

  lines.push(
    facts.appointments.length > 0
      ? `Appointments: ${facts.appointments.map((a) => `${a.service} ${a.when} (${a.status})`).join("; ")}`
      : "Appointments: none upcoming"
  );

  const conversation = facts.recentMessages.slice(-MAX_SUMMARY_MESSAGES).map((message) => {
    const who = message.role === "user" ? "Customer" : message.sentBy === "human" ? "You" : "AI";
    return `  ${who}: ${truncate(message.content, MAX_QUOTE_LENGTH)}`;
  });

  if (conversation.length > 0) lines.push("Last messages:", ...conversation);

  return lines.join("\n");
}

function truncate(text: string, limit: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > limit ? `${single.slice(0, limit - 1)}…` : single;
}
