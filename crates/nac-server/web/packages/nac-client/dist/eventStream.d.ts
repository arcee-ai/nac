import { type NacClient, type NacStreamContext } from "./nacClient.js";
import { type NativeSessionStreamFrames, type SessionStreamFrames, type SessionStreamWire } from "./sessionStreamWire.js";
export type StreamStatus = "idle" | "connecting" | "live" | "reconnecting" | "error";
export interface SessionSequenceGap<Sequence = number> {
    epochId: string;
    expectedSequenceId: Sequence;
    receivedSequenceId: Sequence;
}
export interface SessionBackpressure {
    reason: "queue-overflow" | "handler-error";
    maxPendingEvents: number;
    error?: unknown;
}
export interface SessionStreamHandlers<Frames extends SessionStreamFrames = NativeSessionStreamFrames> {
    onEnvelope: (envelope: Frames["envelope"]) => void | Promise<void>;
    /** Model output as it is produced. Carries no sequence id: see the backend. */
    onAssistantDelta?: (delta: Frames["assistantDelta"]) => void;
    onStatus?: (status: StreamStatus) => void;
    onReplayBoundary?: (event: Frames["replayBoundary"]) => void;
    onReplayGap?: (event: Frames["replayGap"]) => void;
    onLagged?: (event: Frames["lagged"]) => void;
    onDuplicate?: (event: Frames["envelope"]) => void;
    onSequenceGap?: (gap: SessionSequenceGap<Frames["sequence"]>) => void;
    onBackpressure?: (backpressure: SessionBackpressure) => void;
    onTransportError?: (error: unknown) => void;
}
export type EventSourceFactory = (url: string, init: EventSourceInit, context: NacStreamContext) => EventSource;
export interface SessionStreamInstrumentation<Frames extends SessionStreamFrames = NativeSessionStreamFrames> {
    onSessionEvent?: (envelope: Frames["envelope"]) => void;
    onAssistantDelta?: (delta: Frames["assistantDelta"]) => void;
}
export interface SessionStreamOptions<Frames extends SessionStreamFrames = NativeSessionStreamFrames> {
    client?: NacClient;
    eventSource?: EventSourceFactory;
    instrumentation?: SessionStreamInstrumentation<Frames>;
    maxPendingEvents?: number;
    /** Finite connection lease; each reconnect obtains a fresh stream context. */
    maxConnectionMs?: number;
    /** Cursor from an already accepted canonical snapshot; never authorization. */
    initialCursor?: Frames["cursor"];
}
/**
 * Open a stream for one session. Delivery is ordered and bounded. If a slow
 * handler fills the queue, the connection is closed and replay resumes from
 * the last event the handler actually accepted.
 */
export declare function subscribeToSessionEvents(sessionId: string, handlers: SessionStreamHandlers, options?: SessionStreamOptions): () => void;
/** Explicit alternate wire family over the SAME ordered native stream/reconnect owner. */
export declare function subscribeToSessionEventsWithWire<Frames extends SessionStreamFrames>(sessionId: string, handlers: SessionStreamHandlers<Frames>, wire: SessionStreamWire<Frames>, options: SessionStreamOptions<Frames> & {
    client: NacClient;
    eventSource: EventSourceFactory;
}): () => void;
