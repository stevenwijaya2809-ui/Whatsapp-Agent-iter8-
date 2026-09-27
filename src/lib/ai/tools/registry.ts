import "server-only";
import { BOOKING_TOOLS } from "@/lib/ai/tools/booking";
import { failed, type Tool, type ToolContext, type ToolResult } from "@/lib/ai/tools/types";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/organization";
import { getSupabase } from "@/lib/supabase";

/** Tools are off unless AI_TOOLS is "on", so a demo cannot be surprised by an action. */
export function toolsEnabled(): boolean {
  return (process.env.AI_TOOLS ?? "on").toLowerCase() !== "off";
}

const TOOLS: Tool[] = [...BOOKING_TOOLS];

export function availableTools(): Tool[] {
  return toolsEnabled() ? TOOLS : [];
}

export function toolDescriptions(): string[] {
  return availableTools().map((tool) => tool.description);
}

/**
 * Runs a tool the model asked for and records the attempt, successful or not. Anything the
 * tool throws becomes a failed result: the model must be told the truth, not an exception.
 */
export async function runTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const tool = availableTools().find((candidate) => candidate.name === name);
  if (!tool) return record(name, args, failed(`unknown tool "${name}"`), context, 0);

  const startedAt = Date.now();
  let result: ToolResult;
  try {
    result = await tool.run(args, context);
  } catch (error) {
    result = failed(error instanceof Error ? error.message : String(error));
  }
  return record(name, args, result, context, Date.now() - startedAt);
}

async function record(
  tool: string,
  args: Record<string, unknown>,
  result: ToolResult,
  context: ToolContext,
  durationMs: number
): Promise<ToolResult> {
  const { error } = await getSupabase().from("tool_calls").insert({
    organization_id: DEFAULT_ORGANIZATION_ID,
    conversation_id: context.conversationId,
    tool,
    arguments: args,
    result: result.ok ? result.data : null,
    status: result.ok ? "ok" : "failed",
    error: result.ok ? null : result.error,
    duration_ms: durationMs,
  });
  if (error) console.error("Failed to record tool call:", error.message);
  return result;
}
