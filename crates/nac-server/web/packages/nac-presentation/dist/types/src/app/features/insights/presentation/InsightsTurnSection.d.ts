import { ActionListButtonSize } from "../../../atoms";
import type { InsightEntry, InsightGroupEntry, InsightSegment, InsightTurnSection } from "../model/types";
import type { RowView } from "./rows";
export interface InsightsRowController {
    expanded: ReadonlySet<string>;
    entryView(entry: InsightEntry): RowView;
    segmentView(segment: InsightSegment): RowView;
    /** Undefined for rows that navigate away instead of selecting themselves. */
    entrySelected(entry: InsightEntry): boolean | undefined;
    segmentSelected(entry: InsightGroupEntry, segment: InsightSegment): boolean | undefined;
    /** The row the panel shows, which the list reveals whether or not it is marked. */
    entryShown(entry: InsightEntry): boolean;
    segmentShown(entry: InsightGroupEntry, segment: InsightSegment): boolean;
    /** Null when the row has nowhere to go. */
    entryAction(entry: InsightEntry): (() => void) | null;
    segmentAction(entry: InsightGroupEntry, segment: InsightSegment): (() => void) | null;
}
export declare const InsightsTurnSection: import("react").MemoExoticComponent<({ section, fallbackPrompt, controller, size, }: {
    section: InsightTurnSection;
    /** Heading for a section with neither a time nor a prompt of its own. */
    fallbackPrompt: string;
    controller: InsightsRowController;
    /** Large on a phone, whose waves also take more room above and below. */
    size: ActionListButtonSize;
}) => import("react").JSX.Element>;
