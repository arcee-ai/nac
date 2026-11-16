import type { SessionStatus } from "../../lib/sessionStatus";
export interface SessionRowProps {
    title: string;
    /** Accessible name of the row button (title, plus the behavior when shown). */
    label: string;
    status: SessionStatus;
    updatedAt: string;
    now: number;
    active: boolean;
    depth?: number;
    pinned?: boolean;
    /** Direct children; zero hides the subagent toggle. */
    childCount?: number;
    expanded?: boolean;
    onToggleChildren?: () => void;
    /** Phone menu rows: 44px targets and always-visible actions. */
    touch?: boolean;
    onOpen: () => void;
    onPin?: () => void;
    onRename?: () => void;
    onDelete?: () => void;
    onAssign?: () => void;
}
/**
 * One 32px session row: status dot, title, tabular age. Row actions take the
 * age's place on hover or keyboard focus, and stay visible on coarse pointers.
 * The title button stretches over the whole row; the controls sit above it.
 */
export declare function SessionRow({ title, label, status, updatedAt, now, active, depth, pinned, childCount, expanded, onToggleChildren, touch, onOpen, onPin, onRename, onDelete, onAssign, }: SessionRowProps): import("react").JSX.Element;
