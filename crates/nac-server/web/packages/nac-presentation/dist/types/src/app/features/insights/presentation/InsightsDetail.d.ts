import type { InsightGroup } from "../model/types";
import type { ItemContext } from "./items/itemContent";
/** Key it by group: whether the reader sits at the bottom is remembered per group. */
export declare const InsightsDetail: import("react").MemoExoticComponent<({ group, segmentKey, focusNonce, context, }: {
    group: InsightGroup;
    segmentKey: string | null;
    focusNonce: number;
    context: ItemContext;
}) => import("react").JSX.Element>;
