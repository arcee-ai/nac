import { type ProjectListItem } from "../../lib/projects";
interface ProjectsListProps {
    items: ProjectListItem[];
    /** Project currently open, or the session id when an orphan is open. */
    activeId?: string | null;
    onOpenProject: (projectId: string) => void;
    onOpenSession: (sessionId: string) => void;
    isMobile?: boolean;
    /** Per-row controls; the caller decides what a project and an orphan get. */
    renderActions?: (item: ProjectListItem) => React.ReactNode;
    emptyLabel?: string;
}
/**
 * Projects and unassigned sessions as one date-separated stream, with pinned
 * projects lifted into their own group at the top.
 */
export declare function ProjectsList({ items, activeId, onOpenProject, onOpenSession, isMobile, renderActions, emptyLabel, }: ProjectsListProps): import("react").JSX.Element;
export {};
