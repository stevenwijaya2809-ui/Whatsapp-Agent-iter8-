import "server-only";
import OpenAI from "openai";
import { parseModelOutput, type ReplyAnalysis } from "@/lib/ai/analysis";
import { assembleSystemPrompt } from "@/lib/ai/prompt/assemble";
import { requireEnv } from "@/lib/env";
import { retrieveKnowledge } from "@/lib/knowledge";
import { getOrganization } from "@/lib/organization";
import type { Customer, MessageRole } from "@/lib/types";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  client ??= new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: requireEnv("OPENROUTER_API_KEY"),
    // Keep a slow model within the webhook's background time budget (maxDuration)
    timeout: 25_000,
    maxRetries: 1,
  });
  return client;
}

export interface ReplyRequest {
  /** Conversation history, oldest message first */
  history: { role: MessageRole; content: string }[];
  customer: Customer | null;
}

export interface ReplyResult {
  text: string;
  /** Null when the model ignored the JSON contract; the reply is still usable */
  analysis: ReplyAnalysis | null;
  /** No knowledge entry matched the question, so the reply should have deferred rather than answered */
  knowledgeMiss: boolean;
  knowledgeUsed: number;
}

/**
 * Generates the assistant's next reply. Business facts come from the knowledge base and the
 * organization's settings, never from this file.
 */
export async function generateReply({ history, customer }: ReplyRequest): Promise<ReplyResult> {
  const organization = await getOrganization();
  const question = [...history].reverse().find((message) => message.role === "user")?.content ?? "";
  const knowledge = await retrieveKnowledge(organization.id, question);

  const completion = await getClient().chat.completions.create({
    model: requireEnv("AI_MODEL"),
    messages: [
      { role: "system", content: assembleSystemPrompt({ organization, customer, knowledge }) },
      ...history,
    ],
  });

  const { text, analysis } = parseModelOutput(completion.choices[0]?.message?.content ?? "");
  return { text, analysis, knowledgeMiss: knowledge.miss, knowledgeUsed: knowledge.entries.length };
}
