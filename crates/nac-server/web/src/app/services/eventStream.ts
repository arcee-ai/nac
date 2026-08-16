// Typed wrapper around the session SSE endpoint.
//
// The wrapper owns retries so every new connection URL carries the latest
// complete epoch/sequence cursor. Native EventSource retries would reuse a
// stale immutable URL.

import { perfEpoch, perfMark } from "@/app/lib/perfDebug";
import { api } from "@/app/services/api";
import type {
  AssistantStreamDelta,
  LaggedEvent,
  ReplayBoundaryEvent,
  ReplayGapEvent,
  SessionEventEnvelope,
  SessionEventBoundary,
} from "@/app/types/api";

export type StreamStatus =
  "idle" | "connecting" | "live" | "reconnecting" | "error";

export interface SessionStreamHandlers {
  onEnvelope: (envelope: SessionEventEnvelope) => void;
  /** Model output as it is produced. Carries no sequence id: see the backend. */
  onAssistantDelta?: (delta: AssistantStreamDelta) => void;
  onStatus?: (status: StreamStatus) => void;
  onReplayBoundary?: (event: ReplayBoundaryEvent) => void;
  onReplayGap?: (event: ReplayGapEvent) => void;
  onLagged?: (event: LaggedEvent) => void;
}

const INITIAL_RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;
// EventSource hides the HTTP status, so a stream that never opens is treated as
// a permanent rejection after a few tries. The backend answers 400 here for a
// session whose stored model config is broken, and retrying cannot fix that.
const MAX_ATTEMPTS_BEFORE_OPEN = 4;

function parseEvent<T>(event: MessageEvent<string>): T | null {
  try {
    // SAFETY: the stream contract is one JSON payload per event; callers treat
    // a parse failure (null) as a skipped event, so a malformed payload is
    // never trusted as T.
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}

/**
 * Open a stream for one session. Returns a disposer that closes the connection
 * and cancels any pending reconnect.
 */
export function subscribeToSessionEvents(
  sessionId: string,
  handlers: SessionStreamHandlers,
): () => void {
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = INITIAL_RETRY_MS;
  let lastCursor: SessionEventBoundary | null = null;
  let closed = false;
  let everOpened = false;
  let failedAttempts = 0;

  const setStatus = (status: StreamStatus) => {
    if (!closed) handlers.onStatus?.(status);
  };

  const connect = () => {
    if (closed) return;
    setStatus(lastCursor === null ? "connecting" : "reconnecting");

    const base = api.eventStreamUrl(sessionId);
    const params = new URLSearchParams();
    if (lastCursor !== null) {
      params.set("after_epoch_id", lastCursor.epoch_id);
      params.set("after_sequence_id", String(lastCursor.sequence_id));
    }
    const url = params.size === 0 ? base : `${base}?${params.toString()}`;
    source = new EventSource(url);

    source.onopen = () => {
      everOpened = true;
      failedAttempts = 0;
      retryDelay = INITIAL_RETRY_MS;
      setStatus("live");
    };

    source.addEventListener("session_event", (event) => {
      if (!(event instanceof MessageEvent)) return;
      const envelope = parseEvent<SessionEventEnvelope>(event);
      if (!envelope) return;
      lastCursor = {
        epoch_id: envelope.epoch_id,
        sequence_id: envelope.sequence_id,
      };
      perfMark("sse:session_event", {
        fields: { type: envelope.event.type },
        throttleMs: 0,
      });
      handlers.onEnvelope(envelope);
    });

    source.addEventListener("assistant_delta", (event) => {
      if (!(event instanceof MessageEvent)) return;
      const parsed = parseEvent<AssistantStreamDelta>(event);
      if (!parsed) return;
      perfEpoch();
      perfMark("sse:assistant_delta", {
        fields: {
          chars: (parsed.text?.length ?? 0) + (parsed.reasoning?.length ?? 0),
          thread: parsed.thread_name ?? "-",
        },
        throttleMs: 1000,
      });
      handlers.onAssistantDelta?.(parsed);
    });

    source.addEventListener("replay_boundary", (event) => {
      if (!(event instanceof MessageEvent)) return;
      const parsed = parseEvent<ReplayBoundaryEvent>(event);
      if (!parsed) return;
      if (lastCursor !== null && lastCursor.epoch_id !== parsed.epoch_id) {
        lastCursor = {
          epoch_id: parsed.epoch_id,
          sequence_id: parsed.replay_boundary_sequence_id,
        };
      }
      handlers.onReplayBoundary?.(parsed);
    });

    source.addEventListener("replay_gap", (event) => {
      if (!(event instanceof MessageEvent)) return;
      const parsed = parseEvent<ReplayGapEvent>(event);
      if (parsed) handlers.onReplayGap?.(parsed);
    });

    source.addEventListener("lagged", (event) => {
      if (!(event instanceof MessageEvent)) return;
      const parsed = parseEvent<LaggedEvent>(event);
      if (parsed) handlers.onLagged?.(parsed);
    });

    source.onerror = () => {
      if (closed) return;
      failedAttempts += 1;
      if (!everOpened && failedAttempts >= MAX_ATTEMPTS_BEFORE_OPEN) {
        setStatus("error");
        source?.close();
        source = null;
        return;
      }
      setStatus("reconnecting");
      source?.close();
      source = null;
      if (retryTimer === null) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          connect();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
      }
    };
  };

  connect();

  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    source?.close();
    source = null;
  };
}
