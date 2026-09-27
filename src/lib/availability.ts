/**
 * Appointment slot arithmetic. Pure on purpose: the tool layer decides what a day means in the
 * clinic's timezone, this decides which slots inside it are actually free.
 */

export interface Period {
  start: Date;
  end: Date;
}

export interface SlotOptions {
  /** When the clinic opens and closes on the day in question */
  openAt: Date;
  closeAt: Date;
  durationMinutes: number;
  /** How far apart slot start times are; defaults to the appointment length */
  stepMinutes?: number;
  /** Appointments already taken */
  busy: Period[];
  now: Date;
  /** Slots starting sooner than this are not offered */
  noticeMinutes?: number;
  limit?: number;
}

const DEFAULT_NOTICE_MINUTES = 60;
const DEFAULT_LIMIT = 8;

/** Free slots for one day, earliest first, excluding anything already booked or too soon. */
export function findFreeSlots({
  openAt,
  closeAt,
  durationMinutes,
  stepMinutes,
  busy,
  now,
  noticeMinutes = DEFAULT_NOTICE_MINUTES,
  limit = DEFAULT_LIMIT,
}: SlotOptions): Period[] {
  if (durationMinutes <= 0) return [];

  const step = (stepMinutes ?? durationMinutes) * 60_000;
  const duration = durationMinutes * 60_000;
  const earliest = now.getTime() + noticeMinutes * 60_000;
  const slots: Period[] = [];

  for (let start = openAt.getTime(); start + duration <= closeAt.getTime(); start += step) {
    if (start < earliest) continue;
    const slot = { start: new Date(start), end: new Date(start + duration) };
    if (!busy.some((period) => overlaps(slot, period))) slots.push(slot);
    if (slots.length >= limit) break;
  }

  return slots;
}

/** Two periods clash when one starts before the other ends. Touching edges do not clash. */
export function overlaps(a: Period, b: Period): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/** Minutes a service takes, so the model cannot invent a 5 minute root canal. */
export const SERVICE_DURATIONS: Record<string, number> = {
  "check-up": 30,
  cleaning: 45,
  whitening: 90,
  filling: 60,
  "root canal": 90,
  extraction: 60,
  consultation: 30,
  orthodontics: 45,
  implant: 90,
};

export const DEFAULT_DURATION_MINUTES = 45;

/**
 * Minutes to reserve for a free-text service. When a request names more than one treatment
 * ("cleaning and check-up") the longest wins: over-booking a slot is recoverable, cutting an
 * appointment short is not.
 */
export function durationFor(service: string): number {
  const needle = service.toLowerCase();
  const matches = Object.entries(SERVICE_DURATIONS)
    .filter(([name]) => needle.includes(name))
    .map(([, minutes]) => minutes);
  return matches.length > 0 ? Math.max(...matches) : DEFAULT_DURATION_MINUTES;
}
