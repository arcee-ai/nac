import type React from "react";
import { IconName } from "../icon";
export { default as InsightCodeBox } from "./InsightCodeBox";
export { default as InsightItemCodeDisplayer, InsightItemCodeDisplayerState, } from "./InsightItemCodeDisplayer";
export { default as InsightLinkButton } from "./InsightLinkButton";
export { default as InsightShowFullButton } from "./InsightShowFullButton";
export declare enum InsightItemState {
    Default = "default",
    Loading = "loading",
    Error = "error"
}
interface InsightItemProps {
    /** Scroll-into-view anchor. */
    id?: string;
    icon: IconName;
    /** Loading appends the ellipsis, so pass the bare loading title ("Thinking"). */
    title: string;
    state?: InsightItemState;
    /** Highlights the item a list row points at; the layout does not move. */
    active?: boolean;
    /** What the header's copy button puts on the clipboard. Default state only. */
    copyText?: string | null;
    /** Shown under the body in the Error state, keeping its line breaks. */
    errorMessage?: string | null;
    /** Under the error message, e.g. an `InsightShowFullButton` for a cut message. */
    errorAction?: React.ReactNode;
    /**
     * The type's body, rendered straight into the item's 16px-gap column in every
     * state: the type decides what stays visible while loading or after a
     * failure (a session link, the input box).
     */
    children?: React.ReactNode;
}
/**
 * One step in the Insights detail column: a header with the type icon, the
 * title and a copy button, then the type's own body. Loading swaps the icon
 * for the spinner and shimmers the title; Error swaps it for the error-tone
 * Close and appends the message and its action. Neither offers copy. Body
 * text defaults to the design's 12px tertiary text; code boxes and links
 * bring their own.
 * Each item draws its own bottom divider inside its 24px bottom padding, as
 * the design does, so a stack of items needs no gap or separators.
 */
declare const InsightItem: React.FC<InsightItemProps>;
export default InsightItem;
