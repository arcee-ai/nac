import type { ManagedSessionSummary, ProjectRecord } from "../../types/api";
/**
 * Projects as collapsible groups. The project on screen starts open; a search
 * keeps only the rows that match and opens every group that still has one.
 */
export declare function SidebarProjectList({ projects, sessions, query, activeSessionId, activeProjectId, mobile, onNavigate, }: {
    projects: ProjectRecord[];
    sessions: ManagedSessionSummary[];
    query: string;
    activeSessionId: string | null;
    activeProjectId: string | null;
    /** The phone menu's tree: 48px rows, project controls, rules between projects. */
    mobile?: boolean;
    /** Runs as a row opens its chat, also the chat on screen, whose route does not change. */
    onNavigate?: () => void;
}): import("react").JSX.Element;
