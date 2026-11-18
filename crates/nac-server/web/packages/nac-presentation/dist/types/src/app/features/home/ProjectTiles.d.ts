import { type ProjectListItem } from "../../lib/projects";
import type { ManagedSessionSummary, ProjectRecord } from "../../types/api";
/**
 * Home's project tiles (and loose sessions), reorderable by drag, by the
 * tile's move controls, and droppable onto the pin zone.
 */
export declare function ProjectTiles({ items, projects, sessions, headingTrailing, addProject, }: {
    items: readonly ProjectListItem[];
    projects: readonly ProjectRecord[];
    sessions: readonly ManagedSessionSummary[];
    headingTrailing?: React.ReactNode;
    addProject?: {
        label: string;
        onClick: () => void;
    };
}): import("react").JSX.Element;
