import type { InsightEntry, InsightGroupEntry, InsightSegment, InsightTurnSection } from "../model/types";
import type { InsightSelection } from "../../../store/sessionLayoutStore";
/** What the detail pane shows; groups always come from the unfiltered timeline. */
export type ShownInsight = {
    kind: "group";
    entry: InsightGroupEntry;
    segmentKey: string | null;
} | {
    kind: "thread";
    name: string;
    episode: string | null;
};
export interface StoredThread {
    name: string | null;
    episode: string | null;
}
/** Session rows and workset-only groups navigate to another panel instead. */
export declare function opensInPlace(entry: InsightEntry): boolean;
/** The pick stored in the layout store, while it still names something on the page. */
export declare function resolveStoredInsight(selection: InsightSelection | null, thread: StoredThread, timeline: readonly InsightTurnSection[], ownsThread: (name: string) => boolean): ShownInsight | null;
/** The newest entry the filtered list shows that has a detail of its own. */
export declare function newestShownInsight(sections: readonly InsightTurnSection[], timeline: readonly InsightTurnSection[]): ShownInsight | null;
export declare function hiddenByFilter(shown: ShownInsight, sections: readonly InsightTurnSection[]): boolean;
/** Undefined for rows that navigate away, which never show as selected. */
export declare function entrySelected(entry: InsightEntry, shown: ShownInsight | null): boolean | undefined;
export declare function segmentSelected(entry: InsightGroupEntry, segment: InsightSegment, shown: ShownInsight | null): boolean | undefined;
