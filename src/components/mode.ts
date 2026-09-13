import type { ConversationMode } from "@/lib/types";

/** Visual language for conversation modes: green for Agent, orange for Human. */
export const MODE_STYLES: Record<
  ConversationMode,
  { label: string; badge: string; dot: string; hint: string; hintStyle: string }
> = {
  agent: {
    label: "Agent",
    badge: "bg-emerald-500/15 text-emerald-400",
    dot: "bg-emerald-400",
    hint: "Agent mode: the AI replies to new messages automatically.",
    hintStyle: "bg-emerald-500/[0.06] text-emerald-300/70",
  },
  human: {
    label: "Human",
    badge: "bg-orange-500/15 text-orange-400",
    dot: "bg-orange-400",
    hint: "Human mode: the AI is paused, so replies come from you.",
    hintStyle: "bg-orange-500/[0.06] text-orange-300/70",
  },
};
