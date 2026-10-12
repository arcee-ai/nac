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
    /** Project rows only. */
    onTogglePin?: () => void;
    onRename?: () => void;
    /** Orphan rows only: file the chat under a project. */
    onAssign?: () => void;
    /** When set (Default sort), shows desktop handle / mobile arrows. Projects
     *  and orphans reorder within their own group, never across it. */
    reorder?: ProjectCardReorder;
    /** Card is the active drag ghost (follows the pointer). */
    dragging?: boolean;
}
/**
 * One row of the project list: either a project with the chats inside it rolled
 * up, or a chat that belongs to none. Both open with a click and can be
 * reordered within their own group — see ProjectCardActions.
 */
export declare function ProjectCard({ item, selected, attention, onOpen, onDelete, onTogglePin, onRename, onAssign, reorder, dragging, }: ProjectCardProps): import("react").JSX.Element;
export {};
