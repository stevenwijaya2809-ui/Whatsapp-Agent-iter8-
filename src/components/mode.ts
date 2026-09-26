import type { ConversationMode } from "@/lib/types";

/** Visual language for conversation modes: green for Agent, blue for Draft, orange for Human. */
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
  draft: {
    label: "Draft",
    badge: "bg-sky-500/15 text-sky-400",
    dot: "bg-sky-400",
    hint: "Draft mode: the AI writes a reply and waits for you to approve it.",
    hintStyle: "bg-sky-500/[0.06] text-sky-300/70",
  },
  human: {
    label: "Human",
    badge: "bg-orange-500/15 text-orange-400",
    dot: "bg-orange-400",
    hint: "Human mode: the AI is paused, so replies come from you.",
    hintStyle: "bg-orange-500/[0.06] text-orange-300/70",
  },
};
