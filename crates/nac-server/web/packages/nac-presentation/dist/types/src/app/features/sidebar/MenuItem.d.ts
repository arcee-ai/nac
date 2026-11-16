import type { ReactNode } from "react";
import { IconName } from "../../atoms";
/**
 * One row of a small popover menu. `checked` renders a radio-style mark for
 * exclusive choices (organize mode, behavior, project).
 */
export declare function MenuItem({ icon, label, hint, onSelect, destructive, checked, disabled, trailing, }: {
    icon?: IconName;
    label: ReactNode;
    /** Muted second line. */
    hint?: ReactNode;
    onSelect: () => void;
    destructive?: boolean;
    checked?: boolean;
    disabled?: boolean;
    trailing?: ReactNode;
}): import("react").JSX.Element;
/** The panel body of a popover menu. */
export declare function Menu({ label, children }: {
    label: string;
    children: ReactNode;
}): import("react").JSX.Element;
export declare function MenuSeparator(): import("react").JSX.Element;
export declare function MenuLabel({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
