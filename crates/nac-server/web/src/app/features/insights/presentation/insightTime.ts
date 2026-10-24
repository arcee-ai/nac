import { parseStoreTime } from "@/app/lib/format";

/** The UI is English-only, while the shared store-time formatter follows the browser's locale. */
const INSIGHT_TIME = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** A store timestamp the way Insights prints it, or null when it cannot be read. */
export function formatInsightTime(value: string | null | undefined): string | null {
  const time = parseStoreTime(value);
  return Number.isNaN(time) ? null : INSIGHT_TIME.format(time);
}
