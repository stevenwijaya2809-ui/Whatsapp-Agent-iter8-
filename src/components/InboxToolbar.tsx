"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { INBOX_FILTERS, INBOX_SORTS, type InboxFilterId, type InboxSortId } from "@/lib/inbox";

interface InboxToolbarProps {
  filter: InboxFilterId;
  sort: InboxSortId;
  search: string;
  counts: Record<InboxFilterId, number>;
  onFilterChange: (filter: InboxFilterId) => void;
  onSortChange: (sort: InboxSortId) => void;
  onSearchChange: (search: string) => void;
}

/**
 * Search, filter and sort for the inbox. Filtering and sorting are occasional triage tools, so
 * they sit behind two buttons that always say what is currently applied, rather than a row of
 * pills that cannot fit. The one count that means "there is work" gets a line of its own.
 */
export function InboxToolbar({ filter, sort, search, counts, onFilterChange, onSortChange, onSearchChange }: InboxToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const activeFilter = INBOX_FILTERS.find((option) => option.id === filter) ?? INBOX_FILTERS[0];
  const activeSort = INBOX_SORTS.find((option) => option.id === sort) ?? INBOX_SORTS[0];
  const filtering = filter !== "all";
  const needingPerson = counts.needs_person;

  // "/" jumps to search, the way it does in every tool an operator already uses
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.key !== "/" || typing || event.metaKey || event.ctrlKey) return;
      // On a phone the list is hidden behind the open conversation; focusing it would do nothing
      if (!searchRef.current?.offsetParent) return;
      event.preventDefault();
      searchRef.current.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="border-b border-white/[0.06]">
      <div className="px-3 pt-2.5">
        {/* The icon and the clear button centre on the input itself, not on the padded row */}
        <div className="relative">
          <SearchIcon />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              if (search) onSearchChange("");
              else searchRef.current?.blur();
            }}
            placeholder="Search conversations"
            aria-label="Search conversations by name, number or message"
            className="w-full rounded-lg border border-white/10 bg-white/[0.04] py-1.5 pr-8 pl-8 text-xs text-white placeholder:text-white/30 focus:border-white/25 focus:bg-white/[0.06] focus:outline-none"
          />
          {search ? (
            <button
              type="button"
              onClick={() => {
                onSearchChange("");
                searchRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-white/40 hover:text-white"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <kbd aria-hidden className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-white/10 px-1 font-sans text-[10px] text-white/25">
              /
            </kbd>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <Menu
          label={activeFilter.label}
          badge={filtering ? counts[filter] : undefined}
          active={filtering}
          title="Filter conversations"
          selectedId={filter}
          onSelect={(id) => onFilterChange(id as InboxFilterId)}
          options={INBOX_FILTERS.map((option) => ({
            id: option.id,
            label: option.label,
            hint: option.hint,
            count: counts[option.id],
          }))}
          icon={
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M3 5h18M6 12h12M10 19h4" />
            </svg>
          }
        />

        <Menu
          label={activeSort.short}
          align="right"
          title="Sort conversations"
          selectedId={sort}
          onSelect={(id) => onSortChange(id as InboxSortId)}
          options={INBOX_SORTS.map((option) => ({
            id: option.id,
            label: option.label,
          }))}
          icon={
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7 4v16M7 20l-3-3M17 20V4M17 4l3 3" />
            </svg>
          }
        />

        {(filtering || search) && (
          <button
            type="button"
            onClick={() => {
              onFilterChange("all");
              onSearchChange("");
            }}
            className="ml-auto shrink-0 text-[11px] text-white/40 underline underline-offset-2 transition-colors hover:text-white/75"
          >
            Reset
          </button>
        )}
      </div>

      {needingPerson > 0 && (
        <button
          type="button"
          onClick={() => onFilterChange(filter === "needs_person" ? "all" : "needs_person")}
          aria-pressed={filter === "needs_person"}
          className={`flex w-full items-center gap-2 border-t px-3 py-2 text-left text-[11px] transition-colors ${
            filter === "needs_person" ? "border-amber-500/25 bg-amber-500/[0.12] text-amber-200" : "border-white/[0.06] bg-amber-500/[0.06] text-amber-300/90 hover:bg-amber-500/[0.1]"
          }`}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
          <span className="flex-1 font-medium">
            {needingPerson} conversation{needingPerson === 1 ? "" : "s"} need
            {needingPerson === 1 ? "s" : ""} a person
          </span>
          <span className="text-amber-300/60">{filter === "needs_person" ? "Show all" : "Show"}</span>
        </button>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-white/35"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

interface MenuOption {
  id: string;
  label: string;
  hint?: string;
  /** Shown beside the label, dimmed when there is nothing to show */
  count?: number;
}

interface MenuProps {
  label: string;
  icon: ReactNode;
  title: string;
  options: MenuOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  badge?: number;
  active?: boolean;
  align?: "left" | "right";
}

/** A button that says what is currently applied, and opens the alternatives beneath it. */
function Menu({ label, icon, title, options, selectedId, onSelect, badge, active = false, align = "left" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const items = [...(wrapperRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
        if (items.length === 0) return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const step = event.key === "ArrowDown" ? 1 : -1;
        items[(current + step + items.length) % items.length].focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, close]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${
          active ? "border-white/20 bg-white/[0.1] text-white" : "border-white/10 bg-white/[0.04] text-white/65 hover:bg-white/[0.08] hover:text-white"
        }`}
      >
        <span className={active ? "text-white/70" : "text-white/40"}>{icon}</span>
        {label}
        {badge !== undefined && <span className="text-white/45">{badge}</span>}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-white/35">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={title}
          className={`absolute top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-white/10 bg-[#1c1c1c] py-1 shadow-xl shadow-black/40 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {options.map((option) => {
            const selected = option.id === selectedId;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                title={option.hint}
                onClick={() => {
                  onSelect(option.id);
                  close();
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors ${
                  selected ? "bg-white/[0.07] text-white" : "text-white/65 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className={selected ? "text-emerald-400" : "text-transparent"}
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                <span className="flex-1">{option.label}</span>
                {option.count !== undefined && <span className={option.count === 0 ? "text-white/20" : "text-white/45"}>{option.count}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
