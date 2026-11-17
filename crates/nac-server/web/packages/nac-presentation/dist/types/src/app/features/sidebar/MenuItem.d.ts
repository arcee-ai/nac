import { type MouseEvent, type ReactNode } from "react";
import { IconName } from "../../atoms";
/**
 * One row of a small popover menu. `checked` renders a radio-style mark for
 * exclusive choices (organize mode, behavior, project).
 */
export declare function MenuItem({ icon, label, ariaLabel, hint, onSelect, destructive, checked, disabled, trailing, }: {
    icon?: IconName;
    label: ReactNode;
    /** Accessible name when the visible label needs its subject ("Rename <title>"). */
    ariaLabel?: string;
    /** Muted second line. */
    hint?: ReactNode;
    onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
    destructive?: boolean;
    checked?: boolean;
    disabled?: boolean;
    trailing?: ReactNode;
}): import("react").JSX.Element;
/**
 * The panel body of a popover menu. `autoFocus` moves focus to the first item
 * when the menu mounts, for menus opened from a button (the ARIA menu-button
 * pattern); the arrow keys always move between items.
 */
export declare function Menu({ label, autoFocus, children, }: {
    label: string;
    autoFocus?: boolean;
    children: ReactNode;
}): import("react").JSX.Element;
export declare function MenuSeparator(): import("react").JSX.Element;
export declare function MenuLabel({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
