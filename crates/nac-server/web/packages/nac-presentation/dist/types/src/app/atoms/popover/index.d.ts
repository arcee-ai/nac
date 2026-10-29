import React from "react";
import { AnchorPlacement } from "../../lib/anchor";
export { AnchorPlacement as PopoverPlacement };
export declare enum PopoverSize {
    Small = "w-[240px]",
    Medium = "w-[320px]",
    Large = "w-[400px]",
    /** As wide as the content. */
    Fit = "w-max",
    /** At least as wide as the trigger, and wider when the content asks for it. */
    TriggerWidth = "min-w-[var(--radix-popover-trigger-width)]"
}
interface PopoverProps {
    open: boolean;
    onClose: () => void;
    /** The panel body. Rendered into a bottom sheet on narrow screens. */
    content: React.ReactNode;
    /** The trigger the panel is anchored to. */
    children: React.ReactNode;
    placement?: AnchorPlacement;
    size?: PopoverSize | string;
    /**
     * Portal the panel to the presentation's overlay layer, so an ancestor with
     * clipped overflow cannot cut it off.
     */
    sticky?: boolean;
    closeOnOutsideClick?: boolean;
    closeOnEscape?: boolean;
    /** Below the mobile breakpoint, swap the panel for a bottom sheet. */
    sheetOnMobile?: boolean;
    className?: string;
    panelClassName?: string;
    sheetClassName?: string;
}
/**
 * Anchored panel with a trigger. Open state is owned by the caller, because
 * every use here also has to close it after acting on a row.
 */
declare const Popover: React.FC<PopoverProps> & {
    Placement: typeof AnchorPlacement;
    Size: typeof PopoverSize;
};
export default Popover;
