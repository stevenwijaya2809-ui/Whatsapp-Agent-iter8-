"use client";

import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Avatar } from "@/components/Avatar";
import { MODE_STYLES } from "@/components/mode";
import { formatDayLabel, formatTime, isSameDay } from "@/lib/format";
import type { Conversation, ConversationMode, Message } from "@/lib/types";

interface ChatPanelProps {
  conversation: Conversation;
  messages: Message[];
  loading: boolean;
  onBack: () => void;
  onModeChange: (mode: ConversationMode) => void;
  /** Sends a manual message. Resolves to an error message, or null on success. */
  onSend: (text: string) => Promise<string | null>;
  className?: string;
}

export function ChatPanel({
  conversation,
  messages,
  loading,
  onBack,
  onModeChange,
  onSend,
  className = "",
}: ChatPanelProps) {
  const mode = MODE_STYLES[conversation.mode];
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [messages]);

  return (
    <section className={`flex min-w-0 flex-col ${className}`}>
      <header className="flex items-center gap-3 border-b border-white/[0.06] bg-[#141414] px-4 py-3 md:px-6">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="-ml-1 rounded-lg p-1.5 text-white/60 hover:bg-white/[0.06] hover:text-white md:hidden"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <Avatar name={conversation.name} phone={conversation.phone} size="sm" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm leading-tight font-semibold text-white">
            {conversation.name || `+${conversation.phone}`}
          </h2>
          <p className="mt-0.5 truncate text-xs leading-tight text-white/40">
            {conversation.name ? `+${conversation.phone}` : "WhatsApp contact"}
          </p>
        </div>
        <ModeToggle mode={conversation.mode} onChange={onModeChange} />
      </header>
      <p className={`px-4 py-1.5 text-center text-[11px] md:px-6 ${mode.hintStyle}`}>{mode.hint}</p>

      <div ref={scrollerRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-5 md:px-6">
        {messages.length === 0 ? (
          <p className="py-12 text-center text-xs text-white/30">{loading ? "Loading messages…" : "No messages yet"}</p>
        ) : (
          messages.map((message, i) => (
            <Fragment key={message.id}>
              {(i === 0 || !isSameDay(messages[i - 1].created_at, message.created_at)) && (
                <div className="flex justify-center py-2">
                  <span className="rounded-full bg-white/[0.06] px-3 py-1 text-[10px] font-medium text-white/40">
                    {formatDayLabel(message.created_at)}
                  </span>
                </div>
              )}
              <MessageBubble message={message} />
            </Fragment>
          ))
        )}
      </div>

      <Composer mode={conversation.mode} onSend={onSend} />
    </section>
  );
}

function ModeToggle({ mode, onChange }: { mode: ConversationMode; onChange: (mode: ConversationMode) => void }) {
  return (
    <div role="group" aria-label="Reply mode" className="flex shrink-0 rounded-lg border border-white/10 bg-white/[0.04] p-0.5 text-xs font-medium">
      {(["agent", "human"] as const).map((option) => {
        const active = option === mode;
        const style = MODE_STYLES[option];
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (!active) onChange(option);
            }}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 transition-colors ${
              active ? style.badge : "text-white/40 hover:text-white/70"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${active ? style.dot : "bg-white/20"}`} />
            {style.label}
          </button>
        );
      })}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const fromCustomer = message.role === "user";
  const byHuman = message.sent_by === "human";
  const bubble = fromCustomer
    ? "rounded-tl-sm border border-white/[0.06] bg-white/[0.07] text-white/90"
    : byHuman
      ? "rounded-tr-sm bg-orange-700 text-white"
      : "rounded-tr-sm bg-emerald-700 text-white";

  return (
    <div className={`flex ${fromCustomer ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed md:max-w-[65%] ${bubble}`}>
        <p className="break-words whitespace-pre-wrap">{message.content}</p>
        <p className={`mt-1 text-right text-[10px] ${fromCustomer ? "text-white/35" : "text-white/80"}`}>
          {!fromCustomer && <span className="font-medium">{byHuman ? "You" : "AI"} · </span>}
          {formatTime(message.created_at)}
        </p>
      </div>
    </div>
  );
}

function Composer({ mode, onSend }: { mode: ConversationMode; onSend: (text: string) => Promise<string | null> }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }

  async function send() {
    const message = text.trim();
    if (!message || sending) return;

    setSending(true);
    setError(null);
    const sendError = await onSend(message);
    setSending(false);

    if (sendError) {
      setError(sendError);
    } else {
      setText("");
      requestAnimationFrame(resize);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  return (
    <div className="border-t border-white/[0.06] bg-[#141414] px-4 py-3 md:px-6">
      {error && (
        <p role="alert" className="mb-2 text-xs text-red-400">
          {error}
        </p>
      )}
      <div className="flex items-end gap-3 rounded-xl border border-white/[0.06] bg-white/[0.06] px-4 py-1.5 transition-colors focus-within:border-emerald-500/40">
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            resize();
          }}
          onKeyDown={handleKeyDown}
          aria-label="Message"
          placeholder={mode === "human" ? "Type a reply…" : "Send a manual message (the AI is also replying)…"}
          className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm text-white/90 placeholder:text-white/25 focus:outline-none"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          aria-label="Send message"
          className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-30"
        >
          {sending ? (
            <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
      <p className="mt-1.5 hidden text-[10px] text-white/25 md:block">Enter to send · Shift+Enter for a new line</p>
    </div>
  );
}
