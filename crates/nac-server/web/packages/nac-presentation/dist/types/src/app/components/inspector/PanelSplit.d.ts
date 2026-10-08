import { type ReactNode } from "react";
/**
 * The shape all three side-box panels share: a narrow list of rows on the left
 * and the detail of whatever is selected on the right.
 *
 * Below the desktop width there is no room for both, so the panel opens on the
 * row it has selected and the list is reached from a control of its own: a
 * dialog over the detail on a phone, the panel's own column on a tablet.
 */
export declare function PanelSplit({ list, listToolbar, listTitle, title, titleAction, actions, children, }: {
    list: ReactNode;
    /**
     * The list's own controls, staying put while it scrolls: a bar above it on a
     * pointer, and a pill floating over its last rows on a phone.
     */
    listToolbar?: ReactNode;
    /** What the list is of, for the header of the phone's list dialog. */
    listTitle?: string;
    /** Row that is open, named for the narrow header. */
    title?: string;
    /** Control belonging to the title itself, beside it rather than trailing. */
    titleAction?: ReactNode;
    /** Panel's own controls, trailing the narrow header. */
    actions?: ReactNode;
    children: ReactNode;
}): import("react").JSX.Element;
/**
 * Row of the left list, sized to the 24px tree row in the design — and to the
 * 48px touch row on a phone, where a finger has none of a pointer's precision.
 */
export declare function PanelRow({ label, active, disabled, icon, trailing, labelClassName, title, onClick, }: {
    label: string;
    active?: boolean;
    /** Queued / not yet started rows stay visible but are not selectable. */
    disabled?: boolean;
    icon?: ReactNode;
    trailing?: ReactNode;
    /** Overrides the label colour, e.g. to mark a file's git status. */
    labelClassName?: string;
    title?: string;
    onClick?: () => void;
}): import("react").JSX.Element;
/**
 * Placeholder for a panel waiting on its first payload: rows the size of the
 * ones on their way, rather than the word "Loading".
 *
 * Laid out as the split it is loading into — a short list beside a taller body
 * — so the columns and the divider are already where the rows will land, and
 * arriving data fills the panel instead of rebuilding it.
 */
export declare function PanelLoading({ listTitle }: {
    listTitle?: string;
}): import("react").JSX.Element;
/**
 * Placeholder for an empty or not-yet-selected panel. Given a `title` it takes
 * the design's two-line form — what is missing above why it is — in the same
 * monospace as the panel body it stands in for.
 */
export declare function PanelEmpty({ title, children }: {
    title?: string;
    children: ReactNode;
}): import("react").JSX.Element;
