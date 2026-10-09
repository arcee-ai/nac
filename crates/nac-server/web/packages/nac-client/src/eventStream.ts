// Endpoint-aware session SSE client with explicit replay and backpressure policy.

import { nacClient, type NacClient, type NacStreamContext } from "./nacClient.js";
import type {
  AssistantStreamDelta,
  LaggedEvent,
  ReplayBoundaryEvent,
  ReplayGapEvent,
  SessionEventBoundary,
  SessionEventEnvelope,
} from "./types.js";

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

export type EventSourceFactory = (
  url: string,
  init: EventSourceInit,
  context: NacStreamContext,
) => EventSource;

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

const INITIAL_RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;
const MAX_ATTEMPTS_BEFORE_OPEN = 4;
const DEFAULT_MAX_PENDING_EVENTS = 256;

function parseEvent<T>(event: MessageEvent<string>): T | null {
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}

function cursorOf(envelope: SessionEventEnvelope): SessionEventBoundary {
  return { epoch_id: envelope.epoch_id, sequence_id: envelope.sequence_id };
}

function sameOrBefore(
  cursor: SessionEventBoundary,
  previous: SessionEventBoundary | null,
): boolean {
  return (
    previous !== null &&
    cursor.epoch_id === previous.epoch_id &&
    cursor.sequence_id <= previous.sequence_id
  );
}

/**
 * Open a stream for one session. Delivery is ordered and bounded. If a slow
 * handler fills the queue, the connection is closed and replay resumes from
 * the last event the handler actually accepted.
 */
export function subscribeToSessionEvents(
  sessionId: string,
  handlers: SessionStreamHandlers,
  options: SessionStreamOptions = {},
): () => void {
  const client = options.client ?? nacClient;
  const createEventSource = options.eventSource;
  const nativeEventSourceInit = createEventSource ? null : client.transport.eventSourceInit();
  const maxPendingEvents = Math.max(1, options.maxPendingEvents ?? DEFAULT_MAX_PENDING_EVENTS);
  let source: EventSource | null = null;
  let connectionTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = INITIAL_RETRY_MS;
  let reconnectCursor: SessionEventBoundary | null = null;
  let deliveredCursor: SessionEventBoundary | null = null;
  let replayBoundary: SessionEventBoundary | null = null;
  let closed = false;
  let everOpened = false;
  let failedAttempts = 0;
  let draining = false;
  let deliveryGeneration = 0;
  const pending: SessionEventEnvelope[] = [];

  const setStatus = (status: StreamStatus) => {
    if (!closed) handlers.onStatus?.(status);
  };

  const observedCursor = (): SessionEventBoundary | null =>
    pending.length > 0 ? cursorOf(pending[pending.length - 1]) : deliveredCursor;

  const closeSource = () => {
    if (connectionTimer) clearTimeout(connectionTimer);
    connectionTimer = null;
    source?.close();
    source = null;
  };

  const scheduleReconnect = () => {
    if (closed || retryTimer !== null) return;
    setStatus("reconnecting");
    closeSource();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      startConnect();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
  };

  const handleConnectionFailure = (error?: unknown) => {
    if (closed) return;
    if (error !== undefined) handlers.onTransportError?.(error);
    failedAttempts += 1;
    if (!everOpened && failedAttempts >= MAX_ATTEMPTS_BEFORE_OPEN) {
      setStatus("error");
      closeSource();
      return;
    }
    scheduleReconnect();
  };

  const recoverFrom = (backpressure: SessionBackpressure) => {
    handlers.onBackpressure?.(backpressure);
    deliveryGeneration += 1;
    pending.length = 0;
    reconnectCursor = deliveredCursor ?? replayBoundary;
    scheduleReconnect();
  };

  const drain = async () => {
    if (draining || closed) return;
    draining = true;
    const generation = deliveryGeneration;
    try {
      while (!closed && pending.length > 0) {
        const envelope = pending[0];
        try {
          await handlers.onEnvelope(envelope);
        } catch (error) {
          recoverFrom({ reason: "handler-error", maxPendingEvents, error });
          return;
        }
        if (generation !== deliveryGeneration) return;
        pending.shift();
        deliveredCursor = cursorOf(envelope);
        reconnectCursor = deliveredCursor;
      }
    } finally {
      draining = false;
      if (!closed && pending.length > 0) void drain();
    }
  };

  const connect = async () => {
    if (closed) return;
    setStatus(reconnectCursor === null ? "connecting" : "reconnecting");

    const base = client.transport.url(`/sessions/${encodeURIComponent(sessionId)}/events/stream`);
    const params = new URLSearchParams();
    if (reconnectCursor !== null) {
      params.set("after_epoch_id", reconnectCursor.epoch_id);
      params.set("after_sequence_id", String(reconnectCursor.sequence_id));
    }
    const url = params.size === 0 ? base : `${base}?${params.toString()}`;
    if (createEventSource) {
      const context = await client.transport.streamContext();
      if (closed) return;
      source = createEventSource(
        url,
        { withCredentials: context.credentials === "include" },
        context,
      );
    } else {
      source = new EventSource(url, nativeEventSourceInit ?? undefined);
    }

    if (options.maxConnectionMs !== undefined) {
      connectionTimer = setTimeout(scheduleReconnect, Math.max(1, options.maxConnectionMs));
    }
    const connection = source;
    const isCurrentConnection = () => !closed && source === connection;

    source.onopen = () => {
      if (!isCurrentConnection()) return;
      everOpened = true;
      failedAttempts = 0;
      retryDelay = INITIAL_RETRY_MS;
      setStatus("live");
    };

    source.addEventListener("session_event", (event) => {
      if (!isCurrentConnection() || !(event instanceof MessageEvent)) return;
      const envelope = parseEvent<SessionEventEnvelope>(event);
      if (!envelope) return;
      const cursor = cursorOf(envelope);
      const previous = observedCursor();
      if (sameOrBefore(cursor, previous)) {
        handlers.onDuplicate?.(envelope);
        return;
      }
      if (
        previous !== null &&
        cursor.epoch_id === previous.epoch_id &&
        cursor.sequence_id !== previous.sequence_id + 1
      ) {
        handlers.onSequenceGap?.({
          epochId: cursor.epoch_id,
          expectedSequenceId: previous.sequence_id + 1,
          receivedSequenceId: cursor.sequence_id,
        });
        deliveryGeneration += 1;
        pending.length = 0;
        reconnectCursor = deliveredCursor ?? replayBoundary;
        scheduleReconnect();
        return;
      }
      if (pending.length >= maxPendingEvents) {
        recoverFrom({ reason: "queue-overflow", maxPendingEvents });
        return;
      }
      pending.push(envelope);
      options.instrumentation?.onSessionEvent?.(envelope);
      void drain();
    });

    source.addEventListener("assistant_delta", (event) => {
      if (!isCurrentConnection() || !(event instanceof MessageEvent)) return;
      const parsed = parseEvent<AssistantStreamDelta>(event);
      if (!parsed) return;
      options.instrumentation?.onAssistantDelta?.(parsed);
      handlers.onAssistantDelta?.(parsed);
    });

    source.addEventListener("replay_boundary", (event) => {
      if (!isCurrentConnection() || !(event instanceof MessageEvent)) return;
      const parsed = parseEvent<ReplayBoundaryEvent>(event);
      if (!parsed) return;
      replayBoundary = {
        epoch_id: parsed.epoch_id,
        sequence_id: parsed.replay_boundary_sequence_id,
      };
      if (reconnectCursor !== null && reconnectCursor.epoch_id !== parsed.epoch_id) {
        reconnectCursor = replayBoundary;
        deliveredCursor = null;
        deliveryGeneration += 1;
        pending.length = 0;
      }
      handlers.onReplayBoundary?.(parsed);
    });

    source.addEventListener("replay_gap", (event) => {
      if (!isCurrentConnection() || !(event instanceof MessageEvent)) return;
      const parsed = parseEvent<ReplayGapEvent>(event);
      if (parsed) handlers.onReplayGap?.(parsed);
    });

    source.addEventListener("lagged", (event) => {
      if (!isCurrentConnection() || !(event instanceof MessageEvent)) return;
      const parsed = parseEvent<LaggedEvent>(event);
      if (parsed) handlers.onLagged?.(parsed);
    });

    source.onerror = () => {
      if (!isCurrentConnection()) return;
      handleConnectionFailure();
    };
  };

  function startConnect() {
    void connect().catch((error: unknown) => {
      if (closed) return;
      closeSource();
      handleConnectionFailure(error);
    });
  }

  startConnect();

  return () => {
    closed = true;
    deliveryGeneration += 1;
    pending.length = 0;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    closeSource();
  };
}
