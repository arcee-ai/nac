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
    /** Keep the trigger mounted, but do not draw the tip. */
    disabled?: boolean;
    /**
     * Lay the trigger out without a positioning context of its own. The box is
     * portalled either way, so no ancestor that clips overflow can cut it off.
     */
    sticky?: boolean;
    /**
     * On a phone, tap opens the tip as a bottom sheet (via Popover). Only
     * meaningful together with `sticky`.
     */
    showTooltipOnMobile?: boolean;
    children?: React.ReactNode;
}
/**
 * A hint shown while the trigger is hovered or holds keyboard focus. Escape
 * dismisses it before anything beneath it, and a press on the trigger hides
 * it until the pointer comes back.
 */
declare const Tooltip: React.FC<TooltipProps> & {
    Position: typeof AnchorPlacement;
};
export default Tooltip;
