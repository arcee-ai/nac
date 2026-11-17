import type { ManagedSessionSummary, ProjectRecord } from "../../types/api";
/**
 * The sidebar's session list: by project (default) or by status, with
 * subagents folded under their parents. Shared by the desktop sidebar and the
 * phone menu.
 */
export declare function SessionTree({ projects, sessions, activeSessionId, touch, onNavigate, }: {
    projects: readonly ProjectRecord[];
    sessions: readonly ManagedSessionSummary[];
    activeSessionId: string | null;
    touch?: boolean;
    onNavigate?: () => void;
}): import("react").JSX.Element;
