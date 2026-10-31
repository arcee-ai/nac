import type { ReactNode } from "react";
/** A line standing in for a list's rows, inset and sized like their labels on a phone. */
export declare function PanelListNote({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
/**
 * A panel that could not load. A phone still draws it as a screen of its own,
 * with the header's way out and the tab bar.
 */
export declare function PanelFailure({ listTitle, children }: {
    listTitle: string;
    children: ReactNode;
}): import("react").JSX.Element;
/**
 * A panel with nothing in it yet, centred in the whole box instead of split
 * into a list and its detail. A phone still draws it as a screen of its own,
 * with the header's way out and the tab bar.
 */
export declare function PanelEmptyState({ listTitle, title, description, phoneLead, }: {
    listTitle: string;
    title: string;
    description?: string;
    /** What heads the list on a phone, kept above the message there. */
    phoneLead?: ReactNode;
}): import("react").JSX.Element;
