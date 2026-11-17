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
}
/**
 * The right column of the session screen: one box with the Insights / Files /
 * Worksets / Subagents panels, sized by the shared layout store. Session
 * switching lives in the left sidebar. On a phone the panels are the body of
 * the modal box that SessionPage puts them in, each screen heading itself with
 * the way out and the tab bar the dialog lends it.
 */
export declare function SessionSideBox({ sessionId, snapshot, behavior: behaviorProp, panel, onPanelChange, }: SessionSideBoxProps): import("react").JSX.Element;
export {};
