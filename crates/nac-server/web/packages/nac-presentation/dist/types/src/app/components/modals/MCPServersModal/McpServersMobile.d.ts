/**
 * The phone has no room for the sidebar the desktop dialog puts the servers in,
 * so the panel itself is the list and everything it leads to opens as another
 * panel on top of it: list → catalog → form, each with its own way back.
 */
export declare function McpServersMobile({ open, onClose }: {
    open: boolean;
    onClose: () => void;
}): import("react").JSX.Element;
