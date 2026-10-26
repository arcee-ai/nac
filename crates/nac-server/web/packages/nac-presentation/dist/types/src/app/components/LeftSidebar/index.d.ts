/** Collapsed icon column, matching the Figma rail. */
export declare const SIDEBAR_RAIL_WIDTH = 52;
/** Expanded panel, matching the Figma sidebar. */
export declare const SIDEBAR_PANEL_WIDTH = 280;
/**
 * Collapsible session navigation, in the ArceeFM arrangement: a 52px rail stays
 * put, and the 280px panel slides over it. The rail's width is what the rest of
 * the row lays out against, so opening the panel pushes the chat aside.
 */
export declare function LeftSidebar({ variant }: {
    variant?: "session" | "projects";
}): import("react").JSX.Element | null;
