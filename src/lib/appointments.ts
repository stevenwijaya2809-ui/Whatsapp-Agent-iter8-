import "server-only";
import { findFreeSlots, type Period } from "@/lib/availability";
import { clinicInstant } from "@/lib/clinic";
import { DEFAULT_ORGANIZATION_ID, type Organization } from "@/lib/organization";
import { getSupabase } from "@/lib/supabase";
import type { Appointment } from "@/lib/types";

/** Appointments start on the quarter hour, so 10:00 is offered even for a 45 minute treatment. */
const SLOT_STEP_MINUTES = 15;

/** Statuses that still occupy a slot in the diary. */
const ACTIVE_STATUSES = ["requested", "booked", "rescheduled"];

export interface NewAppointment {
  customerId: string;
  conversationId: string | null;
  service: string;
  startsAt: Date;
  endsAt: Date;
  createdBy: "ai" | "human";
  notes?: string | null;
}

export async function createAppointment(input: NewAppointment): Promise<Appointment> {
  const { data, error } = await getSupabase()
    .from("appointments")
    .insert({
      organization_id: DEFAULT_ORGANIZATION_ID,
      customer_id: input.customerId,
      conversation_id: input.conversationId,
      service: input.service,
      starts_at: input.startsAt.toISOString(),
      ends_at: input.endsAt.toISOString(),
      created_by: input.createdBy,
      notes: input.notes ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create the appointment: ${error.message}`);
  return data;
}

/** Appointments still to come for one customer, soonest first. */
export async function getUpcomingAppointments(customerId: string, now = new Date()): Promise<Appointment[]> {
  const { data, error } = await getSupabase()
    .from("appointments")
    .select("*")
    .eq("customer_id", customerId)
    .in("status", ACTIVE_STATUSES)
    .gte("starts_at", now.toISOString())
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`Failed to load appointments: ${error.message}`);
  return data;
}

export async function updateAppointment(
  id: string,
  changes: Partial<Pick<Appointment, "starts_at" | "ends_at" | "status" | "notes" | "service">>
): Promise<Appointment | null> {
  const { data, error } = await getSupabase()
    .from("appointments")
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw new Error(`Failed to update the appointment: ${error.message}`);
  return data;
}

/** Everything already in the diary between two instants, used to rule slots out. */
export async function getBusyPeriods(from: Date, to: Date): Promise<Period[]> {
  const { data, error } = await getSupabase()
    .from("appointments")
    .select("starts_at, ends_at")
    .eq("organization_id", DEFAULT_ORGANIZATION_ID)
    .in("status", ACTIVE_STATUSES)
    .lt("starts_at", to.toISOString())
    .gt("ends_at", from.toISOString());
  if (error) throw new Error(`Failed to load the diary: ${error.message}`);
  return data.map((row) => ({ start: new Date(row.starts_at), end: new Date(row.ends_at) }));
}

export interface DayAvailability {
  /** YYYY-MM-DD in the clinic's timezone */
  date: string;
  closed: boolean;
  slots: Period[];
}

/**
 * Free slots on one clinic day. Opening hours come from the organization's settings, so a
 * change there is reflected immediately without touching code.
 */
export async function getAvailability(
  organization: Organization,
  date: string,
  durationMinutes: number,
  now = new Date()
): Promise<DayAvailability> {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: organization.timezone, weekday: "short" }).format(
    clinicInstant(date, 12)
  );
  const hours = organization.business.hours?.[weekday] ?? null;
  if (!hours) return { date, closed: true, slots: [] };

  const openAt = clinicInstant(date, hours[0]);
  const closeAt = clinicInstant(date, hours[1]);
  const busy = await getBusyPeriods(openAt, closeAt);

  return {
    date,
    closed: false,
    slots: findFreeSlots({ openAt, closeAt, durationMinutes, stepMinutes: SLOT_STEP_MINUTES, busy, now }),
  };
}
