import type { ManagedSessionSummary, ProjectRecord } from "../../types/api";
/**
 * Projects as collapsible groups. The project on screen starts open; a search
 * keeps only the rows that match and opens every group that still has one.
 */
export declare function SidebarProjectList({ projects, sessions, query, activeSessionId, activeProjectId, }: {
    projects: ProjectRecord[];
    sessions: ManagedSessionSummary[];
    query: string;
    activeSessionId: string | null;
    activeProjectId: string | null;
}): import("react").JSX.Element;
