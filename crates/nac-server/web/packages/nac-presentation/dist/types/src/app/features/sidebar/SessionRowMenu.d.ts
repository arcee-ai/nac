import type { MouseEvent } from "react";
export interface SessionRowMenuProps {
    title: string;
    pinned?: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Phone menu rows: a 44px trigger. Coarse pointers get one through CSS. */
    touch?: boolean;
    /** Reveal classes for the trigger (hover/focus on fine pointers). */
    className?: string;
    onRename?: () => void;
    onPin?: () => void;
    /** Files a session that belongs to no project. */
    onAssign?: () => void;
    /** Opens the full-name disclosure; receives the selecting event for focus return. */
    onViewName?: (event: MouseEvent<HTMLButtonElement>) => void;
    /** Starts the existing delete confirmation. */
    onDelete?: () => void;
}
/**
 * A session row's one "⋯" control. Every row action lives in this menu, so the
 * row itself stays a single quiet line: rename, pin, move to a project, the
 * full name, and delete last. Item names keep the row's title ("Rename …").
 */
export declare function SessionRowMenu({ title, pinned, open, onOpenChange, touch, className, onRename, onPin, onAssign, onViewName, onDelete, }: SessionRowMenuProps): import("react").JSX.Element;
