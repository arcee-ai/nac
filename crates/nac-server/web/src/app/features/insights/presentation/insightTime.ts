import { parseStoreTime } from "@/app/lib/format";

/** The UI is English-only, while the shared store-time formatter follows the browser's locale. */
const INSIGHT_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const INSIGHT_DATE = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** A store timestamp the way Insights prints it, or null when it cannot be read. */
export function formatInsightTime(value: string | null | undefined): string | null {
  const time = parseStoreTime(value);
  return Number.isNaN(time) ? null : INSIGHT_TIME.format(time);
}

/** A turn's date with its year, in the design's "8 Aug 2026 11:32 AM" order. */
export function formatInsightDate(value: string | null | undefined): string | null {
  const time = parseStoreTime(value);
  if (Number.isNaN(time)) return null;
  const part = Object.fromEntries(
    INSIGHT_DATE.formatToParts(time).map(({ type, value: text }) => [type, text]),
  );
  return `${part.day} ${part.month} ${part.year} ${part.hour}:${part.minute} ${part.dayPeriod}`;
}
