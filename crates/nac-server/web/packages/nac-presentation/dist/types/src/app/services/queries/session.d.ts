import { type InfiniteData, type UseQueryOptions } from "@tanstack/react-query";
import type { ManagedSessionSummary, SessionSnapshotResponse, SessionSummarySnapshot, UpdateConfigRequest } from "../../types/api";
export declare function useSessions(pollMs?: number): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    active: boolean;
    active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
    lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
    summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
    workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
}[]>, Error>;
export declare function mergeWorkspaceStats(base: ManagedSessionSummary[], stats: ManagedSessionSummary[]): ManagedSessionSummary[];
export declare function useSessionsWithWorkspaceStats(cadence?: {
    baseMs: number;
    statsMs: number;
}): {
    data: {
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
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
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>>;
} | {
    data: {
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
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
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>>;
} | {
    data: {
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
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
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>>;
} | {
    data: {
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
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
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>>;
} | {
    data: {
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
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
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>>;
} | {
    data: {
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
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
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
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
    active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
    lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
    summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
    workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
} | null>, Error>;
export declare function useSessionSnapshot(id: string | null, options?: Partial<UseQueryOptions<SessionSnapshotResponse>>): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    active_compaction?: null | import("../../types/openapi.generated").components["schemas"]["ActiveCompactionSnapshot"];
    active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
    active_threads?: string[];
    covered_orchestrator_steering_ids?: number[];
    forks?: import("../../types/openapi.generated").components["schemas"]["SessionForkLink"][];
    message_created_at?: (string | null)[];
    messages: import("../../types/openapi.generated").components["schemas"]["Message"][];
    metadata: import("../../types/openapi.generated").components["schemas"]["SessionMetadata"];
    primary_tool_events?: import("../../types/openapi.generated").components["schemas"]["AgentEvent"][];
    response_timing: import("../../types/openapi.generated").components["schemas"]["ResponseTimingSnapshot"];
    run_failure?: null | import("../../types/openapi.generated").components["schemas"]["RunFailure"];
    sessions: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"][];
    thread_episodes: Record<string, import("../../types/openapi.generated").components["schemas"]["EpisodeSnapshot"][]>;
    thread_event_boundary: import("../../types/openapi.generated").components["schemas"]["SessionEventBoundary"];
    thread_event_diagnostics?: import("../../types/openapi.generated").components["schemas"]["ThreadEventDecodeDiagnostic"][];
    thread_events?: Record<string, import("../../types/openapi.generated").components["schemas"]["AgentEvent"][]>;
    thread_steering?: import("../../types/openapi.generated").components["schemas"]["ThreadSteeringRecord"][];
    threads: import("../../types/openapi.generated").components["schemas"]["ThreadSnapshot"][];
    transcript_recovery_warning?: string | null;
    worksets: import("../../types/openapi.generated").components["schemas"]["WorksetsSnapshot"];
    workspace: import("../../types/openapi.generated").components["schemas"]["WorkspaceSnapshot"];
} & {
    lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
    message_cycle?: null | import("../../types/openapi.generated").components["schemas"]["MessageCycleMetadata"];
    message_page?: null | import("../../types/openapi.generated").components["schemas"]["MessagePageMetadata"];
}>, Error>;
export declare function useLoadOlderMessages(id: string): import("@tanstack/react-query").UseMutationResult<boolean, Error, void, unknown>;
export declare function useThreadEventPages(id: string | null, threadName: string | null): import("@tanstack/react-query").UseInfiniteQueryResult<InfiniteData<{
    diagnostics?: import("../../types/openapi.generated").components["schemas"]["ThreadEventDecodeDiagnostic"][];
    events: import("../../types/openapi.generated").components["schemas"]["ThreadEventPageItem"][];
    has_older: boolean;
    next_before_id?: number | null;
    thread_event_boundary?: null | import("../../types/openapi.generated").components["schemas"]["SessionEventBoundary"];
}, number | null>, Error>;
export declare function useSessionConfig(id: string | null): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    allow_insecure_http: boolean;
    api_key_env: string | null;
    backend: string | null;
    base_url: string;
    config_version: number;
    diagnostics?: string[];
    extra_headers_json: string | null;
    light_model?: null | import("../../types/openapi.generated").components["schemas"]["LightModelSettings"];
    model: string;
    orchestrator_compaction_threshold: number | null;
    reasoning_effort: string | null;
    session_id: string;
}>, Error>;
export declare function useCreateSession(): import("@tanstack/react-query").UseMutationResult<{
    active_compaction?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ActiveCompactionSnapshot"];
    active_run?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
    active_threads?: string[];
    covered_orchestrator_steering_ids?: number[];
    forks?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkLink"][];
    message_created_at?: (string | null)[];
    messages: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["Message"][];
    metadata: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionMetadata"];
    primary_tool_events?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["AgentEvent"][];
    response_timing: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ResponseTimingSnapshot"];
    run_failure?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["RunFailure"];
    sessions: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionSummarySnapshot"][];
    thread_episodes: Record<string, import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["EpisodeSnapshot"][]>;
    thread_event_boundary: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionEventBoundary"];
    thread_event_diagnostics?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ThreadEventDecodeDiagnostic"][];
    thread_events?: Record<string, import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["AgentEvent"][]>;
    thread_steering?: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ThreadSteeringRecord"][];
    threads: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["ThreadSnapshot"][];
    transcript_recovery_warning?: string | null;
    worksets: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["WorksetsSnapshot"];
    workspace: import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["WorkspaceSnapshot"];
} & {
    lineage?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
    message_cycle?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["MessageCycleMetadata"];
    message_page?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["MessagePageMetadata"];
}, Error, {
    allow_insecure_http?: import("../../types/openapi.generated").components["schemas"]["RequestField_bool_bool"];
    api_key_env?: import("../../types/openapi.generated").components["schemas"]["RequestField_String_String"];
    backend?: import("../../types/openapi.generated").components["schemas"]["RequestField_String_String"];
    base_url?: import("../../types/openapi.generated").components["schemas"]["RequestField_String_String"];
    behavior?: import("../../types/openapi.generated").components["schemas"]["SessionBehavior"];
    cwd?: string | null;
    extra_headers?: import("../../types/openapi.generated").components["schemas"]["RequestField_HeadersRequest_HeadersRequest"];
    first_chat?: boolean;
    first_chat_same_behavior?: boolean;
    light_model?: import("../../types/openapi.generated").components["schemas"]["RequestField_LightModelSettings_LightModelSettings"];
    model?: import("../../types/openapi.generated").components["schemas"]["RequestField_String_String"];
    orchestrator_compaction_threshold?: import("../../types/openapi.generated").components["schemas"]["RequestField_u64_u64"];
    project_id?: string | null;
    reasoning_effort?: import("../../types/openapi.generated").components["schemas"]["RequestField_String_String"];
    sandbox?: import("../../types/openapi.generated").components["schemas"]["SandboxRequest"];
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
    forked_from?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"];
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
        forked_from?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"];
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
        forked_from?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"];
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
        forked_from?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"];
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
        forked_from?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"];
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
        forked_from?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"];
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
        forked_from?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"];
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
        forked_from?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"];
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
        forked_from?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"];
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
        forked_from?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"];
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
        forked_from?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"];
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
        forked_from?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"];
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
        forked_from?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"];
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
        forked_from?: null | import("../../../../packages/nac-client/src/openapi.generated").components["schemas"]["SessionForkOrigin"];
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
export declare function useSteerOrchestrator(): import("@tanstack/react-query").UseMutationResult<{
    instruction_preview: string;
    status: string;
    steering_id: number;
}, Error, {
    id: string;
    instruction: string;
}, unknown>;
export declare function useSteerThread(): import("@tanstack/react-query").UseMutationResult<{
    instruction_preview: string;
    status: string;
    steering_id: number;
    thread_name: string;
}, Error, {
    id: string;
    threadName: string;
    instruction: string;
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
    threads_removed: number;
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
export declare function useVisibleSessions(): {
    data: {
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
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
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>>;
} | {
    data: {
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
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
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>>;
} | {
    data: {
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
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
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>>;
} | {
    data: {
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
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
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>>;
} | {
    data: {
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
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
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>>;
} | {
    data: {
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
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
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        active: boolean;
        active_run?: null | import("../../types/openapi.generated").components["schemas"]["ActiveRunSnapshot"];
        lineage?: null | import("../../types/openapi.generated").components["schemas"]["SessionLineageSnapshot"];
        summary: import("../../types/openapi.generated").components["schemas"]["SessionSummarySnapshot"];
        workspace_diff?: null | import("../../types/openapi.generated").components["schemas"]["WorkspaceDiffTotals"];
    }[]>>;
};
