import { describe, expect, it } from "vitest";
import { assembleSystemPrompt } from "@/lib/ai/prompt/assemble";
import { describeAge } from "@/lib/ai/prompt/sections";
import type { KnowledgeResult } from "@/lib/knowledge";
import type { Organization } from "@/lib/organization";
import type { Customer } from "@/lib/types";

const now = new Date("2026-09-27T10:00:00Z");

const organization: Organization = {
  id: "org-1",
  name: "Senyum Dental Studio",
  timezone: "Asia/Jakarta",
  business: {
    name: "Senyum Dental Studio",
    address: "Jl. Sudirman No. 45",
    phone: "+62 21 5550 0123",
    hours: { Mon: [9, 18], Sat: [9, 13], Sun: null },
  },
  ai: { personality: "Warm and concise", confidenceThreshold: 0.6 },
};

const customer: Customer = {
  id: "cus-1",
  organization_id: "org-1",
  phone: "6285110525118",
  name: "Dewi",
  status: "RETURNING_CUSTOMER",
  lead_status: null,
  tags: ["whitening"],
  preferences: {},
  ai_summary: "Asked about whitening in August, did not book.",
  first_contact_at: "2026-08-27T10:00:00Z",
  last_interaction_at: "2026-09-26T10:00:00Z",
  conversation_count: 2,
  created_at: "2026-08-27T10:00:00Z",
  updated_at: "2026-09-26T10:00:00Z",
};

const knowledge: KnowledgeResult = {
  miss: false,
  entries: [
    {
      id: "kb-1",
      category: "essentials",
      question: "What are your opening hours?",
      answer: "Monday to Friday 9am-6pm.",
      tags: ["hours"],
      updated_at: "2026-09-20T10:00:00Z",
    },
  ],
};

describe("assembleSystemPrompt", () => {
  it("composes the sections in a fixed order", () => {
    const prompt = assembleSystemPrompt({ organization, customer, knowledge, now });
    const order = ["## BUSINESS", "## CUSTOMER", "## BUSINESS KNOWLEDGE", "## ACTIONS", "## WHEN TO HAND OVER"].map((heading) =>
      prompt.indexOf(heading)
    );
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order]).toEqual([...order].sort((a, b) => a - b));
  });

  it("carries the business profile, including closed days", () => {
    const prompt = assembleSystemPrompt({ organization, customer, knowledge, now });
    expect(prompt).toContain("Jl. Sudirman No. 45");
    expect(prompt).toContain("Mon 9:00-18:00");
    expect(prompt).toContain("Sun closed");
  });

  it("includes what is known about the customer", () => {
    const prompt = assembleSystemPrompt({ organization, customer, knowledge, now });
    expect(prompt).toContain("Dewi");
    expect(prompt).toContain("RETURNING_CUSTOMER");
    expect(prompt).toContain("did not book");
  });

  it("omits the customer section for an unknown number", () => {
    const prompt = assembleSystemPrompt({ organization, customer: null, knowledge, now });
    expect(prompt).not.toContain("## CUSTOMER");
  });

  it("states knowledge freshness and warns when nothing matched", () => {
    const hit = assembleSystemPrompt({ organization, customer, knowledge, now });
    expect(hit).toContain("updated 7 days ago");

    const missed = assembleSystemPrompt({ organization, customer, knowledge: { entries: [], miss: true }, now });
    expect(missed).toContain("Do not answer factual questions");
  });

  it("tells the model it has no actions until tools are enabled", () => {
    expect(assembleSystemPrompt({ organization, customer, knowledge, now })).toContain("cannot perform actions");
    expect(assembleSystemPrompt({ organization, customer, knowledge, tools: ["create_booking"], now })).toContain(
      "create_booking"
    );
  });

  it("always carries the honesty rules", () => {
    const prompt = assembleSystemPrompt({ organization, customer: null, knowledge, now });
    expect(prompt).toContain("Never say an action has been carried out");
    expect(prompt).toContain("Only state business facts");
  });
});

describe("describeAge", () => {
  it("reads as a person would say it", () => {
    expect(describeAge("2026-09-27T09:00:00Z", now)).toBe("today");
    expect(describeAge("2026-09-26T09:00:00Z", now)).toBe("yesterday");
    expect(describeAge("2026-09-20T10:00:00Z", now)).toBe("7 days ago");
    expect(describeAge("2026-07-27T10:00:00Z", now)).toBe("2 months ago");
  });
});
