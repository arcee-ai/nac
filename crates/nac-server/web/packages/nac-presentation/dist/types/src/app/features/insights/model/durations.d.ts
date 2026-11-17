import type { InsightSegment } from "./types";
export declare function segmentDurationMs(segment: InsightSegment): number | null;
/**
 * Total recorded activity, not elapsed wall-clock time. Parallel calls each
 * contribute their own duration. A segment without a recorded duration, such as
 * an older tool or a workset, adds nothing; null when none is known.
 */
export declare function sumSegmentDurations(segments: readonly InsightSegment[]): number | null;
/** List meta, e.g. "13.8 s". */
export declare function formatListDuration(ms: number): string;
/** Transcript badge, e.g. "12.3s". */
export declare function formatBadgeDuration(ms: number): string;
