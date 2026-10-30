import type { SessionBehavior, SessionLineage, TraditionalChildStatus } from "../../types/api";
export interface SubagentTarget {
    mode: "child" | "orchestrator";
    id: string;
    description: string;
    status: TraditionalChildStatus;
    background: boolean;
}
/** Sends, steers, or stops one existing parent-owned subagent. */
export declare function SubagentComposer({ parentSessionId, target, permissionSessionId, permissionBehavior, requesterLabel, showPermissions, floating, }: {
    parentSessionId: string;
    target: SubagentTarget;
    permissionSessionId: string;
    permissionBehavior: SessionBehavior | null;
    requesterLabel?: string;
    /**
     * The parent composer and a running child's bridge already present permission
     * dialogs. The panel composer must not open a second copy of the same ask.
     */
    showPermissions?: boolean;
    floating?: boolean;
}): import("react").JSX.Element;
/** Composer on a child session page. Steering goes back through the parent. */
export declare function SubagentSessionComposer({ parentSessionId, sessionId, kind, description, behavior, }: {
    parentSessionId: string;
    sessionId: string;
    kind: SessionLineage["kind"];
    description: string;
    behavior: SessionBehavior | null;
}): import("react").JSX.Element;
