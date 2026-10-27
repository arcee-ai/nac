import { type ReactNode } from "react";
/**
 * The shape every side-box panel shares: the detail of whatever is selected,
 * with a narrow list of rows in a column on its right.
 *
 * Below the desktop width there is no room for both, so the two take turns. A
 * tablet opens on the selected row and reaches the list from its header; a
 * phone opens on the list, the way its tab bar does, and a row pushes the
 * detail over it.
 */
export declare function PanelSplit({ list, listToolbar, listClassName, listTitle, title, titleAction, actions, children, }: {
    list: ReactNode;
    /**
     * The list's own controls, staying put while it scrolls: a bar above it on a
     * desktop, inline after the back button of a tablet's list header, and the
     * trailing pills of a phone's.
     */
    listToolbar?: ReactNode;
    /** Insets of the desktop list column, for a panel drawn with its own. */
    listClassName?: string;
    /** What the list is of, titling its screen below the desktop width. */
    listTitle?: string;
    /** Row that is open, named for the narrow header. */
    title?: ReactNode;
    /** Control belonging to the title itself, beside it rather than trailing. */
    titleAction?: ReactNode;
    /** Panel's own controls, trailing the narrow header. */
    actions?: ReactNode;
    children: ReactNode;
}): import("react").JSX.Element;
/**
 * Row of the list column, as tall as a file list row — 28px, or the 48px touch
 * row on a phone, where a finger has none of a pointer's precision.
 */
export declare function PanelRow({ label, active, disabled, icon, trailing, title, onClick, }: {
    label: string;
    active?: boolean;
    /** Queued / not yet started rows stay visible but are not selectable. */
    disabled?: boolean;
    icon?: ReactNode;
    trailing?: ReactNode;
    title?: string;
    onClick?: () => void;
}): import("react").JSX.Element;
/**
 * Placeholder for a panel waiting on its first payload: rows the size of the
 * ones on their way, rather than the word "Loading".
 *
 * Laid out as the split it is loading into — a taller body beside a short list
 * — so the columns and the divider are already where the rows will land, and
 * arriving data fills the panel instead of rebuilding it.
 */
export declare function PanelLoading({ listTitle }: {
    listTitle?: string;
}): import("react").JSX.Element;
/**
 * Placeholder for an empty or not-yet-selected panel. Given a `title` it takes
 * the design's two-line form — what is missing above why it is — in the same
 * monospace as the panel body it stands in for. On a phone it starts below the
 * screen's floating header, which a panel's body otherwise runs under.
 */
export declare function PanelEmpty({ title, children }: {
    title?: string;
    children: ReactNode;
}): import("react").JSX.Element;
