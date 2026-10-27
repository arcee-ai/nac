/**
 * The phone menu's search screen: one field over a flat list of the chats or
 * the projects it matches. Picking a row closes this screen and the menu, then
 * navigates; the row on screen changes no route, which alone would close them.
 */
export declare function MobileSearchModal({ open, onClose, onNavigate, kind, activeSessionId, activeProjectId, }: {
    open: boolean;
    onClose: () => void;
    /** Closes the menu under this screen once a row is picked. */
    onNavigate: () => void;
    kind: "chats" | "projects";
    activeSessionId: string | null;
    activeProjectId: string | null;
}): import("react").JSX.Element;
