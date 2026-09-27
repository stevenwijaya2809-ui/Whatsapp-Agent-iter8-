"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { ConversationList, type RealtimeStatus } from "@/components/ConversationList";
import { CustomerPanel } from "@/components/CustomerPanel";
import { ResultsSummary } from "@/components/ResultsSummary";
import { DASHBOARD_CHANNEL, DASHBOARD_EVENT } from "@/lib/realtime-channel";
import { getBrowserSupabase, isRealtimeConfigured } from "@/lib/supabase-browser";
import type { ConversationMode, ConversationWithLastMessage, Message } from "@/lib/types";

/** Calls a dashboard API route and returns its JSON, throwing the route's error message on failure. */
async function api<T>(url: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Your session has expired");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
  return data as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Merges messages by ID, in chronological order. */
function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

export default function Dashboard() {
  const [conversations, setConversations] = useState<ConversationWithLastMessage[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesReloadKey, setMessagesReloadKey] = useState(0);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>(isRealtimeConfigured ? "connecting" : "offline");
  const [error, setError] = useState<string | null>(null);
  /** On phones the results replace the list; on wider screens they always sit beside it */
  const [showResults, setShowResults] = useState(false);
  /** The customer panel is always there on wide screens, and opens over the chat on narrow ones */
  const [showContext, setShowContext] = useState(false);

  // Latest selection, for callbacks that outlive the render they were created in
  const selectedIdRef = useRef<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await api<ConversationWithLastMessage[]>("/api/conversations"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  /** Reloads the conversation list, coalescing bursts of update pings into one request. */
  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(loadConversations, 300);
  }, [loadConversations]);

  const markRead = useCallback((id: string) => {
    const now = new Date().toISOString();
    setConversations((current) => current.map((c) => (c.id === id ? { ...c, last_read_at: now } : c)));
    api(`/api/conversations/${id}`, { method: "PATCH", body: { read: true } }).catch((e) =>
      console.error("Failed to mark conversation as read:", e)
    );
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;

    api<Message[]>(`/api/conversations/${selectedId}/messages`)
      .then((data) => {
        if (!cancelled) setMessages((current) => mergeMessages(current, data));
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, messagesReloadKey]);

  // The server sends a ping whenever a conversation changes; the data itself is
  // always loaded through the authenticated API, never straight from the database.
  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    const channel = supabase
      .channel(DASHBOARD_CHANNEL)
      .on("broadcast", { event: DASHBOARD_EVENT }, ({ payload }) => {
        const conversationId = (payload as { conversationId?: string } | null)?.conversationId;
        if (conversationId && conversationId === selectedIdRef.current) {
          setMessagesReloadKey((key) => key + 1);
          // The operator is looking at this conversation, so its new messages count as read
          if (document.visibilityState === "visible") markRead(conversationId);
        }
        scheduleRefresh();
      })
      .subscribe((status) => {
        const live = status === "SUBSCRIBED";
        setRealtimeStatus(live ? "live" : "offline");
        if (live) {
          // Catch up on anything that changed while disconnected
          scheduleRefresh();
          setMessagesReloadKey((key) => key + 1);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [markRead, scheduleRefresh]);

  function selectConversation(id: string) {
    if (id === selectedId) return;
    setShowResults(false);
    setSelectedId(id);
    setMessages([]);
    setLoadingMessages(true);
    markRead(id);
  }

  // Escape leaves a conversation and lands back on the results
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.key === "Escape" && !typing) setSelectedId(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function changeMode(id: string, mode: ConversationMode) {
    const previous = conversations.find((c) => c.id === id)?.mode;
    setConversations((current) => current.map((c) => (c.id === id ? { ...c, mode } : c)));
    try {
      await api(`/api/conversations/${id}`, { method: "PATCH", body: { mode } });
    } catch (e) {
      if (previous) {
        setConversations((current) => current.map((c) => (c.id === id ? { ...c, mode: previous } : c)));
      }
      setError(`Couldn't switch to ${mode} mode: ${errorMessage(e)}`);
    }
  }

  async function sendMessage(id: string, text: string): Promise<string | null> {
    try {
      const message = await api<Message>(`/api/conversations/${id}/send`, {
        method: "POST",
        body: { message: text },
      });
      if (selectedIdRef.current === id) setMessages((current) => mergeMessages(current, [message]));
      scheduleRefresh();
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  }

  async function discardDraft(id: string) {
    setConversations((current) =>
      current.map((c) => (c.id === id ? { ...c, draft_reply: null, draft_created_at: null } : c))
    );
    try {
      await api(`/api/conversations/${id}`, { method: "PATCH", body: { discardDraft: true } });
    } catch (e) {
      setError(`Couldn't discard the draft: ${errorMessage(e)}`);
      scheduleRefresh();
    }
  }

  /** Closes a hand-over. The reason and briefing stay on the record; only the flag is cleared. */
  async function resolveHandover(id: string) {
    setConversations((current) => current.map((c) => (c.id === id ? { ...c, needs_human: false } : c)));
    try {
      await api(`/api/conversations/${id}`, { method: "PATCH", body: { resolve: true } });
    } catch (e) {
      setError(`Couldn't mark this as handled: ${errorMessage(e)}`);
      scheduleRefresh();
    }
  }

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <main className="relative flex h-dvh overflow-hidden">
      <ConversationList
        conversations={conversations}
        loading={loadingConversations}
        selectedId={selectedId}
        realtimeStatus={realtimeStatus}
        onSelect={selectConversation}
        onShowResults={() => {
          setSelectedId(null);
          setShowResults(true);
        }}
        resultsActive={!selected}
        onSignOut={signOut}
        className={`w-full md:flex md:w-80 md:shrink-0 ${selected || showResults ? "hidden md:flex" : "flex"}`}
      />

      {selected ? (
        <>
          <ChatPanel
            key={selected.id}
            conversation={selected}
            messages={messages}
            loading={loadingMessages}
            onBack={() => setSelectedId(null)}
            onModeChange={(mode) => changeMode(selected.id, mode)}
            onSend={(text) => sendMessage(selected.id, text)}
            onDiscardDraft={() => discardDraft(selected.id)}
            onResolve={() => resolveHandover(selected.id)}
            onToggleContext={() => setShowContext((open) => !open)}
            className="flex-1"
          />
          <CustomerPanel
            key={`context-${selected.id}`}
            conversationId={selected.id}
            reloadKey={messagesReloadKey}
            onClose={() => setShowContext(false)}
            className={
              showContext ? "absolute inset-y-0 right-0 z-10 flex shadow-2xl xl:static xl:shadow-none" : "hidden xl:flex"
            }
          />
        </>
      ) : (
        <ResultsSummary
          onBack={() => setShowResults(false)}
          className={`flex-1 ${showResults ? "block" : "hidden md:block"}`}
        />
      )}

      {error && (
        <div
          role="alert"
          className="fixed top-4 left-1/2 z-10 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-start gap-3 rounded-lg border border-red-500/30 bg-[#2a1414] px-4 py-3 text-xs text-red-200 shadow-lg"
        >
          <p className="flex-1 break-words">{error}</p>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="text-red-300/70 hover:text-red-100">
            ✕
          </button>
        </div>
      )}
    </main>
  );
}
