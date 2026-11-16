/**
 * Search over the chats or the projects: one field above a flat list of what
 * it matches. The phone menu opens it as a screen of its own, with a clear
 * button in the field and 48px rows whose controls are always shown. The
 * desktop sidebar opens it as a card with neither: bare 36px rows that only
 * navigate.
 * Picking a row closes it, and the menu under it, then navigates; the row on
 * screen changes no route, which alone would close them.
 */
export declare function MobileSearchModal({ open, onClose, onNavigate, kind, activeSessionId, activeProjectId, }: {
    open: boolean;
    onClose: () => void;
    /** Closes the phone menu under this screen once a row is picked. */
    onNavigate?: () => void;
    kind: "chats" | "projects";
    activeSessionId: string | null;
    activeProjectId: string | null;
}): import("react").JSX.Element;
