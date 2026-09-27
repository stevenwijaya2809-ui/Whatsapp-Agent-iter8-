/**
 * Clinic opening hours, used to count messages that arrive when nobody is there
 * and to line daily counts up with the clinic's own working days.
 * Edit these to match the clinic; they should agree with lib/system-prompt.ts.
 */
export const CLINIC_TIMEZONE = process.env.CLINIC_TIMEZONE || "Asia/Jakarta";

/** Opening and closing hour (24h clock) per weekday, or null when closed. */
export const OPENING_HOURS: Record<string, [number, number] | null> = {
  Sun: null,
  Mon: [9, 18],
  Tue: [9, 18],
  Wed: [9, 18],
  Thu: [9, 18],
  Fri: [9, 18],
  Sat: [9, 13],
};

const hourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CLINIC_TIMEZONE,
  weekday: "short",
  hour: "numeric",
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CLINIC_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const offsetFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CLINIC_TIMEZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** True when the clinic is closed at that moment, in the clinic's own timezone. */
export function isAfterHours(when: Date): boolean {
  const parts = hourFormatter.formatToParts(when);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");

  const hours = OPENING_HOURS[weekday];
  if (!hours) return true;
  return hour < hours[0] || hour >= hours[1];
}

/** YYYY-MM-DD in the clinic's timezone. */
export function clinicDateKey(when: Date): string {
  return dateFormatter.format(when);
}

/** How many minutes the clinic's timezone is ahead of UTC at that moment. */
function offsetMinutes(at: Date): number {
  const parts: Record<string, string> = {};
  for (const part of offsetFormatter.formatToParts(at)) parts[part.type] = part.value;

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - at.getTime()) / 60_000;
}

/**
 * The instant midnight began in the clinic's timezone, that many clinic days ago.
 * Reporting periods start here so daily counts cover whole working days.
 */
export function clinicDayStart(daysAgo: number): Date {
  const key = clinicDateKey(new Date(Date.now() - daysAgo * 86_400_000));
  const midnightUtc = new Date(`${key}T00:00:00Z`);
  return new Date(midnightUtc.getTime() - offsetMinutes(midnightUtc) * 60_000);
}

/** The UTC instant of a wall-clock time in the clinic's timezone, e.g. 2026-10-02 at 14:30. */
export function clinicInstant(dateKey: string, hour: number, minute = 0): Date {
  const naive = new Date(`${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  return new Date(naive.getTime() - offsetMinutes(naive) * 60_000);
}
