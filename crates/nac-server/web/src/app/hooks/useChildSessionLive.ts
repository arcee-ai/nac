import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { subscribeToSessionEvents } from "@/app/services/eventStream";
import { queryKeys } from "@/app/services/queries";

const RELOAD_DEBOUNCE_MS = 250;

export interface ChildLiveStream {
  text: string;
  reasoning: string;
  running: boolean;
}

/** What the snapshot now carries, dropped from the head of the live buffer. */
function remainder(buffered: string, committed: string): string {
  return buffered.startsWith(committed) ? buffered.slice(committed.length) : "";
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
  const bufferRef = useRef({ text: "", reasoning: "" });
  const [text, setText] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const buffer = bufferRef.current;

    const publish = () => {
      setText(buffer.text);
      setReasoning(buffer.reasoning);
    };

    const clearBuffer = () => {
      buffer.text = "";
      buffer.reasoning = "";
      publish();
    };

    // A new subscription never inherits the previous child's partial output.
    clearBuffer();
    if (!sessionId || !enabled) {
      setRunning(false);
      return;
    }

    let disposed = false;
    let snapshotTimer: number | null = null;
    /**
     * What the pending refetch is expected to commit. Dropping it only once the
     * snapshot has landed keeps the streamed output on screen instead of
     * blanking it for the length of the debounce.
     */
    let committing: { text: string; reasoning: string } | null = null;
    const id = sessionId;

    const scheduleSnapshot = (commitBuffer = false) => {
      if (commitBuffer) committing = { ...buffer };
      if (snapshotTimer != null) window.clearTimeout(snapshotTimer);
      snapshotTimer = window.setTimeout(() => {
        snapshotTimer = null;
        if (disposed) return;
        const committed = committing;
        committing = null;
        void client
          .invalidateQueries({
            queryKey: queryKeys.sessionSnapshot(id),
            exact: true,
          })
          .then(() => {
            if (disposed || !committed) return;
            buffer.text = remainder(buffer.text, committed.text);
            buffer.reasoning = remainder(buffer.reasoning, committed.reasoning);
            publish();
          });
      }, RELOAD_DEBOUNCE_MS);
    };

    const dispose = subscribeToSessionEvents(id, {
      onEnvelope: (envelope) => {
        const type = envelope.event.type;
        if (type === "run_started") {
          committing = null;
          clearBuffer();
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
        if (type === "transcript_reverted") {
          committing = null;
          clearBuffer();
        }
        scheduleSnapshot(type === "transcript_appended");
      },
      onAssistantDelta: (delta) => {
        if (delta.thread_name) return;
        if (!delta.text && !delta.reasoning) return;
        buffer.text += delta.text ?? "";
        buffer.reasoning += delta.reasoning ?? "";
        publish();
      },
      onReplayGap: () => scheduleSnapshot(),
      onLagged: () => scheduleSnapshot(),
    });

    return () => {
      disposed = true;
      dispose();
      if (snapshotTimer != null) window.clearTimeout(snapshotTimer);
    };
  }, [client, enabled, parentSessionId, sessionId]);

  return { text, reasoning, running };
}
