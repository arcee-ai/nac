import React from "react";
import { AnchorPlacement } from "../../lib/anchor";
import { ButtonSize, ButtonVariant } from "../button";
import { IconName } from "../icon";
import type { HoverHintConfig } from "../label";
import { TabButtonSize } from "../tab-button";
export interface SelectItem {
    id: string;
    label: React.ReactNode;
    icon?: IconName;
    /** Info glyph on the row. Its hover text explains that choice. */
    hoverHint?: HoverHintConfig;
}
interface SelectProps {
    items?: SelectItem[];
    value?: string;
    onValueChange?: (id: string) => void;
    size?: ButtonSize;
    /** Panel rows; defaults to matching `size`. */
    itemSize?: TabButtonSize;
    variant?: ButtonVariant;
    placement?: AnchorPlacement;
    placeholder?: string;
    disabled?: boolean;
    /**
     * Portal the panel to the body, for a select that sits in a box which clips
     * its overflow — a dialog scrolling its own body cuts the list off otherwise.
     * The panel then sizes to its content instead of to the trigger, so a width
     * of its own belongs in `panelClassName`.
     */
    sticky?: boolean;
    /**
     * Draws the trigger as a `StickyButton` of `variant`, for a select floating
     * over a phone screen. Its rows still follow `size`.
     */
    floating?: boolean;
    /** Trigger text in place of the chosen row's label, for a trigger that words it its own way. */
    triggerLabel?: React.ReactNode;
    className?: string;
    /** Glyph after the label, or `null` for a trigger of text alone. Forms keep the disclosure chevron. */
    trailingIcon?: IconName | null;
    /**
     * Applied to the trigger button. The wrapper stretching is not enough on its
     * own — the button hugs its label — so a select that has to fill a form
     * column needs `w-full` here as well as on `className`.
     */
    triggerClassName?: string;
    panelClassName?: string;
    /** Fired when the list opens or closes, so a surrounding tip can step aside. */
    onOpenChange?: (open: boolean) => void;
}
/** Dropdown select: a `Popover` whose panel is a list of single-choice rows. */
declare const Select: React.FC<SelectProps>;
export default Select;
