import type { ActionKind, InsightEntry, InsightGroup, InsightRow, InsightSegment } from "./types";
/** Failed row label. */
export declare function actionTypeLabel(kind: ActionKind): string;
/** Running row label of the list. */
export declare function actionRunningLabel(kind: ActionKind): string;
/** Ready row meta; reasoning shows its duration, when known, instead of a word. */
export declare function actionMeta(kind: ActionKind, durationMs?: number | null): string | null;
/** Type label of one segment; an unmapped tool reads as its product label. */
export declare function segmentTypeLabel(segment: InsightSegment): string;
/** Ready row label: the call's argument when it is known, else the type label. */
export declare function segmentTitle(segment: InsightSegment): string;
export declare function segmentMeta(segment: InsightSegment): string | null;
/** Transcript badge label while the segment is live, with its argument when known. */
export declare function inProgressLabel(segment: InsightSegment): string;
/** The first two distinct type labels, e.g. "Thoughts, Read File and more". */
export declare function groupSummaryLabel(group: InsightGroup): string;
/** Label of a settled group, on its transcript badge and its Insights row. */
export declare function doneLabel(group: InsightGroup): string;
/**
 * Transcript badge label while the group is live: its newest running segment,
 * else the approval it waits on. Null once nothing in it is live.
 */
export declare function groupLiveLabel(group: InsightGroup): string | null;
/** Ready row meta of an entry; a group counts its steps. */
export declare function entryMeta(entry: InsightEntry): string | null;
/** A group's child row. Running and failed rows drop the meta and show the type. */
export declare function segmentRow(segment: InsightSegment): InsightRow;
/** A top-level row. Thread rows keep their name and meta in every state. */
export declare function entryRow(entry: InsightEntry): InsightRow;
