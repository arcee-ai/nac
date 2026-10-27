import type { InsightSegment } from "@/app/features/insights/model/types";

export function segmentDurationMs(segment: InsightSegment): number | null {
  if (segment.kind === "reasoning") return segment.durationMs;
  if (segment.kind === "tool") return segment.presentation?.durationMs ?? null;
  return null;
}

/**
 * Total recorded activity, not elapsed wall-clock time. Parallel calls each
 * contribute their own duration. A segment without a recorded duration, such as
 * an older tool or a workset, adds nothing; null when none is known.
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
