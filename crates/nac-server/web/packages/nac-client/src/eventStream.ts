// Endpoint-aware session SSE client with explicit replay and backpressure policy.

import { nacClient, type NacClient, type NacStreamContext } from "./nacClient.js";
import {
  nativeSessionStreamWire,
  type NativeSessionStreamFrames,
  type SessionStreamFrames,
  type SessionStreamWire,
} from "./sessionStreamWire.js";

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

export interface SessionStreamHandlers<
  Frames extends SessionStreamFrames = NativeSessionStreamFrames,
> {
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

export type EventSourceFactory = (
  url: string,
  init: EventSourceInit,
  context: NacStreamContext,
) => EventSource;

export interface SessionStreamInstrumentation<
  Frames extends SessionStreamFrames = NativeSessionStreamFrames,
> {
  onSessionEvent?: (envelope: Frames["envelope"]) => void;
  onAssistantDelta?: (delta: Frames["assistantDelta"]) => void;
}

export interface SessionStreamOptions<
  Frames extends SessionStreamFrames = NativeSessionStreamFrames,
> {
  client?: NacClient;
  eventSource?: EventSourceFactory;
  instrumentation?: SessionStreamInstrumentation<Frames>;
  maxPendingEvents?: number;
  /** Finite connection lease; each reconnect obtains a fresh stream context. */
  maxConnectionMs?: number;
  /** Cursor from an already accepted canonical snapshot; never authorization. */
  initialCursor?: Frames["cursor"];
}

const INITIAL_RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;
const MAX_ATTEMPTS_BEFORE_OPEN = 4;
const DEFAULT_MAX_PENDING_EVENTS = 256;

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
  return subscribeWithWire(sessionId, handlers, options, nativeSessionStreamWire);
}

/** Explicit alternate wire family over the SAME ordered native stream/reconnect owner. */
export function subscribeToSessionEventsWithWire<Frames extends SessionStreamFrames>(
  sessionId: string,
  handlers: SessionStreamHandlers<Frames>,
  wire: SessionStreamWire<Frames>,
  options: SessionStreamOptions<Frames> & { client: NacClient; eventSource: EventSourceFactory },
): () => void {
  if (
    !options.client ||
    typeof options.eventSource !== "function" ||
    wire.invalidFrame !== "stop" ||
    wire.epochPolicy !== "replay-boundary"
  ) {
    throw new Error(
      "An explicit stream wire requires a bound client, stream factory and strict decoding.",
    );
  }
  for (const name of [
    "streamPath",
    "decodeEnvelope",
    "decodeAssistantDelta",
    "decodeReplayBoundary",
    "decodeReplayGap",
    "decodeLagged",
    "cursorFromEnvelope",
    "cursorFromBoundary",
  ] as const) {
    if (typeof wire[name] !== "function") throw new Error("Missing explicit session stream codec.");
  }
  for (const name of ["epoch", "sequence", "compare", "successor", "query"] as const) {
    if (typeof wire.cursor?.[name] !== "function")
      throw new Error("Missing explicit session cursor protocol.");
  }
  if (options.initialCursor !== undefined && options.initialCursor !== null)
    wire.cursor.query(options.initialCursor);
  if (
    (options.maxConnectionMs !== undefined &&
      (!Number.isFinite(options.maxConnectionMs) || options.maxConnectionMs <= 0)) ||
    (options.maxPendingEvents !== undefined &&
      (!Number.isSafeInteger(options.maxPendingEvents) || options.maxPendingEvents <= 0))
  ) {
    throw new Error("Session stream limits must be finite and positive.");
  }
  const selected = Object.freeze({ ...wire, cursor: Object.freeze({ ...wire.cursor }) });
  return subscribeWithWire(
    sessionId,
    handlers,
    {
      ...options,
      maxConnectionMs: Math.min(299_000, Math.max(1, options.maxConnectionMs ?? 299_000)),
    },
    selected,
  );
}

function subscribeWithWire<Frames extends SessionStreamFrames>(
  sessionId: string,
  handlers: SessionStreamHandlers<Frames>,
  options: SessionStreamOptions<Frames>,
  wire: SessionStreamWire<Frames>,
): () => void {
  const client = options.client ?? nacClient;
  const createEventSource = options.eventSource;
  const nativeEventSourceInit = createEventSource ? null : client.transport.eventSourceInit();
  const maxPendingEvents = Math.max(1, options.maxPendingEvents ?? DEFAULT_MAX_PENDING_EVENTS);
  let source: EventSource | null = null;
  let connectionTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = INITIAL_RETRY_MS;
  let reconnectCursor: Frames["cursor"] | null = options.initialCursor ?? null;
  let deliveredCursor: Frames["cursor"] | null = options.initialCursor ?? null;
  let replayBoundary: Frames["cursor"] | null = null;
  let closed = false;
  let everOpened = false;
  let failedAttempts = 0;
  let draining = false;
  let deliveryGeneration = 0;
  const pending: Frames["envelope"][] = [];

  const setStatus = (status: StreamStatus) => {
    if (!closed) handlers.onStatus?.(status);
  };

  function decodeFrame<T>(event: MessageEvent<string>, decode: (text: string) => T): T | null {
    try {
      return decode(event.data);
    } catch (error) {
      if (wire.invalidFrame === "stop") {
        handlers.onTransportError?.(error);
        setStatus("error");
        closed = true;
        deliveryGeneration += 1;
        pending.length = 0;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
        closeSource();
      }
      return null;
    }
  }

  const observedCursor = (): Frames["cursor"] | null =>
    pending.length > 0 ? wire.cursorFromEnvelope(pending[pending.length - 1]) : deliveredCursor;

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
        deliveredCursor = wire.cursorFromEnvelope(envelope);
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

    const base = client.transport.url(wire.streamPath(sessionId));
    const params = new URLSearchParams();
    if (reconnectCursor !== null) {
      const query = wire.cursor.query(reconnectCursor);
      params.set("after_epoch_id", query.after_epoch_id);
      params.set("after_sequence_id", query.after_sequence_id);
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
      const decoded = decodeFrame(event, (text) => {
        const envelope = wire.decodeEnvelope(text);
        if (!envelope) return null;
        const cursor = wire.cursorFromEnvelope(envelope);
        wire.cursor.query(cursor);
        if (
          wire.epochPolicy === "replay-boundary" &&
          (replayBoundary === null ||
            wire.cursor.epoch(cursor) !== wire.cursor.epoch(replayBoundary))
        ) {
          throw new Error("Session event does not match its replay epoch.");
        }
        return { envelope, cursor };
      });
      if (!decoded) return;
      const { envelope, cursor } = decoded;
      const previous = observedCursor();
      const comparison = previous === null ? null : wire.cursor.compare(cursor, previous);
      if (comparison !== null && comparison <= 0) {
        handlers.onDuplicate?.(envelope);
        return;
      }
      if (
        previous !== null &&
        wire.cursor.epoch(cursor) === wire.cursor.epoch(previous) &&
        wire.cursor.sequence(cursor) !== wire.cursor.successor(wire.cursor.sequence(previous))
      ) {
        handlers.onSequenceGap?.({
          epochId: wire.cursor.epoch(cursor),
          expectedSequenceId: wire.cursor.successor(wire.cursor.sequence(previous)),
          receivedSequenceId: wire.cursor.sequence(cursor),
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
      const parsed = decodeFrame(event, wire.decodeAssistantDelta);
      if (!parsed) return;
      options.instrumentation?.onAssistantDelta?.(parsed);
      handlers.onAssistantDelta?.(parsed);
    });

    source.addEventListener("replay_boundary", (event) => {
      if (!isCurrentConnection() || !(event instanceof MessageEvent)) return;
      const decoded = decodeFrame(event, (text) => {
        const frame = wire.decodeReplayBoundary(text);
        if (!frame) return null;
        const cursor = wire.cursorFromBoundary(frame);
        wire.cursor.query(cursor);
        return { frame, cursor };
      });
      if (!decoded) return;
      const parsed = decoded.frame;
      replayBoundary = decoded.cursor;
      if (
        reconnectCursor !== null &&
        wire.cursor.epoch(reconnectCursor) !== wire.cursor.epoch(replayBoundary)
      ) {
        reconnectCursor = replayBoundary;
        deliveredCursor = null;
        deliveryGeneration += 1;
        pending.length = 0;
      }
      handlers.onReplayBoundary?.(parsed);
    });

    source.addEventListener("replay_gap", (event) => {
      if (!isCurrentConnection() || !(event instanceof MessageEvent)) return;
      const parsed = decodeFrame(event, wire.decodeReplayGap);
      if (parsed) handlers.onReplayGap?.(parsed);
    });

    source.addEventListener("lagged", (event) => {
      if (!isCurrentConnection() || !(event instanceof MessageEvent)) return;
      const parsed = decodeFrame(event, wire.decodeLagged);
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
