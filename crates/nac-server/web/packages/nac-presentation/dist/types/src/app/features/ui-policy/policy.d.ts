import type { ManagedSessionSummary, SessionBehavior, SessionLineage } from "../../types/api";
export interface UiPolicy {
    orchestrationEnabled: boolean;
}
export declare const DIRECT_UI_POLICY: UiPolicy;
export declare const ORCHESTRATION_UI_POLICY: UiPolicy;
export declare function creationBehavior(policy: UiPolicy, selected: SessionBehavior): SessionBehavior;
export declare function sessionAvailable(policy: UiPolicy, behavior: SessionBehavior | null | undefined, lineage: SessionLineage | null | undefined): boolean;
export declare function visibleSessions(policy: UiPolicy, sessions: ManagedSessionSummary[]): {
    active: boolean;
    active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
    lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
    summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
    workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
}[];
/** Existing API callers retain first_chat's newest-primary semantics. */
export declare function firstChatAdmission(policy: UiPolicy, sessions: ManagedSessionSummary[], projectId: string): boolean;
