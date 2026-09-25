import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/app/services/queries";
import { subscribeToSessionEvents } from "@/app/services/eventStream";
import type { AssistantStreamDelta, SessionEventEnvelope } from "@/app/types/api";

// Same window the open session uses before it reloads canonical messages.
const RELOAD_DEBOUNCE_MS = 250;

export interface DelegatedPreviewStream {
  text: string;
  reasoning: string;
  /** True from `run_started` until the run settles, and while deltas are arriving. */
  running: boolean;
}

const EMPTY: DelegatedPreviewStream = { text: "", reasoning: "", running: false };

/**
 * Live model output for a subagent previewed from its parent.
 *
 * The parent's runtime store belongs to the open session. This subscription
 * keeps the child's deltas and snapshot refreshes on the side, so a run in the
 * preview can paint as it is produced without rewriting the parent transcript.
 */
export function useDelegatedPreviewStream(sessionId: string | null): DelegatedPreviewStream {
  const client = useQueryClient();
  const [stream, setStream] = useState<DelegatedPreviewStream>(EMPTY);
  const [seenSession, setSeenSession] = useState(sessionId);
  if (seenSession !== sessionId) {
    setSeenSession(sessionId);
    setStream(EMPTY);
  }

  useEffect(() => {
    if (!sessionId || typeof EventSource === "undefined") return undefined;

    let disposed = false;
    let settled = false;
    let reloadTimer: number | null = null;

    const reloadSnapshot = () => {
      clearTimeout(reloadTimer ?? undefined);
      reloadTimer = window.setTimeout(() => {
        reloadTimer = null;
        if (disposed) return;
        void client.invalidateQueries({
          queryKey: queryKeys.sessionSnapshot(sessionId),
          exact: true,
        });
      }, RELOAD_DEBOUNCE_MS);
    };

    const applyDelta = (delta: AssistantStreamDelta) => {
      if (delta.thread_name) return;
      if (delta.reset) {
        settled = false;
        setStream(EMPTY);
        return;
      }
      const startFresh = settled;
      settled = false;
      setStream((current) => {
        const base = startFresh ? EMPTY : current;
        return {
          text: base.text + (delta.text ?? ""),
          reasoning: base.reasoning + (delta.reasoning ?? ""),
          running: true,
        };
      });
    };

    const applyEnvelope = (envelope: SessionEventEnvelope) => {
      const event = envelope.event;
      switch (event.type) {
        case "transcript_appended":
        case "snapshot_saved":
          settled = true;
          reloadSnapshot();
          return;
        case "run_started":
          settled = false;
          setStream({ text: "", reasoning: "", running: true });
          reloadSnapshot();
          return;
        case "run_completed":
          settled = true;
          setStream({ text: event.response, reasoning: "", running: false });
          reloadSnapshot();
          return;
        case "run_failed":
        case "run_cancelled":
          settled = true;
          setStream((current) => ({ ...current, running: false }));
          reloadSnapshot();
          return;
        case "transcript_reverted":
          settled = true;
          setStream(EMPTY);
          reloadSnapshot();
          return;
        default:
          return;
      }
    };

    const dispose = subscribeToSessionEvents(sessionId, {
      onEnvelope: applyEnvelope,
      onAssistantDelta: applyDelta,
      onReplayBoundary: reloadSnapshot,
      onReplayGap: reloadSnapshot,
      onLagged: reloadSnapshot,
    });

    return () => {
      disposed = true;
      dispose();
      clearTimeout(reloadTimer ?? undefined);
    };
  }, [client, sessionId]);

  return stream;
}
