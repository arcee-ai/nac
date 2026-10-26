import type { InsightSegment } from "./types";
export declare function segmentDurationMs(segment: InsightSegment): number | null;
/**
 * The known durations added up. A segment without one, such as a tool from
 * before tool times were recorded or a workset, adds nothing, so the total can
 * undercount; null when no segment has one.
 */
export declare function sumSegmentDurations(segments: readonly InsightSegment[]): number | null;
/** List meta, e.g. "13.8 s". */
export declare function formatListDuration(ms: number): string;
/** Transcript badge, e.g. "12.3s". */
export declare function formatBadgeDuration(ms: number): string;
