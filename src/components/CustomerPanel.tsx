"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { formatListTimestamp } from "@/lib/format";
import type { Appointment, Customer, CustomerStatus, Note } from "@/lib/types";

const STATUSES: CustomerStatus[] = [
  "NEW",
  "LEAD",
  "QUALIFIED",
  "BOOKED",
  "ACTIVE_CUSTOMER",
  "RETURNING_CUSTOMER",
  "INACTIVE",
];

const APPOINTMENT_STATUS_STYLES: Record<string, string> = {
  booked: "text-emerald-300",
  rescheduled: "text-sky-300",
  requested: "text-white/50",
  completed: "text-white/50",
  cancelled: "text-white/35 line-through",
  no_show: "text-orange-300",
};

interface ConversationContext {
  customer: Customer | null;
  upcoming: Appointment[];
  past: Appointment[];
  notes: Note[];
  messageCount: number;
}

interface CustomerPanelProps {
  conversationId: string;
  /** Changes whenever the conversation does, so the panel picks up new appointments */
  reloadKey: number;
  onClose: () => void;
  className?: string;
}

/** What the operator needs to know about the person they are replying to, and the few things they do about it. */
export function CustomerPanel({ conversationId, reloadKey, onClose, className = "" }: CustomerPanelProps) {
  const [context, setContext] = useState<ConversationContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () => fetchContext(conversationId).then(setContext),
    [conversationId]
  );

  // Reloaded whenever the conversation changes, so a booking the assistant just made shows up
  useEffect(() => {
    let cancelled = false;
    fetchContext(conversationId)
      .then((loaded) => {
        if (cancelled) return;
        setContext(loaded);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, reloadKey]);

  const customer = context?.customer ?? null;

  return (
    <aside className={`w-80 shrink-0 flex-col overflow-y-auto border-l border-white/[0.06] bg-[#141414] ${className}`}>
      <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <h2 className="text-xs font-semibold tracking-wide text-white/50 uppercase">Customer</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close customer panel"
          className="rounded p-1 text-white/40 hover:bg-white/[0.06] hover:text-white xl:hidden"
        >
          ✕
        </button>
      </header>

      {error && (
        <p role="alert" className="px-4 py-3 text-xs text-red-300">
          {error}
        </p>
      )}

      {!context && !error && <p className="px-4 py-6 text-xs text-white/30">Loading…</p>}

      {context && !customer && (
        <p className="px-4 py-6 text-xs text-white/40">
          This conversation started before customer records existed. It gains one on the next message.
        </p>
      )}

      {context && customer && (
        <div className="divide-y divide-white/[0.06]">
          <section className="px-4 py-4">
            <div className="flex items-center gap-3">
              <Avatar name={customer.name} phone={customer.phone} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{customer.name || `+${customer.phone}`}</p>
                <p className="truncate text-xs text-white/40">+{customer.phone}</p>
              </div>
            </div>

            <label className="mt-3 block">
              <span className="text-[11px] text-white/40">Status</span>
              <select
                value={customer.status}
                onChange={async (event) => {
                  const status = event.target.value as CustomerStatus;
                  setContext({ ...context, customer: { ...customer, status } });
                  await patchCustomer(customer.id, { status }, setError, load);
                }}
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white focus:border-white/25 focus:outline-none"
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status} className="bg-[#141414]">
                    {status.replace(/_/g, " ").toLowerCase()}
                  </option>
                ))}
              </select>
            </label>

            <TagEditor customer={customer} onChanged={load} onError={setError} />
          </section>

          <section className="grid grid-cols-2 gap-y-2 px-4 py-3 text-xs">
            <Fact label="First contact" value={formatListTimestamp(customer.first_contact_at)} />
            <Fact
              label="Last message"
              value={customer.last_interaction_at ? formatListTimestamp(customer.last_interaction_at) : "—"}
            />
            <Fact label="Messages" value={String(context.messageCount)} />
            <Fact label="Visits" value={String(context.past.filter((a) => a.status === "completed").length)} />
          </section>

          <section className="px-4 py-3">
            <h3 className="text-[11px] font-medium tracking-wide text-white/40 uppercase">Appointments</h3>
            {context.upcoming.length === 0 ? (
              <p className="mt-1.5 text-xs text-white/30">Nothing booked</p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {context.upcoming.map((appointment) => (
                  <li key={appointment.id} className="text-xs">
                    <span className="text-white/80">{appointment.service}</span>
                    <span className="text-white/40"> · {formatAppointment(appointment.starts_at)}</span>
                    <span className={`ml-1 ${APPOINTMENT_STATUS_STYLES[appointment.status] ?? "text-white/40"}`}>
                      {appointment.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {context.past.length > 0 && (
              <p className="mt-2 text-[11px] text-white/30">
                {context.past.length} earlier appointment{context.past.length === 1 ? "" : "s"}, last{" "}
                {formatListTimestamp(context.past[0].starts_at)}
              </p>
            )}
          </section>

          <NotesSection conversationId={conversationId} notes={context.notes} onAdded={load} onError={setError} />
        </div>
      )}
    </aside>
  );
}

async function fetchContext(conversationId: string): Promise<ConversationContext> {
  const response = await fetch(`/api/conversations/${conversationId}/context`, { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? `Request failed with status ${response.status}`);
  return data as ConversationContext;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-white/40">{label}</p>
      <p className="text-white/80">{value}</p>
    </div>
  );
}

function TagEditor({
  customer,
  onChanged,
  onError,
}: {
  customer: Customer;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [tag, setTag] = useState("");

  return (
    <div className="mt-3">
      <p className="text-[11px] text-white/40">Tags</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {customer.tags.length === 0 && <span className="text-xs text-white/30">None yet</span>}
        {customer.tags.map((existing) => (
          <span key={existing} className="rounded bg-white/[0.07] px-1.5 py-0.5 text-[11px] text-white/70">
            {existing}
          </span>
        ))}
      </div>
      <form
        className="mt-1.5 flex gap-1.5"
        onSubmit={async (event) => {
          event.preventDefault();
          const value = tag.trim();
          if (!value) return;
          setTag("");
          await patchCustomer(customer.id, { tag: value }, onError, onChanged);
        }}
      >
        <input
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          placeholder="Add a tag"
          aria-label="Add a tag"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-white placeholder:text-white/30 focus:border-white/25 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!tag.trim()}
          className="rounded-lg border border-white/10 px-2 py-1 text-xs text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
        >
          Add
        </button>
      </form>
    </div>
  );
}

function NotesSection({
  conversationId,
  notes,
  onAdded,
  onError,
}: {
  conversationId: string;
  notes: Note[];
  onAdded: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error ?? `Request failed with status ${response.status}`);
      setBody("");
      await onAdded();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="px-4 py-3">
      <h3 className="text-[11px] font-medium tracking-wide text-white/40 uppercase">Notes</h3>
      <form onSubmit={save} className="mt-1.5">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={2}
          placeholder="Something worth remembering"
          aria-label="Add a note"
          className="w-full resize-none rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white placeholder:text-white/30 focus:border-white/25 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!body.trim() || saving}
          className="mt-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-xs font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
        >
          {saving ? "Saving…" : "Add note"}
        </button>
      </form>
      <ul className="mt-3 space-y-2">
        {notes.length === 0 && <li className="text-xs text-white/30">No notes yet</li>}
        {notes.map((note) => (
          <li key={note.id} className="rounded-lg bg-white/[0.04] px-2.5 py-2">
            <p className="text-xs leading-relaxed whitespace-pre-wrap text-white/75">{note.body}</p>
            <p className="mt-1 text-[10px] text-white/30">
              {note.author === "ai" ? "AI" : "You"} · {formatListTimestamp(note.created_at)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function patchCustomer(
  customerId: string,
  changes: { status?: CustomerStatus; tag?: string },
  onError: (message: string) => void,
  reload: () => Promise<void>
) {
  try {
    const response = await fetch(`/api/customers/${customerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error ?? `Request failed with status ${response.status}`);
    await reload();
  } catch (e) {
    onError(e instanceof Error ? e.message : String(e));
    await reload().catch(() => {});
  }
}

function formatAppointment(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
