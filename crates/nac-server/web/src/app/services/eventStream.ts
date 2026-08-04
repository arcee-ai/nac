// Typed wrapper around the session SSE endpoint.
//
// EventSource reconnects on its own while the connection merely drops, but it
// gives up for good once the server answers an error status, so a manual retry
// with backoff sits on top. Reconnects resume from the last sequence id seen,
// which the backend replays from, so no event is lost across a gap.

import { perfEpoch, perfMark } from "@/app/lib/perfDebug";
import { api } from "@/app/services/api";
import type {
  AssistantStreamDelta,
  LaggedEvent,
  ReplayBoundaryEvent,
  ReplayGapEvent,
  SessionEventEnvelope,
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
  let lastSequenceId: number | null = null;
  let closed = false;
  let everOpened = false;
  let failedAttempts = 0;

  const setStatus = (status: StreamStatus) => {
    if (!closed) handlers.onStatus?.(status);
  };

  const connect = () => {
    if (closed) return;
    setStatus(lastSequenceId === null ? "connecting" : "reconnecting");

    const base = api.eventStreamUrl(sessionId);
    const url =
      lastSequenceId === null
        ? base
        : `${base}?after_sequence_id=${lastSequenceId}`;
    source = new EventSource(url);

    source.onopen = () => {
      everOpened = true;
      failedAttempts = 0;
      retryDelay = INITIAL_RETRY_MS;
      setStatus("live");
    };

    source.addEventListener("session_event", (event) => {
      const envelope = parseEvent<SessionEventEnvelope>(
        event as MessageEvent<string>,
      );
      if (!envelope) return;
      lastSequenceId = envelope.sequence_id;
      perfMark("sse:session_event", {
        fields: { type: envelope.event.type },
        throttleMs: 0,
      });
      handlers.onEnvelope(envelope);
    });

    source.addEventListener("assistant_delta", (event) => {
      const parsed = parseEvent<AssistantStreamDelta>(
        event as MessageEvent<string>,
      );
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
      const parsed = parseEvent<ReplayBoundaryEvent>(
        event as MessageEvent<string>,
      );
      if (parsed) handlers.onReplayBoundary?.(parsed);
    });

    source.addEventListener("replay_gap", (event) => {
      const parsed = parseEvent<ReplayGapEvent>(event as MessageEvent<string>);
      if (parsed) handlers.onReplayGap?.(parsed);
    });

    source.addEventListener("lagged", (event) => {
      const parsed = parseEvent<LaggedEvent>(event as MessageEvent<string>);
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
      // CONNECTING means EventSource is retrying by itself; CLOSED means it
      // hit an error status and will never retry, so reconnect manually.
      if (source?.readyState !== EventSource.CLOSED) return;
      source.close();
      source = null;
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
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
