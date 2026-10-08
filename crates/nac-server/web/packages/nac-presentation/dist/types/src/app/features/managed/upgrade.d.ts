export interface ManagedUpgradeReleaseIdentity {
    release_id: string;
    source_revision: string;
    build_id: string;
    product_version: string;
    schema_version: number;
}
export type ManagedUpgradeOperationState = "pending" | "preparing" | "blocked" | "safe-to-stop" | "replacing" | "starting/migrating" | "verifying" | "succeeded" | "failed";
export type ManagedUpgradeBlockerKind = "active_run" | "compaction" | "traditional_child" | "managed_orchestrator" | "terminal_process" | "clone_operation" | "workspace_mutation" | "operation_lease" | "resource_lease" | "maintenance_operation" | "host-release" | "host-readiness" | "maintenance";
export type ManagedUpgradeBlockerAction = "wait" | "cancel_active_run" | "cancel_traditional_child" | "cancel_managed_orchestrator" | "terminate_terminal" | "cancel_clone_operation";
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
        distance: {
            accepted_releases: number;
        } | null;
    };
    operation: ManagedUpgradeOperation | null;
}
export interface ManagedUpgradeRecovery {
    message: string;
    retryLabel: string | null;
}
export declare function managedUpgradeRequiresFreshSnapshot(error: unknown): boolean;
export declare function managedUpgradeAuthorityChanged(error: unknown): boolean;
export declare function managedUpgradeRecovery(error: unknown): ManagedUpgradeRecovery;
export declare function managedUpgradeIsActive(state: ManagedUpgradeOperationState): boolean;
export declare function managedUpgradePhaseLabel(state: ManagedUpgradeOperationState): string;
export declare function managedUpgradeActionLabel(action: ManagedUpgradeBlockerAction): string;
export declare function managedUpgradeDistanceLabel(distance: number | null): string;
export declare function sameManagedRelease(left: ManagedUpgradeReleaseIdentity, right: ManagedUpgradeReleaseIdentity): boolean;
