import "server-only";
import OpenAI from "openai";
import { requireEnv } from "@/lib/env";
import { DENTIST_SYSTEM_PROMPT } from "@/lib/system-prompt";
import type { MessageRole } from "@/lib/types";

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

/** Generates the agent's next reply from the conversation history, oldest message first. */
export async function generateReply(history: { role: MessageRole; content: string }[]): Promise<string> {
  const completion = await getClient().chat.completions.create({
    model: requireEnv("AI_MODEL"),
    messages: [{ role: "system", content: DENTIST_SYSTEM_PROMPT }, ...history],
  });
  return completion.choices[0]?.message?.content ?? "";
}
