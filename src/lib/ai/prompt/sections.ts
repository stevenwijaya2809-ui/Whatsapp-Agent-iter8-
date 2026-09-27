import type { KnowledgeResult } from "@/lib/knowledge";
import type { Organization } from "@/lib/organization";
import type { Customer } from "@/lib/types";

/**
 * The dynamic halves of the prompt. Each returns a titled block, or an empty string when
 * it has nothing to add, so the assembler can simply drop empties.
 */

export function businessContext(organization: Organization, now = new Date()): string {
  const { business } = organization;
  const lines = [
    `Business: ${business.name}`,
    `Now: ${formatNow(organization.timezone, now)}`,
    business.address && `Address: ${business.address}`,
    business.phone && `Phone: ${business.phone}`,
    business.email && `Email: ${business.email}`,
    `Timezone: ${organization.timezone}`,
    business.hours && `Opening hours: ${formatHours(business.hours)}`,
    organization.ai.personality && `Tone: ${organization.ai.personality}`,
  ].filter(Boolean);

  return section("BUSINESS", lines.join("\n"));
}

export function customerContext(customer: Customer | null, now = new Date()): string {
  if (!customer) return "";

  const lines = [
    `Name: ${customer.name ?? "unknown"}`,
    `Status: ${customer.status}`,
    customer.lead_status && `Lead status: ${customer.lead_status}`,
    customer.tags.length > 0 && `Tags: ${customer.tags.join(", ")}`,
    `First contact: ${describeAge(customer.first_contact_at, now)}`,
    customer.conversation_count > 1 && `Previous conversations: ${customer.conversation_count}`,
    customer.ai_summary && `What we know: ${customer.ai_summary}`,
  ].filter(Boolean);

  return section("CUSTOMER", lines.join("\n"));
}

export function knowledgeContext(knowledge: KnowledgeResult, now = new Date()): string {
  if (knowledge.entries.length === 0) {
    return section(
      "BUSINESS KNOWLEDGE",
      "No business information is available. Do not answer factual questions; offer to check."
    );
  }

  const entries = knowledge.entries
    .map((entry) => `- ${entry.question}\n  ${entry.answer}\n  (${entry.category}, updated ${describeAge(entry.updated_at, now)})`)
    .join("\n");

  const note = knowledge.miss
    ? "\n\nNothing here matches the customer's question directly. Do not fill the gap yourself: say you will check."
    : "";

  return section("BUSINESS KNOWLEDGE", `${entries}${note}`);
}

export function escalationRules(organization: Organization): string {
  const threshold = organization.ai.confidenceThreshold ?? 0.55;
  const rules = [
    "The customer asks for a person, or asks twice for something you could not answer",
    "A complaint, a refund request, or anger",
    "A medical emergency, or anything involving severe pain or bleeding",
    "A payment or billing dispute",
    "An action you could not complete",
    `Your own confidence in the answer is below ${Math.round(threshold * 100)}%`,
  ];

  return section(
    "WHEN TO HAND OVER",
    `${rules.map((rule) => `- ${rule}`).join("\n")}\n\nWhen one applies, stay calm, tell the customer a colleague will take over shortly, and do not promise a specific time.`
  );
}

export function toolsContext(toolDescriptions: string[]): string {
  if (toolDescriptions.length === 0) {
    return section(
      "ACTIONS",
      "You cannot perform actions. For anything that needs a change in the system, say a colleague will arrange it."
    );
  }

  const protocol =
    'To act, reply with {"action": {"tool": "name", "arguments": {}}} and no "reply" field. You will be given the result, and must then write the customer\'s reply using only what it returned.';

  const rules =
    "Check availability before offering a time. If a result says the action failed, tell the customer plainly that it did not go through and that a colleague will follow up. Never describe a failed or unattempted action as done.";

  return section("ACTIONS", [protocol, "", ...toolDescriptions.map((line) => `- ${line}`), "", rules].join("\n"));
}

function section(title: string, body: string): string {
  return `## ${title}\n${body}`;
}

function formatNow(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
}

function formatHours(hours: Record<string, [number, number] | null>): string {
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return order
    .filter((day) => day in hours)
    .map((day) => {
      const range = hours[day];
      return range ? `${day} ${range[0]}:00-${range[1]}:00` : `${day} closed`;
    })
    .join(", ");
}

/** "today", "3 days ago", "2 months ago" — enough for the model without exact timestamps. */
export function describeAge(iso: string, now = new Date()): string {
  const days = Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return "recently";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}
