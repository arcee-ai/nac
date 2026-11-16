import type React from "react";
export declare enum InsightItemCodeDisplayerState {
    Default = "default",
    Loading = "loading",
    Expanded = "expanded"
}
interface InsightItemCodeDisplayerProps {
    /** Names the field: the heading, the group and the copy button all use it. */
    title: string;
    /** Some types draw the field without its heading; the title still names it. */
    showHeading?: boolean;
    state?: InsightItemCodeDisplayerState;
    /** Shown in Default and Loading. Empty leaves the heading and the link. */
    shortContent: string;
    /** Shown, and copied, in Expanded. */
    fullContent?: string | null;
    /** "Show full" is offered only with a handler. */
    onShowFull?: () => void;
    /** "Hide" is offered only with a handler. */
    onHide?: () => void;
    /** Under the content in Default. "Show full" stays enabled, so it retries. */
    error?: string | null;
    /** Under the full content in Expanded, e.g. where the server cut it short. */
    note?: string | null;
}
/**
 * A tool call's input or output inside an `InsightItem`, behind a 2px muted
 * rule. The caller owns the state and the full content: "Show full" asks for
 * it, Loading keeps the preview on screen with the link disabled, and Expanded
 * shows the full content with "Hide" and a copy button. Long lines wrap, so
 * the detail column stays the only scroller.
 */
declare const InsightItemCodeDisplayer: React.FC<InsightItemCodeDisplayerProps>;
export default InsightItemCodeDisplayer;
