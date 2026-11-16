/**
 * The phone has no room for the sidebar the desktop dialog puts the servers in,
 * so the panel itself is the list and everything it leads to opens as another
 * panel on top of it: list → catalog → form, each with its own way back.
 */
export declare function McpServersMobile({ open, onClose, presentation, }: {
    open: boolean;
    onClose?: () => void;
    /** "page": the list is the Settings section itself; catalog and form still push. */
    presentation?: "modal" | "page";
}): import("react").JSX.Element;
