import type { InsightEntry, InsightGroupEntry, InsightSegment, InsightTurnSection } from "../model/types";
import type { InsightSelection } from "../../../store/sessionLayoutStore";
/** The detail pane reads groups from the unfiltered timeline. */
export type ShownInsight = {
    kind: "group";
    entry: InsightGroupEntry;
    segmentKey: string | null;
};
/** Session rows navigate to another panel instead. */
export declare function opensInPlace(entry: InsightEntry): boolean;
export declare function resolveStoredInsight(selection: InsightSelection | null, timeline: readonly InsightTurnSection[]): ShownInsight | null;
export declare function newestShownInsight(sections: readonly InsightTurnSection[], timeline: readonly InsightTurnSection[]): ShownInsight | null;
export declare function hiddenByFilter(shown: ShownInsight, sections: readonly InsightTurnSection[]): boolean;
export declare function entrySelected(entry: InsightEntry, shown: ShownInsight | null): boolean | undefined;
export declare function segmentSelected(entry: InsightGroupEntry, segment: InsightSegment, shown: ShownInsight | null): boolean | undefined;
export declare function sameInsight(a: ShownInsight | null, b: ShownInsight | null): boolean;
