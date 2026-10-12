import type { ManagedSessionSummary } from "../../types/api";
interface ChatSessionListProps {
    sessions: ManagedSessionSummary[];
    /** The session currently open, marked as the active row. */
    activeSessionId?: string | null;
    onOpen: (summary: ManagedSessionSummary) => void;
    onRename?: (summary: ManagedSessionSummary) => void;
    onDelete?: (summary: ManagedSessionSummary) => void;
    onPin?: (summary: ManagedSessionSummary) => void;
    /** Taller rows and always-visible actions, matching the mobile modal. */
    isMobile?: boolean;
    emptyLabel?: string;
}
/**
 * Sessions as date-separated rows. Pinned sessions are lifted out of the date
 * buckets into their own group at the top, matching the projects list.
 */
export declare function ChatSessionList({ sessions, activeSessionId, onOpen, onRename, onDelete, onPin, isMobile, emptyLabel, }: ChatSessionListProps): import("react").JSX.Element;
export {};
