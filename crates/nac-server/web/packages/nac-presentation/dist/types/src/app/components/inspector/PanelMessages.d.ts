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
