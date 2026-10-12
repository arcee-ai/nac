import type { AgentEvent, SessionSnapshotResponse, ToolCall } from "../types/api";
export type ToolPresentationStatus = "pending" | "running" | "awaiting-approval" | "success" | "error" | "timed-out" | "cancelled" | "interrupted";
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
export declare function assistantTurnCancelled(messages: SessionSnapshotResponse["messages"], assistantIndex: number, cancellationMarker: string): boolean;
/**
 * Pair sanitized durable and live lifecycle events by call id. Later events
 * win, so an SSE finish can settle a durable start and the canonical snapshot
 * can replace the overlay without changing semantic identity.
 */
export declare function indexToolEvents(events: AgentEvent[]): Map<string, ToolEventPair>;
export declare function presentToolCall({ call, events, hasResult, resultText, resultHasImage, active, awaitingApproval, turnCancelled, }: {
    call: ToolCall;
    events?: ToolEventPair;
    hasResult: boolean;
    /** Used only for fixed cancellation/interruption markers, never displayed. */
    resultText: string | null;
    resultHasImage: boolean;
    active: boolean;
    /** Canonical pending permission state correlated by the backend call id. */
    awaitingApproval?: boolean;
    turnCancelled: boolean;
}): ToolPresentation;
export {};
