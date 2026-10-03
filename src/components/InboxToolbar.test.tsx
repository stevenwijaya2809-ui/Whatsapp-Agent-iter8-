import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InboxToolbar } from "@/components/InboxToolbar";
import type { InboxFilterId } from "@/lib/inbox";

const noop = () => {};

const counts = (overrides: Partial<Record<InboxFilterId, number>> = {}): Record<InboxFilterId, number> => ({
  all: 12,
  needs_person: 0,
  waiting: 3,
  drafts: 2,
  bookings: 4,
  complaints: 1,
  leads: 2,
  ai_handled: 6,
  ...overrides,
});

const render = (props: Partial<Parameters<typeof InboxToolbar>[0]> = {}) =>
  renderToStaticMarkup(
    <InboxToolbar
      filter="all"
      sort="recent"
      search=""
      counts={counts()}
      onFilterChange={noop}
      onSortChange={noop}
      onSearchChange={noop}
      {...props}
    />
  );

describe("InboxToolbar", () => {
  it("says what is currently applied on the buttons themselves", () => {
    const markup = render({ filter: "complaints", sort: "waiting", counts: counts({ complaints: 1 }) });
    expect(markup).toContain(">Complaints");
    expect(markup).toContain(">Waiting");
  });

  it("keeps the options out of the way until asked for", () => {
    // Closed menus: the seven filters must not crowd the rail
    expect(render()).not.toContain('role="menu"');
    expect(render()).not.toContain("New leads");
    expect(render()).toContain('aria-haspopup="menu"');
  });

  it("raises a line of its own only when somebody is waiting for a person", () => {
    expect(render()).not.toContain("a person");
    expect(render({ counts: counts({ needs_person: 3 }) })).toContain("3 conversations need a person");
  });

  it("counts one conversation in the singular", () => {
    expect(render({ counts: counts({ needs_person: 1 }) })).toContain("1 conversation needs a person");
  });

  it("offers a way back only once something is applied", () => {
    expect(render()).not.toContain("Reset");
    expect(render({ filter: "bookings" })).toContain("Reset");
    expect(render({ search: "dewi" })).toContain("Reset");
  });

  it("swaps the keyboard hint for a way to clear the search", () => {
    const empty = render();
    expect(empty).toContain("<kbd");
    expect(empty).not.toContain("Clear search");

    const searching = render({ search: "dewi" });
    expect(searching).toContain("Clear search");
    expect(searching).not.toContain("<kbd");
  });

  it("marks the filter button as active, with its count, only while filtering", () => {
    expect(render()).not.toContain("border-white/20 bg-white/[0.1]");
    expect(render({ filter: "waiting" })).toContain("border-white/20 bg-white/[0.1]");
  });
});
