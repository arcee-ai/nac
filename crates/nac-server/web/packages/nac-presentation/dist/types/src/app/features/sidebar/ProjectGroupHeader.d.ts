import { type SessionStatus } from "../../lib/sessionStatus";
import type { ProjectRecord } from "../../types/api";
/**
 * A project's row in the sidebar: fold toggle with the name, then a quiet
 * "new session here" and an options menu (pin, rename, interval tasks, delete).
 */
export declare function ProjectGroupHeader({ project, count, expanded, status, touch, onToggle, onNavigate, }: {
    project: ProjectRecord;
    count: number;
    expanded: boolean;
    /** Rolled-up status, shown only while the group is folded. */
    status: SessionStatus;
    touch?: boolean;
    onToggle: () => void;
    /** Runs before any navigation this header starts (closes the phone menu). */
    onNavigate?: () => void;
}): import("react").JSX.Element;
