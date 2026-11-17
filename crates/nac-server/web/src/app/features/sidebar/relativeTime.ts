import { parseStoreTime } from "@/app/lib/format";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTH_DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** Compact, tabular-friendly age: "now", "4m", "3h", "2d", then "Mar 4". */
export function compactAge(storeTime: string | null | undefined, now: number): string {
  const at = parseStoreTime(storeTime);
  if (!at || !Number.isFinite(at)) return "";
  const delta = Math.max(0, now - at);
  if (delta < MINUTE) return "now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d`;
  return MONTH_DAY.format(at);
}

/** Spoken form of the same age, for titles and assistive technology. */
export function longAge(storeTime: string | null | undefined): string {
  const at = parseStoreTime(storeTime);
  if (!at || !Number.isFinite(at)) return "";
  return new Date(at).toLocaleString();
}
