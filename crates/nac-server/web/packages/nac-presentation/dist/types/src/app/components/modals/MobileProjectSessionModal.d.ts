import type { ManagedSessionSummary, SessionSummarySnapshot } from "../../types/api";
/**
 * The phone's navigator: a full-screen modal box (not a popover sheet) holding
 * the chat list, the project list, and — for an unassigned chat — the assign
 * flow, switched by the floating bar at the bottom.
 */
export declare function MobileProjectSessionModal({ open, onClose, projectId, sessions, activeSessionId, summary, }: {
    open: boolean;
    onClose: () => void;
    /** Null when the open chat belongs to no project, or none is open. */
    projectId: string | null;
    /** The open project's chats; empty when there is no project. */
    sessions: ManagedSessionSummary[];
    activeSessionId: string | null;
    summary: SessionSummarySnapshot | null;
}): import("react").JSX.Element;
