import type { InsightSegment } from "@/app/features/insights/model/types";

export function segmentDurationMs(segment: InsightSegment): number | null {
  if (segment.kind === "reasoning") return segment.durationMs;
  if (segment.kind === "tool") return segment.presentation?.durationMs ?? null;
  return null;
}

/** Null unless every segment's duration is known, so a total never undercounts. */
export function sumSegmentDurations(segments: readonly InsightSegment[]): number | null {
  if (!segments.length) return null;
  let total = 0;
  for (const segment of segments) {
    const duration = segmentDurationMs(segment);
    if (duration === null) return null;
    total += duration;
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
