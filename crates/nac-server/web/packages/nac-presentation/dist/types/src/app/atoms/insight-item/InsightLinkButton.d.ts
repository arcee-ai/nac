import type React from "react";
interface InsightLinkButtonProps {
    label: string;
    /** Renders a real link. Without it the control is a button. */
    href?: string;
    onClick?: (event: React.MouseEvent<HTMLElement>) => void;
    className?: string;
}
/**
 * "Session title >" link at the end of an `InsightItem` body. It wears the
 * small ghost button classes, so hover, press and focus match the tab buttons
 * around it; `.btn-small.btn-icon-right` sets height and padding in unlayered
 * CSS, which the 28px design overrides with `!`. It keeps its own width
 * inside the item's stretching column.
 */
declare const InsightLinkButton: React.FC<InsightLinkButtonProps>;
export default InsightLinkButton;
