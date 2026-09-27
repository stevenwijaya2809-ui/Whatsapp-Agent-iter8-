import "server-only";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { parseModelOutput, type ReplyAnalysis } from "@/lib/ai/analysis";
import { assembleSystemPrompt } from "@/lib/ai/prompt/assemble";
import { runTool, toolDescriptions } from "@/lib/ai/tools/registry";
import { requireEnv } from "@/lib/env";
import { retrieveKnowledge } from "@/lib/knowledge";
import { getOrganization } from "@/lib/organization";
import type { Customer, MessageRole } from "@/lib/types";

/** How many actions the model may take before it must answer. Stops a loop running away. */
const MAX_TOOL_ROUNDS = 2;

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
  conversationId: string;
}

export interface ToolOutcome {
  tool: string;
  ok: boolean;
  error?: string;
  /** A short reason the tool reported, such as why it handed the conversation over */
  detail?: string;
}

export interface ReplyResult {
  text: string;
  /** Null when the model ignored the JSON contract; the reply is still usable */
  analysis: ReplyAnalysis | null;
  /** No knowledge entry matched the question, so the reply should have deferred rather than answered */
  knowledgeMiss: boolean;
  knowledgeUsed: number;
  toolsUsed: ToolOutcome[];
  /** An action was attempted and did not succeed, so a person should pick this up */
  toolFailed: boolean;
}

/**
 * Produces the assistant's next reply, letting it take actions first. Business facts come from
 * the knowledge base and the organization's settings; anything the reply claims about an action
 * comes only from the result of a tool that actually ran.
 */
export async function generateReply({ history, customer, conversationId }: ReplyRequest): Promise<ReplyResult> {
  const now = new Date();
  const organization = await getOrganization();
  const question = [...history].reverse().find((message) => message.role === "user")?.content ?? "";
  const knowledge = await retrieveKnowledge(organization.id, question);
  const tools = toolDescriptions();

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: assembleSystemPrompt({ organization, customer, knowledge, tools, now }) },
    ...history,
  ];

  const toolsUsed: ToolOutcome[] = [];
  let parsed = parseModelOutput("");

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const completion = await getClient().chat.completions.create({
      model: requireEnv("AI_MODEL"),
      messages,
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    parsed = parseModelOutput(raw);

    if (!parsed.action || tools.length === 0 || round === MAX_TOOL_ROUNDS) break;

    const result = await runTool(parsed.action.tool, parsed.action.arguments, {
      organization,
      conversationId,
      customer,
      now,
    });
    toolsUsed.push({
      tool: parsed.action.tool,
      ok: result.ok,
      ...(result.ok
        ? typeof result.data.reason === "string" && { detail: result.data.reason }
        : { error: result.error }),
    });

    // Feed the real result back so the reply can only repeat what happened
    messages.push({ role: "assistant", content: raw });
    messages.push({ role: "system", content: `Result of ${parsed.action.tool}: ${JSON.stringify(result)}` });
  }

  return {
    text: parsed.text,
    analysis: parsed.analysis,
    knowledgeMiss: knowledge.miss,
    knowledgeUsed: knowledge.entries.length,
    toolsUsed,
    toolFailed: toolsUsed.some((outcome) => !outcome.ok),
  };
}
