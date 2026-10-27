import { parseStoreTime } from "@/app/lib/format";

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

/**
 * A message's time as the transcript prints it, "2 Sep 2026 11:24 AM": local
 * time, but English whatever the browser's locale.
 */
export function formatMessageDate(value: string | null | undefined): string | null {
  const time = parseStoreTime(value);
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const clock = `${hours % 12 || 12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()} ${clock}`;
}
