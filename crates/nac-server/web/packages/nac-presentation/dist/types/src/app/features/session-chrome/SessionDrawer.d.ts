import { type SessionPanel } from "../../lib/routes";
import type { SessionBehavior, SessionSnapshotResponse } from "../../types/api";
/**
 * The session's one secondary surface. Floating, it is the shared `Drawer`:
 * 560px from the right (full width on request) or a bottom sheet on a phone.
 * Docked (⌘\), it is a column laid out beside the chat column, never inside
 * it. The route's panel picks what it shows; the goal has a drawer of its own.
 */
export declare function SessionDrawer({ sessionId, snapshot, behavior, panel, goalEnabled, }: {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    behavior: SessionBehavior | null;
    /** The route's panel after the behavior policy corrected it. */
    panel: SessionPanel;
    /** Whether this session can carry a goal (a direct, non-delegated agent). */
    goalEnabled: boolean;
}): import("react").JSX.Element;
