import { type UseQueryOptions } from "@tanstack/react-query";
import type { ManagedSessionSummary, SessionSnapshotResponse, SessionSummarySnapshot, UpdateConfigRequest } from "../../types/api";
export declare function useSessions(pollMs?: number): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    active: boolean;
    active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
    attention_revision?: number;
    attention_updated_at?: string | null;
    heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
    lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
    summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
    workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
}[]>, Error>;
export declare function mergeWorkspaceStats(base: ManagedSessionSummary[], stats: ManagedSessionSummary[]): ManagedSessionSummary[];
export declare function useSessionsWithWorkspaceStats(cadence?: {
    baseMs: number;
    statsMs: number;
}): {
    data: {
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[] | undefined;
    error: Error;
    isError: true;
    isPending: false;
    isLoading: false;
    isLoadingError: false;
    isRefetchError: true;
    isSuccess: false;
    isPlaceholderData: false;
    status: "error";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: import("@tanstack/query-core").RefetchOptions) => Promise<import("@tanstack/query-core").QueryObserverResult<NoInfer<{
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[]>>;
} | {
    data: {
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[] | undefined;
    error: null;
    isError: false;
    isPending: false;
    isLoading: false;
    isLoadingError: false;
    isRefetchError: false;
    isSuccess: true;
    isPlaceholderData: false;
    status: "success";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: import("@tanstack/query-core").RefetchOptions) => Promise<import("@tanstack/query-core").QueryObserverResult<NoInfer<{
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[]>>;
} | {
    data: {
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[] | undefined;
    error: Error;
    isError: true;
    isPending: false;
    isLoading: false;
    isLoadingError: true;
    isRefetchError: false;
    isSuccess: false;
    isPlaceholderData: false;
    status: "error";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: import("@tanstack/query-core").RefetchOptions) => Promise<import("@tanstack/query-core").QueryObserverResult<NoInfer<{
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[]>>;
} | {
    data: {
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[] | undefined;
    error: null;
    isError: false;
    isPending: true;
    isLoading: true;
    isLoadingError: false;
    isRefetchError: false;
    isSuccess: false;
    isPlaceholderData: false;
    status: "pending";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: import("@tanstack/query-core").RefetchOptions) => Promise<import("@tanstack/query-core").QueryObserverResult<NoInfer<{
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[]>>;
} | {
    data: {
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[] | undefined;
    error: null;
    isError: false;
    isPending: true;
    isLoadingError: false;
    isRefetchError: false;
    isSuccess: false;
    isPlaceholderData: false;
    status: "pending";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isLoading: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: import("@tanstack/query-core").RefetchOptions) => Promise<import("@tanstack/query-core").QueryObserverResult<NoInfer<{
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[]>>;
} | {
    data: {
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[] | undefined;
    isError: false;
    error: null;
    isPending: false;
    isLoading: false;
    isLoadingError: false;
    isRefetchError: false;
    isSuccess: true;
    isPlaceholderData: true;
    status: "success";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: import("@tanstack/query-core").RefetchOptions) => Promise<import("@tanstack/query-core").QueryObserverResult<NoInfer<{
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
        attention_revision?: number;
        attention_updated_at?: string | null;
        heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
        lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
    }[]>>;
};
/**
 * The single summary a session screen needs, picked out of the polled list.
 *
 * Subscribing to the whole list would re-render the chat every five seconds
 * over changes to unrelated sessions; the selected entry keeps its identity
 * across a refetch that did not touch it, so the transcript stays put.
 */
export declare function useSessionSummary(id: string | null): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    active: boolean;
    active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
    attention_revision?: number;
    attention_updated_at?: string | null;
    heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
    lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
    summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
    workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
} | null>, Error>;
export declare function useSessionSnapshot(id: string | null, options?: Partial<UseQueryOptions<SessionSnapshotResponse>>): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    active_compaction?: import("../../types/openapi.generated").components["schemas"]["ActiveCompactionSnapshot"] | null;
    active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
    forks?: import("../../types/openapi.generated").components["schemas"]["SessionForkLink"][];
    message_created_at?: (string | null)[];
    messages: import("../../types/openapi.generated").components["schemas"]["Message"][];
    metadata: import("../../types/openapi.generated").components["schemas"]["SessionMetadata"];
    primary_tool_events?: import("../../types/openapi.generated").components["schemas"]["AgentEvent"][];
    response_timing: import("../../types/openapi.generated").components["schemas"]["ResponseTimingSnapshot"];
    run_failure?: import("../../types/openapi.generated").components["schemas"]["RunFailure"] | null;
    session_event_boundary: import("../../types/openapi.generated").components["schemas"]["SessionEventBoundary"];
    session_event_diagnostics?: import("../../types/openapi.generated").components["schemas"]["SessionEventDecodeDiagnostic"][];
    sessions: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"][];
    shell_commands?: import("../../types/openapi.generated").components["schemas"]["ShellCommandSnapshot"][];
    transcript_recovery_warning?: string | null;
    workspace: import("../../types/openapi.generated").components["schemas"]["WorkspaceSnapshot"];
} & {
    lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
    message_cycle?: import("../../types/openapi.generated").components["schemas"]["MessageCycleMetadata"] | null;
    message_page?: import("../../types/openapi.generated").components["schemas"]["MessagePageMetadata"] | null;
    terminal_selection_attributions?: import("../../types/openapi.generated").components["schemas"]["TerminalSelectionMessageReference"][];
    tool_call_occurrences?: (string | null)[];
}>, Error>;
export declare function useLoadOlderMessages(id: string): import("@tanstack/react-query").UseMutationResult<boolean, Error, void, unknown>;
export declare function useSessionConfig(id: string | null): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    allow_insecure_http: boolean;
    api_key_env: string | null;
    automatic_compaction?: boolean;
    backend: string | null;
    base_url: string;
    compaction_threshold: number | null;
    config_version: number;
    diagnostics?: string[];
    extra_headers_json: string | null;
    model: string;
    reasoning_effort: string | null;
    service_tier?: string | null;
    session_id: string;
}>, Error>;
export declare function useCreateSession(): import("@tanstack/react-query").UseMutationResult<{
    active_compaction?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ActiveCompactionSnapshot"] | null;
    active_run?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
    forks?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkLink"][];
    message_created_at?: (string | null)[];
    messages: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["Message"][];
    metadata: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionMetadata"];
    primary_tool_events?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["AgentEvent"][];
    response_timing: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ResponseTimingSnapshot"];
    run_failure?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["RunFailure"] | null;
    session_event_boundary: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionEventBoundary"];
    session_event_diagnostics?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionEventDecodeDiagnostic"][];
    sessions: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionSummarySnapshot"][];
    shell_commands?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ShellCommandSnapshot"][];
    transcript_recovery_warning?: string | null;
    workspace: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["WorkspaceSnapshot"];
} & {
    lineage?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
    message_cycle?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["MessageCycleMetadata"] | null;
    message_page?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["MessagePageMetadata"] | null;
    terminal_selection_attributions?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["TerminalSelectionMessageReference"][];
    tool_call_occurrences?: (string | null)[];
}, Error, {
    allow_insecure_http?: import("../../types/openapi.generated").components["schemas"]["RequestField_bool_bool"];
    api_key_env?: import("../../types/openapi.generated").components["schemas"]["RequestField_String_String"];
    backend?: import("../../types/openapi.generated").components["schemas"]["RequestField_String_String"];
    base_url?: import("../../types/openapi.generated").components["schemas"]["RequestField_String_String"];
    behavior?: import("../../types/openapi.generated").components["schemas"]["SessionBehavior"];
    compaction_threshold?: import("../../types/openapi.generated").components["schemas"]["RequestField_u64_u64"];
    cwd?: string | null;
    extra_headers?: import("../../types/openapi.generated").components["schemas"]["RequestField_HeadersRequest_HeadersRequest"];
    first_chat?: boolean;
    first_chat_require_matching_model?: boolean;
    first_chat_same_behavior?: boolean;
    model?: import("../../types/openapi.generated").components["schemas"]["RequestField_String_String"];
    model_source?: import("../../types/openapi.generated").components["schemas"]["ProjectModelSourceRef"] | null;
    project_id?: string | null;
    reasoning_effort?: import("../../types/openapi.generated").components["schemas"]["RequestField_String_String"];
    sandbox?: import("../../types/openapi.generated").components["schemas"]["SandboxRequest"];
    service_tier?: import("../../types/openapi.generated").components["schemas"]["RequestField_String_String"];
    ssh_host?: string | null;
    ssh_identity_file?: string | null;
    ssh_port?: number | null;
}, unknown>;
export declare function useDeleteSession(): import("@tanstack/react-query").UseMutationResult<void, Error, string, unknown>;
export interface RenameSessionVariables {
    id: string;
    /** Empty string restores the automatic title (the last prompt). */
    title: string;
    pinned: boolean;
    expectedVersion: number;
}
export declare function useUpdatePresentation(): import("@tanstack/react-query").UseMutationResult<{
    backend: string;
    behavior?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionBehavior"];
    created_at: string;
    cwd: string;
    forked_from?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"] | null;
    last_user_prompt: string | null;
    model: string;
    model_config_error?: string | null;
    pinned?: boolean;
    presentation_version?: number;
    project_id?: string | null;
    run_count?: number;
    sandboxed: boolean;
    session_id: string;
    sort_order?: number;
    speed_tier_charges_excluded?: boolean;
    ssh_host: string | null;
    ssh_identity_file?: string | null;
    ssh_port?: number | null;
    title: string | null;
    total_cost_micros?: number | null;
    total_tokens?: number | null;
    updated_at: string;
    visible_message_count: number;
}, Error, RenameSessionVariables, unknown>;
/** Pin toggle is a presentation update that keeps the current title. */
export declare function useTogglePin(): {
    toggle: (summary: SessionSummarySnapshot) => Promise<{
        backend: string;
        behavior?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionBehavior"];
        created_at: string;
        cwd: string;
        forked_from?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"] | null;
        last_user_prompt: string | null;
        model: string;
        model_config_error?: string | null;
        pinned?: boolean;
        presentation_version?: number;
        project_id?: string | null;
        run_count?: number;
        sandboxed: boolean;
        session_id: string;
        sort_order?: number;
        speed_tier_charges_excluded?: boolean;
        ssh_host: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        title: string | null;
        total_cost_micros?: number | null;
        total_tokens?: number | null;
        updated_at: string;
        visible_message_count: number;
    }>;
    data: undefined;
    variables: undefined;
    error: null;
    isError: false;
    isIdle: true;
    isPending: false;
    isSuccess: false;
    status: "idle";
    mutate: import("@tanstack/react-query").UseMutateFunction<{
        backend: string;
        behavior?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionBehavior"];
        created_at: string;
        cwd: string;
        forked_from?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"] | null;
        last_user_prompt: string | null;
        model: string;
        model_config_error?: string | null;
        pinned?: boolean;
        presentation_version?: number;
        project_id?: string | null;
        run_count?: number;
        sandboxed: boolean;
        session_id: string;
        sort_order?: number;
        speed_tier_charges_excluded?: boolean;
        ssh_host: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        title: string | null;
        total_cost_micros?: number | null;
        total_tokens?: number | null;
        updated_at: string;
        visible_message_count: number;
    }, Error, RenameSessionVariables, unknown>;
    reset: () => void;
    context: unknown;
    failureCount: number;
    failureReason: Error | null;
    isPaused: boolean;
    submittedAt: number;
    mutateAsync: import("@tanstack/react-query").UseMutateAsyncFunction<{
        backend: string;
        behavior?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionBehavior"];
        created_at: string;
        cwd: string;
        forked_from?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"] | null;
        last_user_prompt: string | null;
        model: string;
        model_config_error?: string | null;
        pinned?: boolean;
        presentation_version?: number;
        project_id?: string | null;
        run_count?: number;
        sandboxed: boolean;
        session_id: string;
        sort_order?: number;
        speed_tier_charges_excluded?: boolean;
        ssh_host: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        title: string | null;
        total_cost_micros?: number | null;
        total_tokens?: number | null;
        updated_at: string;
        visible_message_count: number;
    }, Error, RenameSessionVariables, unknown>;
} | {
    toggle: (summary: SessionSummarySnapshot) => Promise<{
        backend: string;
        behavior?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionBehavior"];
        created_at: string;
        cwd: string;
        forked_from?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"] | null;
        last_user_prompt: string | null;
        model: string;
        model_config_error?: string | null;
        pinned?: boolean;
        presentation_version?: number;
        project_id?: string | null;
        run_count?: number;
        sandboxed: boolean;
        session_id: string;
        sort_order?: number;
        speed_tier_charges_excluded?: boolean;
        ssh_host: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        title: string | null;
        total_cost_micros?: number | null;
        total_tokens?: number | null;
        updated_at: string;
        visible_message_count: number;
    }>;
    data: undefined;
    variables: RenameSessionVariables;
    error: null;
    isError: false;
    isIdle: false;
    isPending: true;
    isSuccess: false;
    status: "pending";
    mutate: import("@tanstack/react-query").UseMutateFunction<{
        backend: string;
        behavior?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionBehavior"];
        created_at: string;
        cwd: string;
        forked_from?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"] | null;
        last_user_prompt: string | null;
        model: string;
        model_config_error?: string | null;
        pinned?: boolean;
        presentation_version?: number;
        project_id?: string | null;
        run_count?: number;
        sandboxed: boolean;
        session_id: string;
        sort_order?: number;
        speed_tier_charges_excluded?: boolean;
        ssh_host: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        title: string | null;
        total_cost_micros?: number | null;
        total_tokens?: number | null;
        updated_at: string;
        visible_message_count: number;
    }, Error, RenameSessionVariables, unknown>;
    reset: () => void;
    context: unknown;
    failureCount: number;
    failureReason: Error | null;
    isPaused: boolean;
    submittedAt: number;
    mutateAsync: import("@tanstack/react-query").UseMutateAsyncFunction<{
        backend: string;
        behavior?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionBehavior"];
        created_at: string;
        cwd: string;
        forked_from?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"] | null;
        last_user_prompt: string | null;
        model: string;
        model_config_error?: string | null;
        pinned?: boolean;
        presentation_version?: number;
        project_id?: string | null;
        run_count?: number;
        sandboxed: boolean;
        session_id: string;
        sort_order?: number;
        speed_tier_charges_excluded?: boolean;
        ssh_host: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        title: string | null;
        total_cost_micros?: number | null;
        total_tokens?: number | null;
        updated_at: string;
        visible_message_count: number;
    }, Error, RenameSessionVariables, unknown>;
} | {
    toggle: (summary: SessionSummarySnapshot) => Promise<{
        backend: string;
        behavior?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionBehavior"];
        created_at: string;
        cwd: string;
        forked_from?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"] | null;
        last_user_prompt: string | null;
        model: string;
        model_config_error?: string | null;
        pinned?: boolean;
        presentation_version?: number;
        project_id?: string | null;
        run_count?: number;
        sandboxed: boolean;
        session_id: string;
        sort_order?: number;
        speed_tier_charges_excluded?: boolean;
        ssh_host: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        title: string | null;
        total_cost_micros?: number | null;
        total_tokens?: number | null;
        updated_at: string;
        visible_message_count: number;
    }>;
    data: undefined;
    error: Error;
    variables: RenameSessionVariables;
    isError: true;
    isIdle: false;
    isPending: false;
    isSuccess: false;
    status: "error";
    mutate: import("@tanstack/react-query").UseMutateFunction<{
        backend: string;
        behavior?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionBehavior"];
        created_at: string;
        cwd: string;
        forked_from?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"] | null;
        last_user_prompt: string | null;
        model: string;
        model_config_error?: string | null;
        pinned?: boolean;
        presentation_version?: number;
        project_id?: string | null;
        run_count?: number;
        sandboxed: boolean;
        session_id: string;
        sort_order?: number;
        speed_tier_charges_excluded?: boolean;
        ssh_host: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        title: string | null;
        total_cost_micros?: number | null;
        total_tokens?: number | null;
        updated_at: string;
        visible_message_count: number;
    }, Error, RenameSessionVariables, unknown>;
    reset: () => void;
    context: unknown;
    failureCount: number;
    failureReason: Error | null;
    isPaused: boolean;
    submittedAt: number;
    mutateAsync: import("@tanstack/react-query").UseMutateAsyncFunction<{
        backend: string;
        behavior?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionBehavior"];
        created_at: string;
        cwd: string;
        forked_from?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"] | null;
        last_user_prompt: string | null;
        model: string;
        model_config_error?: string | null;
        pinned?: boolean;
        presentation_version?: number;
        project_id?: string | null;
        run_count?: number;
        sandboxed: boolean;
        session_id: string;
        sort_order?: number;
        speed_tier_charges_excluded?: boolean;
        ssh_host: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        title: string | null;
        total_cost_micros?: number | null;
        total_tokens?: number | null;
        updated_at: string;
        visible_message_count: number;
    }, Error, RenameSessionVariables, unknown>;
} | {
    toggle: (summary: SessionSummarySnapshot) => Promise<{
        backend: string;
        behavior?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionBehavior"];
        created_at: string;
        cwd: string;
        forked_from?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"] | null;
        last_user_prompt: string | null;
        model: string;
        model_config_error?: string | null;
        pinned?: boolean;
        presentation_version?: number;
        project_id?: string | null;
        run_count?: number;
        sandboxed: boolean;
        session_id: string;
        sort_order?: number;
        speed_tier_charges_excluded?: boolean;
        ssh_host: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        title: string | null;
        total_cost_micros?: number | null;
        total_tokens?: number | null;
        updated_at: string;
        visible_message_count: number;
    }>;
    data: {
        backend: string;
        behavior?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionBehavior"];
        created_at: string;
        cwd: string;
        forked_from?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"] | null;
        last_user_prompt: string | null;
        model: string;
        model_config_error?: string | null;
        pinned?: boolean;
        presentation_version?: number;
        project_id?: string | null;
        run_count?: number;
        sandboxed: boolean;
        session_id: string;
        sort_order?: number;
        speed_tier_charges_excluded?: boolean;
        ssh_host: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        title: string | null;
        total_cost_micros?: number | null;
        total_tokens?: number | null;
        updated_at: string;
        visible_message_count: number;
    };
    error: null;
    variables: RenameSessionVariables;
    isError: false;
    isIdle: false;
    isPending: false;
    isSuccess: true;
    status: "success";
    mutate: import("@tanstack/react-query").UseMutateFunction<{
        backend: string;
        behavior?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionBehavior"];
        created_at: string;
        cwd: string;
        forked_from?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"] | null;
        last_user_prompt: string | null;
        model: string;
        model_config_error?: string | null;
        pinned?: boolean;
        presentation_version?: number;
        project_id?: string | null;
        run_count?: number;
        sandboxed: boolean;
        session_id: string;
        sort_order?: number;
        speed_tier_charges_excluded?: boolean;
        ssh_host: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        title: string | null;
        total_cost_micros?: number | null;
        total_tokens?: number | null;
        updated_at: string;
        visible_message_count: number;
    }, Error, RenameSessionVariables, unknown>;
    reset: () => void;
    context: unknown;
    failureCount: number;
    failureReason: Error | null;
    isPaused: boolean;
    submittedAt: number;
    mutateAsync: import("@tanstack/react-query").UseMutateAsyncFunction<{
        backend: string;
        behavior?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionBehavior"];
        created_at: string;
        cwd: string;
        forked_from?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"] | null;
        last_user_prompt: string | null;
        model: string;
        model_config_error?: string | null;
        pinned?: boolean;
        presentation_version?: number;
        project_id?: string | null;
        run_count?: number;
        sandboxed: boolean;
        session_id: string;
        sort_order?: number;
        speed_tier_charges_excluded?: boolean;
        ssh_host: string | null;
        ssh_identity_file?: string | null;
        ssh_port?: number | null;
        title: string | null;
        total_cost_micros?: number | null;
        total_tokens?: number | null;
        updated_at: string;
        visible_message_count: number;
    }, Error, RenameSessionVariables, unknown>;
};
export interface MoveSessionOrderVariables {
    /** Full unfiltered list — `/sessions/order` requires entire pin-group membership. */
    sessions: ManagedSessionSummary[];
    sessionId: string;
    targetPinned: boolean;
    /** Index within the destination pin group after the move. */
    targetIndex: number;
}
/**
 * Reorder within a pin group, optionally pinning/unpinning first when the
 * destination group differs. One invalidation at the end.
 */
export declare function useMoveSessionOrder(): import("@tanstack/react-query").UseMutationResult<{
    pinned: boolean;
    sessions: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionSummarySnapshot"][];
} | null, Error, MoveSessionOrderVariables, unknown>;
export declare function useUpdateConfig(): import("@tanstack/react-query").UseMutationResult<void, Error, {
    id: string;
    patch: UpdateConfigRequest;
}, unknown>;
export declare function useSubmitRun(): import("@tanstack/react-query").UseMutationResult<{
    client_id?: string | null;
    display_prompt: string;
    run_id: string;
}, Error, {
    id: string;
    prompt: string;
    signal?: AbortSignal;
}, unknown>;
export declare function useCancelRun(): import("@tanstack/react-query").UseMutationResult<void, Error, string, unknown>;
export declare function useCompactSession(): import("@tanstack/react-query").UseMutationResult<{
    compaction_id: string;
    status: "compacted";
} | {
    compaction_id: string;
    reason: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["CompactionSkipReason"];
    status: "unchanged";
}, Error, string, unknown>;
/**
 * A revert rewrites the transcript and the checkout at once. Invalidating the
 * session root drops the snapshot, thread history, file data, and revision
 * views that the reverted state invalidated.
 */
export declare function useRevertSession(): import("@tanstack/react-query").UseMutationResult<{
    messages_removed: number;
    revisions_removed: number;
    transcript_len: number;
    workspace_restored: boolean;
}, Error, {
    id: string;
    messageIdx: number;
}, unknown>;
/**
 * Answering a prompt again is a revert plus a run, so it drops the same views a
 * revert does before the new run starts filling them back in.
 */
export declare function useRegenerateRun(): import("@tanstack/react-query").UseMutationResult<{
    client_id?: string | null;
    display_prompt: string;
    run_id: string;
}, Error, {
    id: string;
    messageIdx: number;
}, unknown>;
/**
 * Clone the transcript through a finished model turn into a new session, then
 * open that chat. The source snapshot has to refetch so the fork marker lands
 * under the turn that was copied.
 */
export declare function useForkSession(): import("@tanstack/react-query").UseMutationResult<{
    session_id: string;
}, Error, {
    id: string;
    messageIdx: number;
}, unknown>;
export declare function useDismissSessionFork(): import("@tanstack/react-query").UseMutationResult<void, Error, {
    id: string;
    forkId: string;
}, unknown>;
export declare function useVisibleSessions(): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    active: boolean;
    active_run?: import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"] | null;
    attention_revision?: number;
    attention_updated_at?: string | null;
    heartbeat_results?: import("../../types/openapi.generated").components["schemas"]["HeartbeatAttentionResult"][];
    lineage?: import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"] | null;
    summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
    workspace_diff?: import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"] | null;
}[]>, Error>;
