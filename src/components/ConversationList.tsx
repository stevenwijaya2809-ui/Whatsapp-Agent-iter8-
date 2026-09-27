"use client";

import { useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { InboxToolbar } from "@/components/InboxToolbar";
import { MODE_STYLES } from "@/components/mode";
import { formatListTimestamp, formatWaiting } from "@/lib/format";
import {
  countByFilter,
  filterConversations,
  INBOX_FILTERS,
  sortConversations,
  waitingFor,
  type InboxFilterId,
  type InboxSortId,
} from "@/lib/inbox";
import type { ConversationWithLastMessage } from "@/lib/types";

export type RealtimeStatus = "connecting" | "live" | "offline";

const REALTIME_INDICATOR: Record<RealtimeStatus, { label: string; dot: string }> = {
  connecting: { label: "Connecting", dot: "animate-pulse bg-white/30" },
  live: { label: "Live", dot: "bg-emerald-400" },
  offline: { label: "Offline", dot: "bg-red-400" },
};

/** A human-mode conversation whose latest customer message arrived after it was last opened. */
function isUnread(conversation: ConversationWithLastMessage): boolean {
  const last = conversation.last_message;
  if (conversation.mode !== "human" || last?.role !== "user") return false;
  return !conversation.last_read_at || Date.parse(last.created_at) > Date.parse(conversation.last_read_at);
}

interface ConversationListProps {
  conversations: ConversationWithLastMessage[];
  loading: boolean;
  selectedId: string | null;
  realtimeStatus: RealtimeStatus;
  onSelect: (id: string) => void;
  onShowResults: () => void;
  /** True when the results view is on screen rather than a conversation */
  resultsActive: boolean;
  onSignOut: () => void;
  className?: string;
}

export function ConversationList({
  conversations,
  loading,
  selectedId,
  realtimeStatus,
  onSelect,
  onShowResults,
  resultsActive,
  onSignOut,
  className = "",
}: ConversationListProps) {
  const realtime = REALTIME_INDICATOR[realtimeStatus];
  const [filter, setFilter] = useState<InboxFilterId>("all");
  const [sort, setSort] = useState<InboxSortId>("recent");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => countByFilter(conversations), [conversations]);
  const activeFilterLabel = (INBOX_FILTERS.find((option) => option.id === filter) ?? INBOX_FILTERS[0]).label;
  const visible = useMemo(
    () => sortConversations(filterConversations(conversations, filter, search), sort),
    [conversations, filter, search, sort]
  );

  return (
    // `className` sets the display (e.g. "flex" or "hidden md:flex") so the parent controls visibility
    <aside className={`flex-col border-r border-white/[0.06] bg-[#141414] ${className}`}>
      <header className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm leading-tight font-semibold text-white">WhatsApp AI Agent</h1>
          <p className="mt-0.5 text-xs leading-tight text-white/40">
            {visible.length === conversations.length
              ? `${conversations.length} conversation${conversations.length === 1 ? "" : "s"}`
              : `${visible.length} of ${conversations.length}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-white/40" title="Live updates">
            <span className={`h-1.5 w-1.5 rounded-full ${realtime.dot}`} />
            {realtime.label}
          </span>
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
            title="Sign out"
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </header>

      <button
        type="button"
        onClick={onShowResults}
        aria-current={resultsActive ? "true" : undefined}
        className={`flex w-full items-center gap-3 border-b border-white/[0.06] px-5 py-3 text-left transition-colors ${
          resultsActive ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
        }`}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.06]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/60" aria-hidden>
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        </span>
        <span className={`text-xs font-medium ${resultsActive ? "text-white" : "text-white/70"}`}>Results</span>
      </button>

      <InboxToolbar
        filter={filter}
        sort={sort}
        search={search}
        counts={counts}
        onFilterChange={setFilter}
        onSortChange={setSort}
        onSearchChange={setSearch}
      />

      <nav aria-label="Conversations" className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="px-6 py-12 text-center">
            {loading ? (
              <p className="text-xs text-white/30">Loading conversations…</p>
            ) : conversations.length === 0 ? (
              <>
                <p className="text-sm text-white/40">No conversations yet</p>
                <p className="mt-1 text-xs text-white/25">Messages sent to your WhatsApp number will appear here.</p>
              </>
            ) : (
              <>
                <p className="text-sm text-white/40">
                  {search ? `Nothing matches "${search.trim()}"` : `Nothing under "${activeFilterLabel}"`}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFilter("all");
                    setSearch("");
                  }}
                  className="mt-1 text-xs text-white/40 underline underline-offset-2 hover:text-white/70"
                >
                  Show all conversations
                </button>
              </>
            )}
          </div>
        ) : (
          <ul>
            {visible.map((conversation) => (
              <li key={conversation.id}>
                <ConversationItem
                  conversation={conversation}
                  selected={conversation.id === selectedId}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        )}
      </nav>
    </aside>
  );
}

interface ConversationItemProps {
  conversation: ConversationWithLastMessage;
  selected: boolean;
  onSelect: (id: string) => void;
}

/** Below this, how long a customer has been waiting is not worth the operator's attention. */
const WAITING_WORTH_SHOWING_MS = 30 * 60_000;

const WAITING_TOO_LONG_MS = 4 * 60 * 60_000;

function ConversationItem({ conversation, selected, onSelect }: ConversationItemProps) {
  const unread = !selected && isUnread(conversation);
  const mode = MODE_STYLES[conversation.mode];
  const last = conversation.last_message;
  const waited = waitingFor(conversation);

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      aria-current={selected ? "true" : undefined}
      className={`relative flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors ${
        selected ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
      }`}
    >
      {selected && <span className="absolute top-1/2 left-0 h-8 w-0.5 -translate-y-1/2 rounded-r bg-emerald-500" />}
      <Avatar name={conversation.name} phone={conversation.phone} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`truncate text-sm ${unread ? "font-semibold text-white" : "font-medium text-white/90"}`}>
            {conversation.name || `+${conversation.phone}`}
          </span>
          <span className={`shrink-0 text-[10px] ${unread ? "text-orange-400" : "text-white/30"}`}>
            {formatListTimestamp(last?.created_at ?? conversation.updated_at)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className={`truncate text-xs ${unread ? "text-white/70" : "text-white/40"}`}>
            {last?.content ?? "No messages yet"}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {waited !== null && waited >= WAITING_WORTH_SHOWING_MS && (
              <span
                className={`text-[10px] ${waited >= WAITING_TOO_LONG_MS ? "font-medium text-orange-300" : "text-white/35"}`}
                title="How long the customer has been waiting for a reply"
              >
                waited {formatWaiting(waited)}
              </span>
            )}
            {conversation.needs_human && (
              <span
                className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-amber-300 uppercase"
                title={conversation.escalation_reason ?? "Waiting for a person"}
              >
                Needs you
              </span>
            )}
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium tracking-wide uppercase ${mode.badge}`}>
              {mode.label}
            </span>
            {unread && (
              <>
                <span aria-hidden className="h-2 w-2 rounded-full bg-orange-400" />
                <span className="sr-only">Unread</span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
