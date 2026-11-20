import { type SessionPanel } from "../../lib/routes";
import type { SessionBehavior, SessionSnapshotResponse } from "../../types/api";
interface SessionSideBoxProps {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    /**
     * Null while the session has not loaded. Callers that omit it keep the
     * snapshot's behavior, and an omitted stored behavior stays orchestrator.
     */
    behavior?: SessionBehavior | null;
    panel: SessionPanel;
    onPanelChange: (panel: SessionPanel) => void;
    /** The drawer's way out. Omitted, the header has no Close (a bare test mount). */
    onClose?: () => void;
}
/**
 * The panels a session's drawer holds: Insights, Files (Changes), Subagents,
 * Terminal, Schedules, Worksets, History — whichever the session's behavior
 * has. On a wide screen it heads itself with a 52px bar: a quiet segmented
 * row to move between the panels, then close. On a
 * phone the drawer is a bottom sheet and each screen heads itself with the
 * way out the sheet lends it.
 */
export declare function SessionSideBox({ sessionId, snapshot, behavior: behaviorProp, panel, onPanelChange, onClose, }: SessionSideBoxProps): import("react").JSX.Element;
export {};
