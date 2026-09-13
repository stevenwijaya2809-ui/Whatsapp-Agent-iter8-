export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Calendar days between a date and today: 0 is today, 1 is yesterday. */
function daysAgo(date: Date): number {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
}

/** Compact timestamp for the conversation list: time today, then "Yesterday", weekday, or date. */
export function formatListTimestamp(iso: string): string {
  const date = new Date(iso);
  const days = daysAgo(date);
  if (days <= 0) return formatTime(iso);
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString([], { weekday: "short" });
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString([], { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" });
}

/** Label for the divider between messages sent on different days. */
export function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const days = daysAgo(date);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function isSameDay(a: string, b: string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}
