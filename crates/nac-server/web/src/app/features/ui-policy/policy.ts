import type { ManagedSessionSummary, SessionBehavior, SessionLineage } from "@/app/types/api";

export interface UiPolicy {
  orchestrationEnabled: boolean;
}

export const DIRECT_UI_POLICY: UiPolicy = { orchestrationEnabled: false };
export const ORCHESTRATION_UI_POLICY: UiPolicy = { orchestrationEnabled: true };

export function creationBehavior(policy: UiPolicy, selected: SessionBehavior): SessionBehavior {
  return policy.orchestrationEnabled ? selected : "direct";
}

export function sessionAvailable(
  policy: UiPolicy,
  behavior: SessionBehavior | null | undefined,
  lineage: SessionLineage | null | undefined,
): boolean {
  return (
    policy.orchestrationEnabled ||
    (behavior === "direct" && lineage?.kind !== "managed-orchestrator")
  );
}

export function visibleSessions(policy: UiPolicy, sessions: ManagedSessionSummary[]) {
  return sessions.filter((entry) =>
    sessionAvailable(policy, entry.summary.behavior, entry.lineage),
  );
}

/** Existing API callers retain first_chat's newest-primary semantics. */
export function firstChatAdmission(
  policy: UiPolicy,
  sessions: ManagedSessionSummary[],
  projectId: string,
) {
  return (
    policy.orchestrationEnabled ||
    !sessions.some((entry) => entry.lineage == null && entry.summary.project_id === projectId)
  );
}
