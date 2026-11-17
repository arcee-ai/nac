import type { ManagedSessionSummary, ProjectRecord } from "../../types/api";
/**
 * Inbox · Sessions: one small switch over the sidebar list. The choice is
 * remembered; the Inbox tab carries the number of sessions that need you.
 */
export declare function SessionListSwitch({ touch }: {
    touch?: boolean;
}): import("react").JSX.Element;
/** The selected list under the switch. */
export declare function SessionListBody({ projects, sessions, activeSessionId, touch, onNavigate, }: {
    projects: readonly ProjectRecord[];
    sessions: readonly ManagedSessionSummary[];
    activeSessionId: string | null;
    touch?: boolean;
    onNavigate?: () => void;
}): import("react").JSX.Element;
