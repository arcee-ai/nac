import type React from "react";
interface InsightCodeBoxProps {
    /** "Input" or "Output". Some types show bare boxes. */
    label?: string;
    children: React.ReactNode;
    className?: string;
}
/**
 * Monospace box for a tool's input or output inside an `InsightItem`. Long
 * lines wrap instead of scrolling sideways, so the detail column stays the
 * only scroller. A labelled box that is not the last child of the item's
 * column keeps 8px more room below it, which is how the design sets "Input"
 * apart from "Output" or from the error message. The box's 1px border counts
 * toward its 4px padding, as the design draws it.
 */
declare const InsightCodeBox: React.FC<InsightCodeBoxProps>;
export default InsightCodeBox;
