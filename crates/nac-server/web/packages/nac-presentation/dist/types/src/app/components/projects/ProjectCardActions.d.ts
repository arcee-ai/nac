interface ProjectCardActionsProps {
    /** A card for a chat that belongs to no project gets its own verbs. */
    orphan: boolean;
    pinned: boolean;
    onDelete: () => void;
    /** Projects only — an unassigned chat cannot be pinned. */
    onTogglePin?: () => void;
    onRename?: () => void;
    /** Files an unassigned chat; only meaningful on an orphan card. */
    onAssign?: () => void;
    /** Tablet/mobile reorder controls (Default sort). */
    reorder?: {
        canMoveUp: boolean;
        canMoveDown: boolean;
        onMoveUp: () => void;
        onMoveDown: () => void;
    };
}
/**
 * Row of per-card actions. Both kinds of card can be renamed, deleted and
 * reordered; a project can also be pinned, while an unassigned chat can be
 * filed under a project instead.
 */
export declare function ProjectCardActions({ orphan, pinned, onDelete, onTogglePin, onRename, onAssign, reorder, }: ProjectCardActionsProps): import("react").JSX.Element;
export {};
