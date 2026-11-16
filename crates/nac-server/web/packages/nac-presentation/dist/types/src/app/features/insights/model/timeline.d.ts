import type { InsightEntry, InsightsEmptyCopy, InsightsFilter, InsightsFilterOption, InsightsTopology, InsightTurnSection } from "./types";
import { type TranscriptTurn } from "../../../lib/transcript";
/**
 * One section per user turn, newest first, with its entries in chronological
 * order. Output after a delegated completion stays with the prompt before it.
 * Output before the first loaded prompt, and a streamed turn whose prompt the
 * snapshot does not show yet, form sections of their own without an ordinal.
 * Sections without entries are left out.
 */
export declare function buildInsightTimeline(turns: readonly TranscriptTurn[]): InsightTurnSection[];
/**
 * Narrowed groups keep their ids, so a selection made in a filtered view
 * resolves against the full timeline, where the detail reads it from.
 */
export declare function filterInsightTimeline(sections: readonly InsightTurnSection[], filter: InsightsFilter): InsightTurnSection[];
/** Entries in display order: newest section first, chronological within each. */
export declare function flattenInsightEntries(sections: readonly InsightTurnSection[]): InsightEntry[];
export declare function findInsightEntry(sections: readonly InsightTurnSection[], id: string): InsightEntry | null;
/** The entry produced last, which closes the newest section. */
export declare function newestInsightEntry(sections: readonly InsightTurnSection[]): InsightEntry | null;
export declare function insightFilterOptions(topology: InsightsTopology): readonly InsightsFilterOption[];
export declare function insightFilterEmptyCopy(filter: InsightsFilter, topology: InsightsTopology): InsightsEmptyCopy;
