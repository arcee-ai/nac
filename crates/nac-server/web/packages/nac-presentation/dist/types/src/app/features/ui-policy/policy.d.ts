import type { ManagedSessionView as ManagedSessionSummary } from "../public-native/collectionViews.js";
import type { SessionBehavior, SessionLineage } from "../../types/api.js";
export interface UiPolicy {
    orchestrationEnabled: boolean;
}
export declare const DIRECT_UI_POLICY: UiPolicy;
export declare const ORCHESTRATION_UI_POLICY: UiPolicy;
export declare function creationBehavior(policy: UiPolicy, selected: SessionBehavior): SessionBehavior;
export declare function sessionAvailable(policy: UiPolicy, behavior: SessionBehavior | null | undefined, lineage: SessionLineage | null | undefined): boolean;
export declare function visibleSessions(policy: UiPolicy, sessions: ManagedSessionSummary[]): ManagedSessionSummary[];
/** Existing API callers retain first_chat's newest-primary semantics. */
export declare function firstChatAdmission(policy: UiPolicy, sessions: ManagedSessionSummary[], projectId: string): boolean;
