import type { InsightSessionEntry } from "../model/types";
/** Keep every target visible until the parent-owned session has been verified. */
export declare function TranscriptSessionGroup({ entries, interactive, }: {
    entries: InsightSessionEntry[];
    interactive: boolean;
}): import("react").JSX.Element;
/**
 * A session the turn launched, with its live status. Opens it in Subagents and
 * links to its own page; without `interactive` it is a plain summary.
 */
export declare const TranscriptSessionCard: import("react").MemoExoticComponent<({ entry, interactive, showTarget, }: {
    entry: InsightSessionEntry;
    interactive: boolean;
    showTarget?: boolean;
}) => import("react").JSX.Element>;
