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
    className?: string;
    /** Glyph after the label. Forms keep the disclosure chevron. */
    trailingIcon?: IconName;
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
