import type { InsightSessionEntry } from "../model/types";
/**
 * A session the turn launched, with its live status. Opens it in Subagents and
 * links to its own page; without `interactive` it is a plain summary.
 */
export declare const TranscriptSessionCard: import("react").MemoExoticComponent<({ entry, interactive, }: {
    entry: InsightSessionEntry;
    interactive: boolean;
}) => import("react").JSX.Element>;
