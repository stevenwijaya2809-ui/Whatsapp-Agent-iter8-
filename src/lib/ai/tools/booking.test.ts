import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@/lib/ai/tools/types";
import type { Organization } from "@/lib/organization";
import type { Appointment, Customer } from "@/lib/types";

// Hoisted so the module mocks below can reference them without a temporal dead zone
const mocks = vi.hoisted(() => ({
  createAppointment: vi.fn(),
  getBusyPeriods: vi.fn(),
  getUpcomingAppointments: vi.fn(),
  updateAppointment: vi.fn(),
  getAvailability: vi.fn(),
  escalateConversation: vi.fn(),
}));

vi.mock("@/lib/appointments", () => ({
  createAppointment: mocks.createAppointment,
  getBusyPeriods: mocks.getBusyPeriods,
  getUpcomingAppointments: mocks.getUpcomingAppointments,
  updateAppointment: mocks.updateAppointment,
  getAvailability: mocks.getAvailability,
}));

vi.mock("@/lib/conversations", () => ({ escalateConversation: mocks.escalateConversation }));

const { createAppointment, getBusyPeriods, getUpcomingAppointments, updateAppointment, escalateConversation } = mocks;

const { BOOKING_TOOLS } = await import("@/lib/ai/tools/booking");
const tool = (name: string) => {
  const found = BOOKING_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no tool named ${name}`);
  return found;
};

const organization: Organization = {
  id: "org-1",
  name: "Senyum Dental Studio",
  timezone: "Asia/Jakarta",
  business: { name: "Senyum Dental Studio", hours: { Mon: [9, 18], Tue: [9, 18], Sat: [9, 13], Sun: null } },
  ai: {},
};

const customer = { id: "cus-1", phone: "628123", name: "Dewi" } as Customer;

// Monday 28 September 2026, 02:00 UTC is 09:00 in Jakarta
const context: ToolContext = { organization, conversationId: "con-1", customer, now: new Date("2026-09-28T00:00:00Z") };

const appointment = (overrides: Partial<Appointment> = {}): Appointment =>
  ({
    id: "apt-1",
    customer_id: "cus-1",
    conversation_id: "con-1",
    service: "cleaning",
    starts_at: "2026-09-28T03:00:00.000Z",
    ends_at: "2026-09-28T03:45:00.000Z",
    status: "booked",
    created_by: "ai",
    notes: null,
    created_at: "2026-09-27T00:00:00.000Z",
    ...overrides,
  }) as Appointment;

beforeEach(() => {
  vi.clearAllMocks();
  createAppointment.mockResolvedValue(appointment());
  getBusyPeriods.mockResolvedValue([]);
  getUpcomingAppointments.mockResolvedValue([]);
});

describe("create_booking", () => {
  it("books a free slot inside opening hours", async () => {
    const result = await tool("create_booking").run({ service: "cleaning", starts_at: "2026-09-28T10:00" }, context);
    expect(result.ok).toBe(true);
    expect(createAppointment).toHaveBeenCalledOnce();
    const booked = createAppointment.mock.calls[0][0] as { startsAt: Date; endsAt: Date };
    // 10:00 Jakarta is 03:00 UTC, and a cleaning takes 45 minutes
    expect(booked.startsAt.toISOString()).toBe("2026-09-28T03:00:00.000Z");
    expect(booked.endsAt.toISOString()).toBe("2026-09-28T03:45:00.000Z");
  });

  it("refuses a time outside opening hours, and books nothing", async () => {
    // Tuesday at 3am: in the future, but hours before the clinic opens
    const result = await tool("create_booking").run({ service: "cleaning", starts_at: "2026-09-29T03:00" }, context);
    expect(result).toEqual({ ok: false, error: "that time is outside opening hours" });
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it("refuses a treatment that would run past closing", async () => {
    const result = await tool("create_booking").run({ service: "whitening", starts_at: "2026-09-28T17:00" }, context);
    expect(result).toEqual({ ok: false, error: "that time is outside opening hours" });
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it("refuses a day the clinic is closed", async () => {
    const result = await tool("create_booking").run({ service: "cleaning", starts_at: "2026-10-04T10:00" }, context);
    expect(result).toEqual({ ok: false, error: "the clinic is closed that day" });
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it("refuses a time in the past", async () => {
    const result = await tool("create_booking").run({ service: "cleaning", starts_at: "2026-09-21T10:00" }, context);
    expect(result).toEqual({ ok: false, error: "that time has already passed" });
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it("refuses a slot somebody else already has", async () => {
    getBusyPeriods.mockResolvedValue([
      { start: new Date("2026-09-28T03:30:00Z"), end: new Date("2026-09-28T04:15:00Z") },
    ]);
    const result = await tool("create_booking").run({ service: "cleaning", starts_at: "2026-09-28T10:00" }, context);
    expect(result).toEqual({ ok: false, error: "that slot is already taken" });
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it("rejects missing or unreadable arguments", async () => {
    expect(await tool("create_booking").run({ starts_at: "2026-09-28T10:00" }, context)).toMatchObject({ ok: false });
    expect(await tool("create_booking").run({ service: "cleaning" }, context)).toMatchObject({ ok: false });
    expect(await tool("create_booking").run({ service: "cleaning", starts_at: "next Monday" }, context)).toMatchObject({
      ok: false,
    });
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it("refuses when the conversation has no customer", async () => {
    const result = await tool("create_booking").run(
      { service: "cleaning", starts_at: "2026-09-28T10:00" },
      { ...context, customer: null }
    );
    expect(result).toMatchObject({ ok: false });
    expect(createAppointment).not.toHaveBeenCalled();
  });
});

describe("reschedule_booking and cancel_booking", () => {
  it("say so plainly when there is nothing to move", async () => {
    expect(await tool("reschedule_booking").run({ starts_at: "2026-09-28T11:00" }, context)).toEqual({
      ok: false,
      error: "no upcoming appointment was found for this customer",
    });
    expect(await tool("cancel_booking").run({}, context)).toEqual({
      ok: false,
      error: "no upcoming appointment was found for this customer",
    });
    expect(updateAppointment).not.toHaveBeenCalled();
  });

  it("moves the next appointment to a valid time", async () => {
    getUpcomingAppointments.mockResolvedValue([appointment()]);
    updateAppointment.mockResolvedValue(appointment({ starts_at: "2026-09-28T04:00:00.000Z", status: "rescheduled" }));

    const result = await tool("reschedule_booking").run({ starts_at: "2026-09-28T11:00" }, context);
    expect(result.ok).toBe(true);
    expect(updateAppointment).toHaveBeenCalledWith("apt-1", expect.objectContaining({ status: "rescheduled" }));
  });

  it("will not move an appointment outside opening hours", async () => {
    getUpcomingAppointments.mockResolvedValue([appointment()]);
    const result = await tool("reschedule_booking").run({ starts_at: "2026-09-28T22:00" }, context);
    expect(result).toEqual({ ok: false, error: "that time is outside opening hours" });
    expect(updateAppointment).not.toHaveBeenCalled();
  });

  it("cancels the next appointment", async () => {
    getUpcomingAppointments.mockResolvedValue([appointment()]);
    updateAppointment.mockResolvedValue(appointment({ status: "cancelled" }));
    const result = await tool("cancel_booking").run({}, context);
    expect(result.ok).toBe(true);
    expect(updateAppointment).toHaveBeenCalledWith("apt-1", { status: "cancelled" });
  });
});

describe("handoff_to_human", () => {
  it("escalates with the stated reason", async () => {
    const result = await tool("handoff_to_human").run({ reason: "customer is upset" }, context);
    expect(result).toEqual({ ok: true, data: { handed_over: true, reason: "customer is upset" } });
    expect(escalateConversation).toHaveBeenCalledWith("con-1", "customer is upset", null);
  });
});
