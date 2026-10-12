import { type NacClient, type NacStreamContext } from "./nacClient.js";
import type { AssistantStreamDelta, LaggedEvent, ReplayBoundaryEvent, ReplayGapEvent, SessionEventEnvelope } from "./types.js";
export type StreamStatus = "idle" | "connecting" | "live" | "reconnecting" | "error";
export interface SessionSequenceGap {
    epochId: string;
    expectedSequenceId: number;
    receivedSequenceId: number;
}
export interface SessionBackpressure {
    reason: "queue-overflow" | "handler-error";
    maxPendingEvents: number;
    error?: unknown;
}
export interface SessionStreamHandlers {
    onEnvelope: (envelope: SessionEventEnvelope) => void | Promise<void>;
    /** Model output as it is produced. Carries no sequence id: see the backend. */
    onAssistantDelta?: (delta: AssistantStreamDelta) => void;
    onStatus?: (status: StreamStatus) => void;
    onReplayBoundary?: (event: ReplayBoundaryEvent) => void;
    onReplayGap?: (event: ReplayGapEvent) => void;
    onLagged?: (event: LaggedEvent) => void;
    onDuplicate?: (event: SessionEventEnvelope) => void;
    onSequenceGap?: (gap: SessionSequenceGap) => void;
    onBackpressure?: (backpressure: SessionBackpressure) => void;
    onTransportError?: (error: unknown) => void;
}
export type EventSourceFactory = (url: string, init: EventSourceInit, context: NacStreamContext) => EventSource;
export interface SessionStreamInstrumentation {
    onSessionEvent?: (envelope: SessionEventEnvelope) => void;
    onAssistantDelta?: (delta: AssistantStreamDelta) => void;
}
export interface SessionStreamOptions {
    client?: NacClient;
    eventSource?: EventSourceFactory;
    instrumentation?: SessionStreamInstrumentation;
    maxPendingEvents?: number;
    /** Finite connection lease; each reconnect obtains a fresh stream context. */
    maxConnectionMs?: number;
}
/**
 * Open a stream for one session. Delivery is ordered and bounded. If a slow
 * handler fills the queue, the connection is closed and replay resumes from
 * the last event the handler actually accepted.
 */
export declare function subscribeToSessionEvents(sessionId: string, handlers: SessionStreamHandlers, options?: SessionStreamOptions): () => void;
