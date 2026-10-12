import React from "react";
import { AnchorPlacement } from "../../lib/anchor";
export { AnchorPlacement as TooltipPosition };
type TooltipPosition = AnchorPlacement;
interface TooltipProps {
    title?: React.ReactNode;
    description?: React.ReactNode;
    keyboardShortcuts?: string[];
    position?: TooltipPosition;
    className?: string;
    boxClassName?: string;
    disabled?: boolean;
    /** Portal the box to the body when an ancestor clips overflow. */
    sticky?: boolean;
    /**
     * On a phone, tap opens the tip as a bottom sheet (via Popover). Only
     * meaningful together with `sticky`.
     */
    showTooltipOnMobile?: boolean;
    children?: React.ReactNode;
}
declare const Tooltip: React.FC<TooltipProps> & {
    Position: typeof AnchorPlacement;
};
export default Tooltip;
