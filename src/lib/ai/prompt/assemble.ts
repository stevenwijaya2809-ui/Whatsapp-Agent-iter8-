import { CORE_SYSTEM_PROMPT } from "@/lib/ai/prompt/core";
import {
  businessContext,
  customerContext,
  escalationRules,
  knowledgeContext,
  toolsContext,
} from "@/lib/ai/prompt/sections";
import type { KnowledgeResult } from "@/lib/knowledge";
import type { Organization } from "@/lib/organization";
import type { Customer } from "@/lib/types";

export interface PromptContext {
  organization: Organization;
  customer: Customer | null;
  knowledge: KnowledgeResult;
  /** Names of the tools the model may call; empty until the tool layer is enabled */
  tools?: string[];
  now?: Date;
}

/**
 * Builds the system prompt in a fixed order: who you are, then the business, the customer,
 * what is known, what you may do, and when to hand over. Conversation history is passed
 * separately as chat messages rather than being folded in here.
 */
export function assembleSystemPrompt({ organization, customer, knowledge, tools = [], now }: PromptContext): string {
  return [
    CORE_SYSTEM_PROMPT,
    businessContext(organization),
    customerContext(customer, now),
    knowledgeContext(knowledge, now),
    toolsContext(tools),
    escalationRules(organization),
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}
