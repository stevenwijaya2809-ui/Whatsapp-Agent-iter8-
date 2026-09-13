"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { ConversationList, type RealtimeStatus } from "@/components/ConversationList";
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

  /** Reloads the conversation list, coalescing bursts of realtime events into one request. */
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

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    const channel = supabase
      .channel("dashboard")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const message = payload.new as Message;
        if (message.conversation_id === selectedIdRef.current) {
          setMessages((current) => mergeMessages(current, [message]));
          // The operator is looking at this conversation, so the new message counts as read
          if (message.role === "user" && document.visibilityState === "visible") {
            markRead(message.conversation_id);
          }
        }
        scheduleRefresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, scheduleRefresh)
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
    setSelectedId(id);
    setMessages([]);
    setLoadingMessages(true);
    markRead(id);
  }

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

  return (
    <main className="flex h-dvh overflow-hidden">
      <ConversationList
        conversations={conversations}
        loading={loadingConversations}
        selectedId={selectedId}
        realtimeStatus={realtimeStatus}
        onSelect={selectConversation}
        className={`w-full md:flex md:w-80 md:shrink-0 ${selected ? "hidden" : "flex"}`}
      />

      {selected ? (
        <ChatPanel
          key={selected.id}
          conversation={selected}
          messages={messages}
          loading={loadingMessages}
          onBack={() => setSelectedId(null)}
          onModeChange={(mode) => changeMode(selected.id, mode)}
          onSend={(text) => sendMessage(selected.id, text)}
          className="flex-1"
        />
      ) : (
        <div className="hidden flex-1 flex-col items-center justify-center gap-4 md:flex">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-white/40">Select a conversation</p>
            <p className="mt-1 text-xs text-white/20">Choose a chat from the list to read and reply</p>
          </div>
        </div>
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
