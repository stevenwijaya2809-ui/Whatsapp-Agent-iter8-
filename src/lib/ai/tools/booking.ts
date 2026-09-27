import "server-only";
import {
  DATE_PATTERN,
  failed,
  ok,
  optionalString,
  parseWhen,
  requireString,
  type Tool,
  type ToolContext,
} from "@/lib/ai/tools/types";
import {
  createAppointment,
  getAvailability,
  getBusyPeriods,
  getUpcomingAppointments,
  updateAppointment,
} from "@/lib/appointments";
import { durationFor, overlaps } from "@/lib/availability";
import { clinicDateKey, clinicInstant } from "@/lib/clinic";
import { escalateConversation } from "@/lib/conversations";
import type { Appointment } from "@/lib/types";

function localTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** How an appointment is described to the model, and from there to the customer. */
function describe(appointment: Appointment, timezone: string): Record<string, unknown> {
  return {
    appointment_id: appointment.id,
    service: appointment.service,
    starts_at: appointment.starts_at,
    local_time: localTime(new Date(appointment.starts_at), timezone),
    status: appointment.status,
  };
}

function openingHours(date: Date, context: ToolContext): [number, number] | null {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: context.organization.timezone,
    weekday: "short",
  }).format(date);
  return context.organization.business.hours?.[weekday] ?? null;
}

/**
 * The gate every booking passes through. Returns a plain reason when the time cannot be used,
 * so the model repeats a real explanation instead of inventing a confirmation.
 */
async function rejectSlot(startsAt: Date, durationMinutes: number, context: ToolContext): Promise<string | null> {
  if (startsAt.getTime() <= context.now.getTime()) return "that time has already passed";

  const hours = openingHours(startsAt, context);
  if (!hours) return "the clinic is closed that day";

  const date = clinicDateKey(startsAt);
  const openAt = clinicInstant(date, hours[0]);
  const closeAt = clinicInstant(date, hours[1]);
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  if (startsAt < openAt || endsAt > closeAt) return "that time is outside opening hours";

  const busy = await getBusyPeriods(openAt, closeAt);
  if (busy.some((period) => overlaps({ start: startsAt, end: endsAt }, period))) return "that slot is already taken";

  return null;
}

const checkAvailability: Tool = {
  name: "check_availability",
  description:
    'check_availability {"date": "YYYY-MM-DD", "service": "cleaning"} — free appointment times on one day. Use this before offering any time.',
  async run(args, context) {
    const date = requireString(args, "date");
    if (!date || !DATE_PATTERN.test(date)) return failed('"date" must be given as YYYY-MM-DD');

    const service = optionalString(args, "service") ?? "consultation";
    const day = await getAvailability(context.organization, date, durationFor(service), context.now);
    if (day.closed) return ok({ date, closed: true, slots: [] });

    return ok({
      date,
      closed: false,
      service,
      slots: day.slots.map((slot) => ({
        starts_at: slot.start.toISOString(),
        local_time: localTime(slot.start, context.organization.timezone),
      })),
    });
  },
};

const createBooking: Tool = {
  name: "create_booking",
  description:
    'create_booking {"service": "cleaning", "starts_at": "YYYY-MM-DDTHH:mm", "notes": "optional"} — books an appointment. Only use a time that check_availability returned.',
  async run(args, context) {
    if (!context.customer) return failed("no customer record for this conversation");

    const service = requireString(args, "service");
    if (!service) return failed('"service" is required');

    const when = requireString(args, "starts_at");
    if (!when) return failed('"starts_at" is required, as YYYY-MM-DDTHH:mm');
    const startsAt = parseWhen(when, clinicInstant);
    if (!startsAt) return failed('"starts_at" could not be read; use YYYY-MM-DDTHH:mm');

    const minutes = durationFor(service);
    const problem = await rejectSlot(startsAt, minutes, context);
    if (problem) return failed(problem);

    const appointment = await createAppointment({
      customerId: context.customer.id,
      conversationId: context.conversationId,
      service,
      startsAt,
      endsAt: new Date(startsAt.getTime() + minutes * 60_000),
      createdBy: "ai",
      notes: optionalString(args, "notes"),
    });

    return ok({ booked: true, ...describe(appointment, context.organization.timezone) });
  },
};

const rescheduleBooking: Tool = {
  name: "reschedule_booking",
  description:
    'reschedule_booking {"starts_at": "YYYY-MM-DDTHH:mm", "appointment_id": "optional"} — moves an appointment. Without an id, the next one is moved.',
  async run(args, context) {
    if (!context.customer) return failed("no customer record for this conversation");

    const when = requireString(args, "starts_at");
    if (!when) return failed('"starts_at" is required');
    const startsAt = parseWhen(when, clinicInstant);
    if (!startsAt) return failed('"starts_at" could not be read; use YYYY-MM-DDTHH:mm');

    const upcoming = await getUpcomingAppointments(context.customer.id, context.now);
    const id = optionalString(args, "appointment_id");
    const appointment = id ? upcoming.find((row) => row.id === id) : upcoming[0];
    if (!appointment) return failed("no upcoming appointment was found for this customer");

    const minutes = durationFor(appointment.service);
    const problem = await rejectSlot(startsAt, minutes, context);
    if (problem) return failed(problem);

    const updated = await updateAppointment(appointment.id, {
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + minutes * 60_000).toISOString(),
      status: "rescheduled",
    });
    if (!updated) return failed("the appointment could not be updated");

    return ok({ rescheduled: true, ...describe(updated, context.organization.timezone) });
  },
};

const cancelBooking: Tool = {
  name: "cancel_booking",
  description: 'cancel_booking {"appointment_id": "optional"} — cancels an appointment, the next one if no id is given.',
  async run(args, context) {
    if (!context.customer) return failed("no customer record for this conversation");

    const upcoming = await getUpcomingAppointments(context.customer.id, context.now);
    const id = optionalString(args, "appointment_id");
    const appointment = id ? upcoming.find((row) => row.id === id) : upcoming[0];
    if (!appointment) return failed("no upcoming appointment was found for this customer");

    const updated = await updateAppointment(appointment.id, { status: "cancelled" });
    if (!updated) return failed("the appointment could not be cancelled");

    return ok({ cancelled: true, ...describe(updated, context.organization.timezone) });
  },
};

const getAppointments: Tool = {
  name: "get_appointments",
  description: "get_appointments {} — the customer's upcoming appointments.",
  async run(_args, context) {
    if (!context.customer) return failed("no customer record for this conversation");
    const upcoming = await getUpcomingAppointments(context.customer.id, context.now);
    return ok({ appointments: upcoming.map((row) => describe(row, context.organization.timezone)) });
  },
};

const handoffToHuman: Tool = {
  name: "handoff_to_human",
  description: 'handoff_to_human {"reason": "why"} — hands the conversation to a colleague. Use when you cannot help.',
  async run(args, context) {
    const reason = requireString(args, "reason") ?? "The assistant asked for a person";
    await escalateConversation(context.conversationId, reason, null);
    return ok({ handed_over: true, reason });
  },
};

export const BOOKING_TOOLS: Tool[] = [
  checkAvailability,
  createBooking,
  rescheduleBooking,
  cancelBooking,
  getAppointments,
  handoffToHuman,
];
