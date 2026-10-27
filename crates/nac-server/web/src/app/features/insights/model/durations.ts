import type { InsightSegment } from "@/app/features/insights/model/types";

export function segmentDurationMs(segment: InsightSegment): number | null {
  if (segment.kind === "reasoning") return segment.durationMs;
  if (segment.kind === "tool") return segment.presentation?.durationMs ?? null;
  return null;
}

/**
 * The known durations added up. A segment without one, such as a tool from
 * before tool times were recorded or a workset, adds nothing, so the total can
 * undercount; null when no segment has one.
 */
export function sumSegmentDurations(segments: readonly InsightSegment[]): number | null {
  let total: number | null = null;
  for (const segment of segments) {
    const duration = segmentDurationMs(segment);
    if (duration !== null) total = (total ?? 0) + duration;
  }
  return total;
}

function tenthsOfSeconds(ms: number): string {
  return (Math.round(Math.max(0, ms) / 100) / 10).toFixed(1);
}

/** List meta, e.g. "13.8 s". */
export function formatListDuration(ms: number): string {
  return `${tenthsOfSeconds(ms)} s`;
}

/** Transcript badge, e.g. "12.3s". */
export function formatBadgeDuration(ms: number): string {
  return `${tenthsOfSeconds(ms)}s`;
}
