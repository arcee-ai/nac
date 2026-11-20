import type { AgentEvent, SessionSnapshotResponse, ToolCall } from "../types/api";
/** Whether a finished tool call should read as a failure. */
export declare function toolCallFailed(event: {
    is_error: boolean;
    content_preview: string;
    completion_status?: "success" | "error" | "timed_out" | "cancelled" | null;
    command_status?: "completed" | "timed_out" | "cancelled" | "spawn_error" | null;
}): boolean;
export type ToolPresentationStatus = "pending" | "running" | "awaiting-approval" | "success" | "error" | "timed-out" | "cancelled" | "interrupted" | "unknown";
export interface ToolPresentation {
    callId: string;
    /** Bounded transport name retained for diagnostics and safe fallbacks. */
    name: string;
    /** Product vocabulary shown as the primary label. */
    label: string;
    /** Backend-owned bounded key argument; never reconstructed from raw arguments. */
    summary: string | null;
    /** Backend-owned bounded result preview; never the durable raw tool body. */
    resultPreview: string | null;
    status: ToolPresentationStatus;
    statusLabel: string;
    /** Native-owned historical invocation outcome, absent for legacy events. */
    delegationOutcome?: NonNullable<ToolFinished["delegation_outcome"]>;
    delegationIntent?: NonNullable<ToolStarted["delegation_intent"]>;
    /**
     * Execution time from the call's finish event. Absent when the call never
     * ran, or when no finish event reports one.
     */
    durationMs?: number;
    /**
     * Session a `subagent` call started or continued.
     * An identity hint for delegated-session links that is never displayed:
     * consumers must resolve it against the delegation queries before trusting it.
     */
    spawnedSessionId?: string;
    /** Server-issued occurrence for a specific retained assistant row. */
    occurrence?: string;
    /** Whether a delegation call addressed an existing session. */
    delegationContinuation?: boolean;
    /** A live turn can still commit its result with the rest of its tool batch. */
    resultMayBePending?: boolean;
    /** This invocation cannot be distinguished from another call in its batch. */
    resultAmbiguous?: boolean;
    /** A live delegation turn may change parent inventory, without binding its events. */
    inventoryMayChange?: boolean;
    /** Native launch identity hint; consumers validate it against passive session inventory. */
    launchedTask?: {
        sessionId: string;
        projectId: string;
        callerId: string;
        title: string;
    };
}
type ToolStarted = Extract<AgentEvent, {
    type: "tool_call_started";
}>;
type ToolFinished = Extract<AgentEvent, {
    type: "tool_call_finished";
}>;
export interface ToolEventPair {
    started?: ToolStarted;
    finished?: ToolFinished;
}
export interface ToolResultRecord {
    text: string;
    hasImage: boolean;
}
/** Collect only the contiguous result rows owned by one assistant turn. */
export declare function collectToolResults(messages: SessionSnapshotResponse["messages"], assistantIndex: number): Map<string, ToolResultRecord>;
/** IDs repeated among result rows cannot be paired to one call. */
export declare function ambiguousToolResultIds(messages: SessionSnapshotResponse["messages"], assistantIndex: number): Set<string>;
export declare function assistantTurnCancelled(messages: SessionSnapshotResponse["messages"], assistantIndex: number, cancellationMarker: string): boolean;
/**
 * Pair sanitized durable and live lifecycle events by call id. Later events
 * win, so an SSE finish can settle a durable start and the canonical snapshot
 * can replace the overlay without changing semantic identity.
 */
export declare function indexToolEvents(events: AgentEvent[]): Map<string, ToolEventPair>;
export declare function presentToolCall({ call, events, hasResult, resultText, resultHasImage, active, awaitingApproval, turnCancelled, occurrence, ambiguousResult, unboundEvents, }: {
    call: ToolCall;
    events?: ToolEventPair;
    hasResult: boolean;
    /** Read only for fixed cancellation/interruption markers and launch records; never displayed. */
    resultText: string | null;
    resultHasImage: boolean;
    active: boolean;
    /** Canonical pending permission state correlated by the backend call id. */
    awaitingApproval?: boolean;
    turnCancelled: boolean;
    occurrence?: string | null;
    ambiguousResult?: boolean;
    /** Event IDs cannot be bound to this transcript invocation. */
    unboundEvents?: boolean;
}): ToolPresentation;
export {};
