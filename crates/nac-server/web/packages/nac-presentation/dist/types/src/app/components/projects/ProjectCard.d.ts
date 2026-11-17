import type { ProjectListItem } from "../../lib/projects";
export type ProjectListKind = "project" | "orphan";
export interface ProjectReorderStart {
    itemId: string;
    kind: ProjectListKind;
    pinned: boolean;
    clientX: number;
    clientY: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
}
export interface ProjectCardReorder {
    canMoveUp: boolean;
    canMoveDown: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onReorderStart: (start: ProjectReorderStart) => void;
}
interface ProjectCardProps {
    item: ProjectListItem;
    selected: boolean;
    attention: boolean;
    onOpen: () => void;
    onDelete: () => void;
    /** Project tiles only. */
    onTogglePin?: () => void;
    onRename?: () => void;
    onNewSession?: () => void;
    onIntervalTasks?: () => void;
    /** Unassigned sessions only: file the session under a project. */
    onAssign?: () => void;
    reorder?: ProjectCardReorder;
    /** The tile is the active drag ghost. */
    dragging?: boolean;
}
/**
 * Home's project tile (or an unassigned session's): avatar, name, location,
 * a quiet facts line, and one options menu. Opens with a click or Enter.
 */
export declare function ProjectCard({ item, selected, attention, onOpen, onDelete, onTogglePin, onRename, onNewSession, onIntervalTasks, onAssign, reorder, dragging, }: ProjectCardProps): import("react").JSX.Element;
export {};
