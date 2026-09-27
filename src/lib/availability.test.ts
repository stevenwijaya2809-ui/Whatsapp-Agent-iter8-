import { describe, expect, it } from "vitest";
import { durationFor, findFreeSlots, overlaps, type Period } from "@/lib/availability";

const at = (time: string) => new Date(`2026-10-02T${time}:00Z`);
const period = (start: string, end: string): Period => ({ start: at(start), end: at(end) });
const times = (slots: Period[]) => slots.map((slot) => slot.start.toISOString().slice(11, 16));

const day = { openAt: at("09:00"), closeAt: at("12:00"), durationMinutes: 60, now: at("00:00") };

describe("findFreeSlots", () => {
  it("fills the day from opening to closing", () => {
    expect(times(findFreeSlots({ ...day, busy: [] }))).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("never offers a slot that runs past closing", () => {
    const slots = findFreeSlots({ ...day, durationMinutes: 90, busy: [] });
    expect(times(slots)).toEqual(["09:00", "10:30"]);
    expect(slots.at(-1)?.end).toEqual(at("12:00"));
  });

  it("skips slots that clash with an appointment", () => {
    expect(times(findFreeSlots({ ...day, busy: [period("10:00", "11:00")] }))).toEqual(["09:00", "11:00"]);
  });

  it("treats a partial overlap as taken", () => {
    expect(times(findFreeSlots({ ...day, busy: [period("10:30", "10:45")] }))).toEqual(["09:00", "11:00"]);
  });

  it("allows an appointment that ends exactly when the next starts", () => {
    expect(times(findFreeSlots({ ...day, busy: [period("08:00", "09:00")] }))).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("respects the notice period and never offers the past", () => {
    expect(times(findFreeSlots({ ...day, busy: [], now: at("09:30") }))).toEqual(["11:00"]);
  });

  it("can step more finely than the appointment length", () => {
    expect(times(findFreeSlots({ ...day, stepMinutes: 30, busy: [] }))).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"]);
  });

  it("caps how many it returns and copes with a closed day", () => {
    expect(findFreeSlots({ ...day, stepMinutes: 15, busy: [], limit: 3 })).toHaveLength(3);
    expect(findFreeSlots({ ...day, openAt: at("09:00"), closeAt: at("09:00"), busy: [] })).toEqual([]);
    expect(findFreeSlots({ ...day, durationMinutes: 0, busy: [] })).toEqual([]);
  });
});

describe("overlaps", () => {
  it("is true only when the periods actually intersect", () => {
    expect(overlaps(period("09:00", "10:00"), period("09:30", "10:30"))).toBe(true);
    expect(overlaps(period("09:00", "10:00"), period("10:00", "11:00"))).toBe(false);
    expect(overlaps(period("09:00", "10:00"), period("08:00", "09:00"))).toBe(false);
  });
});

describe("durationFor", () => {
  it("matches known services, however they are phrased", () => {
    expect(durationFor("teeth whitening")).toBe(90);
    expect(durationFor("root canal treatment")).toBe(90);
  });

  it("reserves the longer time when a request names two treatments", () => {
    expect(durationFor("Cleaning and check-up")).toBe(45);
    expect(durationFor("consultation about an implant")).toBe(90);
  });

  it("falls back for anything unfamiliar", () => {
    expect(durationFor("something new")).toBe(45);
  });
});
