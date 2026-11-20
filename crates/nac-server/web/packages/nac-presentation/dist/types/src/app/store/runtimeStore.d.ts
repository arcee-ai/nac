import type { StreamStatus } from "../services/eventStream";
import type { ActiveRunSnapshot, AgentEvent, AssistantStreamDelta, SessionEventEnvelope, RunFailure, TokenUsage } from "../types/api";
export type RuntimeEventKind = "run" | "tool" | "mcp" | "assistant" | "steering" | "compaction" | "error";
export interface RuntimeEvent {
    seq: number | null;
    kind: RuntimeEventKind;
    text: string;
    isError: boolean;
    ts: number;
    local: boolean;
}
export interface RuntimeState {
    sessionId: string | null;
    running: boolean;
    activity: string;
    error: string | null;
    /**
     * The provider's own reason for refusing the current run's model call. The
     * terminal `run_failed` says only "run failed", so this is what turns the red
     * box into something the user can act on.
     */
    modelError: string | null;
    /** Structured terminal failure for recovery-aware transcript actions. */
    runFailure: RunFailure | null;
    /** Model request attempt currently replacing an abandoned partial stream. */
    modelRetryAttempt: number | null;
    streamStatus: StreamStatus;
    events: RuntimeEvent[];
    /** Safe top-level tool lifecycle overlays, merged with durable snapshot rows by call id. */
    primaryToolEvents: AgentEvent[];
    /** Prose the current model call has produced so far. */
    streamText: string;
    /** Reasoning the current model call has produced so far. */
    streamReasoning: string;
    /**
     * The buffers hold output that is already committed, so the next delta starts
     * a new call rather than appending to it. They are kept rather than cleared so
     * the transcript does not blink between the commit and the refetched snapshot;
     * the renderer drops whichever part the snapshot already covers.
     */
    streamSettled: boolean;
    streamPredatesPrompt: boolean;
    /** Run identity only when every retained delta carries that same identity. */
    streamRunId: string | null;
    streamIdentityEpoch: number;
    /**
     * Prompt shown in the chat from the moment Send is pressed until the
     * snapshot (or active_run) catches up. Without this the model pill appears
     * first and jumps down when the user bubble finally lands.
     */
    optimisticUserPrompt: string | null;
    optimisticPromptToken: number | null;
    optimisticPromptEpoch: number | null;
    optimisticPromptRunId: string | null;
    optimisticObservedRunId: string | null;
    optimisticIdentityTainted: boolean;
    optimisticPromptUncertain: boolean;
    dismissedPromptRunIds: string[];
    /**
     * What the current run has spent so far, summed from the usage events the
     * model calls emit. The snapshot only learns the run's usage once the run
     * ends, so this is the only account of an hour-long run in progress. It is
     * a delta over the snapshot totals, which stay fixed for the whole run.
     */
    runUsage: TokenUsage | null;
    /**
     * Session spend that only rises while this tab is open. Stop must not drop
     * the composer totals back to a zero snapshot; `run_started` only clears
     * the live delta above.
     */
    sessionSpend: TokenUsage | null;
    /**
     * Wall-clock start of the current run, kept after Stop so the composer
     * clock can keep showing elapsed instead of falling back to a previous
     * response's duration (or `--:--`).
     */
    runStartedAt: number | null;
    /** Frozen elapsed ms from the last run, used once live `startedAt` is gone. */
    lastElapsedMs: number | null;
    /**
     * Bumped by every event that could have touched the checkout. The Files panel
     * watches it to reread the diff while a run is still going, instead of
     * standing on whatever the checkout looked like when the panel opened.
     */
    workspaceEpoch: number;
    /**
     * Stop was painted; the HTTP cancel is still waiting for process cleanup.
     * Composer Send and transcript Regenerate stay blocked, and a still-live
     * `active_run` on the snapshot must not snap the chrome back to running.
     */
    cancelArmed: boolean;
}
export declare const MAX_DISMISSED_PROMPT_RUNS = 128;
export type RefreshKind = "none" | "messages" | "snapshot" | "replace-snapshot";
/** One presentation lifetime; hosted preferences are ephemeral. */
export declare function createRuntimeStore(_storage?: Pick<Storage, "getItem" | "setItem">): {
    release: () => void;
    runtimeStore: import("../lib/store").Store<RuntimeState>;
    runtimeIdentity: number;
    captureRuntimeActivation: (sessionId: string) => () => boolean;
    resetRuntime: (sessionId: string | null) => void;
    liftSessionSpend: (persisted: TokenUsage | null | undefined) => void;
    setOptimisticUserPrompt: (prompt: string | null, settlement?: "rejected" | "committed") => number | null;
    bindOptimisticPrompt: (token: number, runId: string) => void;
    markOptimisticPromptUncertain: (token: number) => void;
    dismissOptimisticPrompt: (token: number) => void;
    retireOptimisticPrompt: (token: number) => void;
    applyAssistantDelta: (delta: AssistantStreamDelta) => void;
    setStreamStatus: (streamStatus: StreamStatus) => void;
    syncRunFromSnapshot: (activeRun: ActiveRunSnapshot | null | undefined) => void;
    pushLocalEvent: (kind: RuntimeEventKind, text: string, isError?: boolean) => void;
    requestRunCancel: () => RuntimeState;
    restoreRunCancel: (previous: RuntimeState) => void;
    finishRunCancel: () => void;
    applyEnvelope: (envelope: SessionEventEnvelope) => RefreshKind;
    useRunning: (sessionId: string | null) => boolean;
    useCancelArmed: (sessionId: string | null) => boolean;
    useActivity: () => string;
    useRunError: () => string | null;
    useRunFailure: () => {
        attempt_count: number;
        diagnostic: string;
        http_status?: number | null;
        kind: import("../types/openapi.generated").components["schemas"]["RunFailureKind"];
        partial_output?: import("../types/openapi.generated").components["schemas"]["PartialModelOutput"];
        phase: import("../types/openapi.generated").components["schemas"]["RunFailurePhase"];
        recovery_action: import("../types/openapi.generated").components["schemas"]["RecoveryAction"];
        retry_after_ms?: number | null;
        summary: string;
        transient: boolean;
    } | null;
    useModelRetryAttempt: () => number | null;
    useLiveEvents: () => RuntimeEvent[];
    useStreamStatus: () => StreamStatus;
    usePrimaryToolEvents: () => ({
        prompt_preview: string;
        type: "run_started";
    } | {
        iteration: number;
        type: "model_call_started";
    } | {
        type: "token_usage_updated";
        usage: import("../types/openapi.generated").components["schemas"]["TokenUsage"];
    } | {
        args_detail?: string | null;
        args_preview: string;
        call_id: string;
        delegation_intent?: import("../types/openapi.generated").components["schemas"]["DelegationIntent"] | null;
        delegation_summary_verified?: boolean;
        key_arg_preview?: string | null;
        name: string;
        type: "tool_call_started";
    } | {
        call_id: string;
        cleanup_duration_ms?: number | null;
        command_status?: import("../types/openapi.generated").components["schemas"] /** Structured terminal failure for recovery-aware transcript actions. */["CommandStatus"] | null;
        completion_status?: import("../types/openapi.generated").components["schemas"]["ToolCompletionStatus"] | null;
        content_preview: string;
        delegation_outcome?: import("../types/openapi.generated").components["schemas"]["DelegationOutcome"] | null;
        delegation_summary?: string | null;
        effective_timeout_ms?: number | null;
        execution_duration_ms?: number | null;
        exit_code?: number | null;
        is_error: boolean;
        name: string;
        remote_outcome_uncertain?: boolean;
        type: "tool_call_finished";
    } | {
        compaction_id: string;
        reason: import("../types/openapi.generated").components["schemas"]["CompactionReason"];
        type: "compaction_started";
    } | {
        compaction_id: string;
        reason: import("../types/openapi.generated").components["schemas"]["CompactionReason"];
        type: "compaction_completed";
    } | {
        cause: import("../types/openapi.generated").components["schemas"]["CompactionSkipReason"];
        compaction_id: string;
        reason: import("../types/openapi.generated").components["schemas"]["CompactionReason"];
        type: "compaction_skipped";
    } | {
        compaction_id: string;
        failure: import("../types/openapi.generated").components["schemas"]["CompactionFailure"];
        reason: import("../types/openapi.generated").components["schemas"]["CompactionReason"];
        type: "compaction_failed";
    } | {
        content: string;
        type: "assistant_message";
        usage?: import("../types/openapi.generated").components["schemas"]["TokenUsage"] | null;
    } | {
        message: string;
        type: "error";
    } | {
        reason: string;
        server_name: string;
        type: "mcp_server_skipped";
    } | {
        kind: import("../types/openapi.generated").components["schemas"]["McpNotificationKind"];
        message: string;
        server_name: string;
        type: "mcp_notification";
    } | {
        message: string;
        type: "model_error";
    } | {
        type: "run_finished";
    })[];
    useRunUsage: () => {
        cache_read_tokens: number;
        cache_write_tokens: number;
        cost?: import("../types/openapi.generated").components["schemas"]["TokenCostMicros"];
        input_tokens: number;
        output_tokens: number;
        reasoning_tokens?: number;
        speed_tier_charges_excluded?: boolean;
        total_tokens: number;
    } | null;
    useSessionSpend: () => {
        cache_read_tokens: number;
        cache_write_tokens: number;
        cost?: import("../types/openapi.generated").components["schemas"]["TokenCostMicros"];
        input_tokens: number;
        output_tokens: number;
        reasoning_tokens?: number;
        speed_tier_charges_excluded?: boolean;
        total_tokens: number;
    } | null;
    useRunStartedAt: () => number | null;
    useLastElapsedMs: () => number | null;
    useWorkspaceEpoch: () => number;
    useStreamText: () => string;
    useStreamReasoning: () => string;
    useOptimisticUserPrompt: () => string | null;
    getRuntimeState: () => RuntimeState;
};
export declare const release: () => void, runtimeStore: import("../lib/store").Store<RuntimeState>, runtimeIdentity: number, captureRuntimeActivation: (sessionId: string) => () => boolean, resetRuntime: (sessionId: string | null) => void, liftSessionSpend: (persisted: TokenUsage | null | undefined) => void, setOptimisticUserPrompt: (prompt: string | null, settlement?: "rejected" | "committed") => number | null, bindOptimisticPrompt: (token: number, runId: string) => void, markOptimisticPromptUncertain: (token: number) => void, dismissOptimisticPrompt: (token: number) => void, retireOptimisticPrompt: (token: number) => void, applyAssistantDelta: (delta: AssistantStreamDelta) => void, setStreamStatus: (streamStatus: StreamStatus) => void, syncRunFromSnapshot: (activeRun: ActiveRunSnapshot | null | undefined) => void, pushLocalEvent: (kind: RuntimeEventKind, text: string, isError?: boolean) => void, requestRunCancel: () => RuntimeState, restoreRunCancel: (previous: RuntimeState) => void, finishRunCancel: () => void, applyEnvelope: (envelope: SessionEventEnvelope) => RefreshKind, useRunning: (sessionId: string | null) => boolean, useCancelArmed: (sessionId: string | null) => boolean, useActivity: () => string, useRunError: () => string | null, useRunFailure: () => {
    attempt_count: number;
    diagnostic: string;
    http_status?: number | null;
    kind: import("../types/openapi.generated").components["schemas"]["RunFailureKind"];
    partial_output?: import("../types/openapi.generated").components["schemas"]["PartialModelOutput"];
    phase: import("../types/openapi.generated").components["schemas"]["RunFailurePhase"];
    recovery_action: import("../types/openapi.generated").components["schemas"]["RecoveryAction"];
    retry_after_ms?: number | null;
    summary: string;
    transient: boolean;
} | null, useModelRetryAttempt: () => number | null, useLiveEvents: () => RuntimeEvent[], useStreamStatus: () => StreamStatus, usePrimaryToolEvents: () => ({
    prompt_preview: string;
    type: "run_started";
} | {
    iteration: number;
    type: "model_call_started";
} | {
    type: "token_usage_updated";
    usage: import("../types/openapi.generated").components["schemas"]["TokenUsage"];
} | {
    args_detail?: string | null;
    args_preview: string;
    call_id: string;
    delegation_intent?: import("../types/openapi.generated").components["schemas"]["DelegationIntent"] | null;
    delegation_summary_verified?: boolean;
    key_arg_preview?: string | null;
    name: string;
    type: "tool_call_started";
} | {
    call_id: string;
    cleanup_duration_ms?: number | null;
    command_status?: import("../types/openapi.generated").components["schemas"] /** Structured terminal failure for recovery-aware transcript actions. */["CommandStatus"] | null;
    completion_status?: import("../types/openapi.generated").components["schemas"]["ToolCompletionStatus"] | null;
    content_preview: string;
    delegation_outcome?: import("../types/openapi.generated").components["schemas"]["DelegationOutcome"] | null;
    delegation_summary?: string | null;
    effective_timeout_ms?: number | null;
    execution_duration_ms?: number | null;
    exit_code?: number | null;
    is_error: boolean;
    name: string;
    remote_outcome_uncertain?: boolean;
    type: "tool_call_finished";
} | {
    compaction_id: string;
    reason: import("../types/openapi.generated").components["schemas"]["CompactionReason"];
    type: "compaction_started";
} | {
    compaction_id: string;
    reason: import("../types/openapi.generated").components["schemas"]["CompactionReason"];
    type: "compaction_completed";
} | {
    cause: import("../types/openapi.generated").components["schemas"]["CompactionSkipReason"];
    compaction_id: string;
    reason: import("../types/openapi.generated").components["schemas"]["CompactionReason"];
    type: "compaction_skipped";
} | {
    compaction_id: string;
    failure: import("../types/openapi.generated").components["schemas"]["CompactionFailure"];
    reason: import("../types/openapi.generated").components["schemas"]["CompactionReason"];
    type: "compaction_failed";
} | {
    content: string;
    type: "assistant_message";
    usage?: import("../types/openapi.generated").components["schemas"]["TokenUsage"] | null;
} | {
    message: string;
    type: "error";
} | {
    reason: string;
    server_name: string;
    type: "mcp_server_skipped";
} | {
    kind: import("../types/openapi.generated").components["schemas"]["McpNotificationKind"];
    message: string;
    server_name: string;
    type: "mcp_notification";
} | {
    message: string;
    type: "model_error";
} | {
    type: "run_finished";
})[], useRunUsage: () => {
    cache_read_tokens: number;
    cache_write_tokens: number;
    cost?: import("../types/openapi.generated").components["schemas"]["TokenCostMicros"];
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens?: number;
    speed_tier_charges_excluded?: boolean;
    total_tokens: number;
} | null, useSessionSpend: () => {
    cache_read_tokens: number;
    cache_write_tokens: number;
    cost?: import("../types/openapi.generated").components["schemas"]["TokenCostMicros"];
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens?: number;
    speed_tier_charges_excluded?: boolean;
    total_tokens: number;
} | null, useRunStartedAt: () => number | null, useLastElapsedMs: () => number | null, useWorkspaceEpoch: () => number, useStreamText: () => string, useStreamReasoning: () => string, useOptimisticUserPrompt: () => string | null, getRuntimeState: () => RuntimeState;
