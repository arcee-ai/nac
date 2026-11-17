import type { InsightGroup } from "../model/types";
/**
 * A group of reasoning and tool calls in the transcript, which opens it in
 * Insights. Without `interactive` it is a plain summary.
 */
export declare const TranscriptGroupBadge: import("react").MemoExoticComponent<({ group, active, trailing, selected, interactive, }: {
    group: InsightGroup;
    /** The turn is still producing output. */
    active: boolean;
    /** Nothing follows the group in its turn yet. */
    trailing: boolean;
    /** The group is the one Insights is showing. */
    selected: boolean;
    interactive: boolean;
}) => import("react").JSX.Element>;
