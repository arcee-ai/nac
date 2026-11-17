import { parseStoreTime } from "@/app/lib/format";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function startOfDay(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The local calendar day a store timestamp falls on, or null when it has none. */
export function dayKey(value: string | null | undefined): number | null {
  const time = parseStoreTime(value);
  return Number.isNaN(time) ? null : startOfDay(time);
}

/** "Today", "Yesterday", "Mon 14 Nov", or "14 Nov 2025" for another year. English, like the message dates. */
export function dayLabel(day: number, now: number = Date.now()): string {
  const today = startOfDay(now);
  const days = Math.round((today - day) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const date = new Date(day);
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  if (date.getFullYear() !== new Date(now).getFullYear()) return `${base} ${date.getFullYear()}`;
  return `${WEEKDAYS[date.getDay()]} ${base}`;
}
