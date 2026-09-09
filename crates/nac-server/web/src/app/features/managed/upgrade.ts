export interface ManagedUpgradeReleaseIdentity {
  release_id: string;
  source_revision: string;
  build_id: string;
  product_version: string;
  schema_version: number;
}

export type ManagedUpgradeOperationState =
  | "pending"
  | "preparing"
  | "blocked"
  | "safe-to-stop"
  | "replacing"
  | "starting/migrating"
  | "verifying"
  | "succeeded"
  | "failed";

export type ManagedUpgradeBlockerKind =
  | "active_run"
  | "compaction"
  | "traditional_child"
  | "managed_orchestrator"
  | "terminal_process"
  | "clone_operation"
  | "workspace_mutation"
  | "operation_lease"
  | "resource_lease"
  | "maintenance_operation"
  | "host-release"
  | "host-readiness"
  | "maintenance";

export type ManagedUpgradeBlockerAction =
  | "wait"
  | "cancel_active_run"
  | "cancel_traditional_child"
  | "cancel_managed_orchestrator"
  | "terminate_terminal"
  | "cancel_clone_operation";

export interface ManagedUpgradeBlockerTarget {
  session_id?: string;
  run_id?: string;
  child_session_id?: string;
  orchestrator_session_id?: string;
  terminal_id?: string;
  clone_operation_id?: string;
}

export interface ManagedUpgradeBlocker {
  selection_key: string;
  kind: ManagedUpgradeBlockerKind;
  message: string;
  actionable: boolean;
  action: ManagedUpgradeBlockerAction;
  target: ManagedUpgradeBlockerTarget | null;
}

export interface ManagedUpgradeOperation {
  operation_id: string;
  managed_host_id: string;
  kind: "upgrade";
  state: ManagedUpgradeOperationState;
  reason?: string;
  message?: string;
  target_release?: ManagedUpgradeReleaseIdentity;
  desired_release?: ManagedUpgradeReleaseIdentity;
  observed_release?: ManagedUpgradeReleaseIdentity;
  blockers?: ManagedUpgradeBlocker[];
  created_at?: string;
  updated_at?: string;
}

export interface ManagedUpgradeSnapshot {
  preview: {
    current: ManagedUpgradeReleaseIdentity;
    latest_beta: ManagedUpgradeReleaseIdentity;
    upgrade_available: boolean;
    distance: { accepted_releases: number } | null;
  };
  operation: ManagedUpgradeOperation | null;
}

export interface ManagedUpgradeRecovery {
  message: string;
  retryLabel: string | null;
}

function managedUpgradeErrorStatus(error: unknown): unknown {
  return error !== null && typeof error === "object" && "status" in error
    ? (error as { status?: unknown }).status
    : null;
}

export function managedUpgradeRequiresFreshSnapshot(error: unknown): boolean {
  const status = managedUpgradeErrorStatus(error);
  return (
    status === 401 ||
    status === 403 ||
    status === 409 ||
    (error instanceof Error && error.name === "ManagedUpgradeContractError")
  );
}

export function managedUpgradeRecovery(error: unknown): ManagedUpgradeRecovery {
  const status = managedUpgradeErrorStatus(error);
  if (status === 401 || status === 403) {
    return {
      message:
        "This managed session is no longer authorized. Reopen this host from the Arcee portal.",
      retryLabel: null,
    };
  }
  if (status === 409) {
    return {
      message:
        "This host session changed. Refresh status or reopen this host from the Arcee portal.",
      retryLabel: "Refresh status",
    };
  }
  return {
    message:
      "The upgrade service is temporarily unavailable. Try again to resume the same request safely.",
    retryLabel: "Try again",
  };
}

const ACTIVE_UPGRADE_STATES = new Set<ManagedUpgradeOperationState>([
  "pending",
  "preparing",
  "blocked",
  "safe-to-stop",
  "replacing",
  "starting/migrating",
  "verifying",
]);

export function managedUpgradeIsActive(state: ManagedUpgradeOperationState): boolean {
  return ACTIVE_UPGRADE_STATES.has(state);
}

export function managedUpgradePhaseLabel(state: ManagedUpgradeOperationState): string {
  switch (state) {
    case "pending":
      return "Queued";
    case "preparing":
      return "Preparing this host";
    case "blocked":
      return "Waiting for active work";
    case "safe-to-stop":
      return "Ready to replace";
    case "replacing":
      return "Replacing NAC";
    case "starting/migrating":
      return "Starting and migrating";
    case "verifying":
      return "Verifying the replacement";
    case "succeeded":
      return "Upgrade complete";
    case "failed":
      return "Upgrade failed";
  }
}

export function managedUpgradeActionLabel(action: ManagedUpgradeBlockerAction): string {
  switch (action) {
    case "cancel_active_run":
      return "Stop run";
    case "cancel_traditional_child":
      return "Cancel coding agent";
    case "cancel_managed_orchestrator":
      return "Cancel NAC orchestrator";
    case "terminate_terminal":
      return "Stop terminal";
    case "cancel_clone_operation":
      return "Cancel clone";
    case "wait":
      return "Wait";
  }
}

export function managedUpgradeDistanceLabel(distance: number | null): string {
  if (distance === null) return "Accepted-release distance unavailable";
  if (distance === 0) return "Current accepted release";
  return `${distance} accepted ${distance === 1 ? "release" : "releases"} ahead`;
}

export function sameManagedRelease(
  left: ManagedUpgradeReleaseIdentity,
  right: ManagedUpgradeReleaseIdentity,
): boolean {
  return (
    left.release_id === right.release_id &&
    left.source_revision === right.source_revision &&
    left.build_id === right.build_id &&
    left.product_version === right.product_version &&
    left.schema_version === right.schema_version
  );
}
