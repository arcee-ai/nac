import type { SessionBehavior, SessionLineage, TraditionalChildStatus } from "../../types/api";
export type SubagentTarget = {
    mode: "new-agent";
} | {
    mode: "new-orchestrator";
} | {
    mode: "child" | "orchestrator";
    id: string;
    description: string;
    status: TraditionalChildStatus;
    background: boolean;
};
/**
 * Sends, steers, or stops one parent-owned subagent. A new launch takes its
 * description from the first line of the prompt.
 */
export declare function SubagentComposer({ parentSessionId, target, permissionSessionId, permissionBehavior, requesterLabel, onStarted, autoFocus, focusRequest, showPermissions, }: {
    parentSessionId: string;
    target: SubagentTarget;
    permissionSessionId: string;
    permissionBehavior: SessionBehavior | null;
    requesterLabel?: string;
    onStarted?: (id: string) => void;
    autoFocus?: boolean;
    focusRequest?: number;
    /**
     * The parent composer and a running child's bridge already present permission
     * dialogs. The panel composer must not open a second copy of the same ask.
     */
    showPermissions?: boolean;
}): import("react").JSX.Element;
/** Composer on a child session page. Steering goes back through the parent. */
export declare function SubagentSessionComposer({ parentSessionId, sessionId, kind, description, behavior, }: {
    parentSessionId: string;
    sessionId: string;
    kind: SessionLineage["kind"];
    description: string;
    behavior: SessionBehavior | null;
}): import("react").JSX.Element;
