import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { subscribeToSessionEvents } from "@/app/services/eventStream";
import { queryKeys } from "@/app/services/queries";

const RELOAD_DEBOUNCE_MS = 250;

export interface ChildLiveStream {
  text: string;
  reasoning: string;
  running: boolean;
}

/**
 * Live child-session stream for a parent-owned preview. Invalidates that
 * child's snapshot query and keeps a local typing buffer. Never writes the
 * global runtime store — a second `useSessionStream` would steal the parent's
 * transcript.
 */
export function useChildSessionLive(
  sessionId: string | null,
  enabled: boolean,
  parentSessionId?: string,
): ChildLiveStream {
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!sessionId || !enabled) {
      setText("");
      setReasoning("");
      setRunning(false);
      return;
    }

    let disposed = false;
    let snapshotTimer: number | null = null;
    const id = sessionId;

    const scheduleSnapshot = () => {
      if (snapshotTimer != null) window.clearTimeout(snapshotTimer);
      snapshotTimer = window.setTimeout(() => {
        snapshotTimer = null;
        if (disposed) return;
        void client.invalidateQueries({
          queryKey: queryKeys.sessionSnapshot(id),
          exact: true,
        });
      }, RELOAD_DEBOUNCE_MS);
    };

    const dispose = subscribeToSessionEvents(id, {
      onEnvelope: (envelope) => {
        const type = envelope.event.type;
        if (type === "run_started") {
          setText("");
          setReasoning("");
          setRunning(true);
        } else if (
          type === "run_completed" ||
          type === "run_failed" ||
          type === "run_cancelled"
        ) {
          setRunning(false);
          if (parentSessionId) {
            void client.invalidateQueries({
              queryKey: queryKeys.sessionSpawns(parentSessionId),
            });
          }
        }
        if (type === "transcript_appended" || type === "transcript_reverted") {
          setText("");
          setReasoning("");
        }
        scheduleSnapshot();
      },
      onAssistantDelta: (delta) => {
        if (delta.thread_name) return;
        if (delta.text) setText((current) => current + delta.text);
        if (delta.reasoning) setReasoning((current) => current + delta.reasoning);
      },
      onReplayGap: scheduleSnapshot,
      onLagged: scheduleSnapshot,
    });

    return () => {
      disposed = true;
      dispose();
      if (snapshotTimer != null) window.clearTimeout(snapshotTimer);
    };
  }, [client, enabled, parentSessionId, sessionId]);

  return { text, reasoning, running };
}
