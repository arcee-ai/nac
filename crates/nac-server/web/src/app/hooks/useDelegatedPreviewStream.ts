import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/app/services/queries";

import type {
  AgentEvent,
  AssistantStreamDelta,
  SessionEventEnvelope,
  SessionSnapshotResponse,
} from "@/app/types/api";

// Same window the open session uses before it reloads canonical messages.
const RELOAD_DEBOUNCE_MS = 250;

export interface DelegatedPreviewStream {
  text: string;
  reasoning: string;
  /** True from `run_started` until the run settles, and while deltas are arriving. */
  running: boolean;
  settled: boolean;
  startedAt: number | null;
  baselineEnd: number | null;
  runId: string | null;
  promptEnd: number | null;
  recovering: boolean;
  toolEvents: AgentEvent[];
}

const EMPTY: DelegatedPreviewStream = {
  text: "",
  reasoning: "",
  running: false,
  settled: true,
  startedAt: null,
  baselineEnd: null,
  runId: null,
  promptEnd: null,
  recovering: false,
  toolEvents: [],
};

/**
 * Live model output for a subagent previewed from its parent.
 *
 * The parent's runtime store belongs to the open session. This subscription
 * keeps the child's deltas and snapshot refreshes on the side, so a run in the
 * preview can paint as it is produced without rewriting the parent transcript.
 */
export function useDelegatedPreviewStream(sessionId: string | null): DelegatedPreviewStream {
  const { subscribeToSessionEvents } = { subscribeToSessionEvents: useNativeRuntime().events };

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
    let activeRunId: string | null = null;
    let activeStartedAt: number | null = null;
    let recovering = false;
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
      if (recovering) return;
      if (delta.thread_name) return;
      if (delta.reset) {
        settled = false;
        setStream((current) => ({
          ...EMPTY,
          settled: false,
          toolEvents: current.toolEvents,
          startedAt: current.startedAt,
          baselineEnd: current.baselineEnd,
          runId: current.runId,
          promptEnd: current.promptEnd,
          recovering: false,
        }));
        return;
      }
      const startFresh = settled;
      settled = false;
      setStream((current) => {
        const base = startFresh
          ? {
              ...EMPTY,
              toolEvents: current.toolEvents,
              startedAt: current.startedAt,
              baselineEnd: current.baselineEnd,
              runId: current.runId,
              promptEnd: current.promptEnd,
              recovering: false,
            }
          : current;
        return {
          text: base.text + (delta.text ?? ""),
          reasoning: base.reasoning + (delta.reasoning ?? ""),
          running: true,
          settled: false,
          startedAt: base.startedAt,
          baselineEnd: base.baselineEnd,
          runId: base.runId,
          promptEnd: base.promptEnd,
          recovering: false,
          toolEvents: base.toolEvents,
        };
      });
    };

    const applyEnvelope = (envelope: SessionEventEnvelope) => {
      const event = envelope.event;
      if (
        event.type !== "run_started" &&
        activeRunId &&
        envelope.run_id &&
        activeRunId !== envelope.run_id
      )
        return;
      switch (event.type) {
        case "transcript_appended":
          settled = true;
          setStream((current) => ({
            ...current,
            settled: true,
            promptEnd:
              current.startedAt != null &&
              current.promptEnd == null &&
              (!current.runId || !envelope.run_id || current.runId === envelope.run_id)
                ? event.transcript_len
                : current.promptEnd,
          }));
          reloadSnapshot();
          return;
        case "snapshot_saved":
          settled = true;
          setStream((current) => ({ ...current, settled: true }));
          reloadSnapshot();
          return;
        case "run_started":
          if (recovering && !activeRunId && activeStartedAt == null) {
            activeRunId = envelope.run_id ?? null;
            activeStartedAt = event.started_at_epoch_ms;
            setStream((current) => ({ ...current, runId: activeRunId }));
            reloadSnapshot();
            return;
          }
          if (
            recovering &&
            (activeRunId && envelope.run_id
              ? activeRunId === envelope.run_id
              : activeStartedAt === event.started_at_epoch_ms)
          ) {
            reloadSnapshot();
            return;
          }
          recovering = false;
          settled = false;
          activeRunId = envelope.run_id ?? null;
          activeStartedAt = event.started_at_epoch_ms;
          {
            const snapshot = client.getQueryData<SessionSnapshotResponse>(
              queryKeys.sessionSnapshot(sessionId),
            );
            const baselineEnd = snapshot
              ? (snapshot.message_page?.end ?? snapshot.messages.length)
              : null;
            setStream({
              ...EMPTY,
              running: true,
              settled: false,
              startedAt: event.started_at_epoch_ms,
              baselineEnd,
              runId: envelope.run_id ?? null,
            });
          }
          reloadSnapshot();
          return;
        case "run_completed":
          settled = true;
          if (recovering) {
            reloadSnapshot();
            return;
          }
          setStream((current) => ({
            ...current,
            text: event.response,
            running: false,
            settled: true,
          }));
          reloadSnapshot();
          return;
        case "run_failed":
        case "run_cancelled":
          settled = true;
          setStream((current) => ({ ...current, running: false, settled: true }));
          reloadSnapshot();
          return;
        case "transcript_reverted":
          settled = true;
          setStream(EMPTY);
          reloadSnapshot();
          return;
        case "agent": {
          const agent = event.event;
          if (
            (agent.type === "tool_call_started" || agent.type === "tool_call_finished") &&
            !agent.thread_name
          ) {
            setStream((current) => ({
              ...current,
              toolEvents: [
                ...current.toolEvents.filter(
                  (prior) =>
                    !(
                      (prior.type === "tool_call_started" || prior.type === "tool_call_finished") &&
                      prior.type === agent.type &&
                      prior.call_id === agent.call_id
                    ),
                ),
                agent,
              ].slice(-400),
            }));
            reloadSnapshot();
          }
          return;
        }
        default:
          return;
      }
    };

    // A missing envelope makes the overlay's run boundary unknowable. Drop it
    // and ignore deltas for this run; the preview refreshes canonical history
    // as the parent relationship advances, even if the terminal event is lost.
    const recoverFromGap = () => {
      recovering = true;
      settled = true;
      setStream({ ...EMPTY, runId: activeRunId, recovering: true });
      reloadSnapshot();
    };

    const dispose = subscribeToSessionEvents(sessionId, {
      onEnvelope: applyEnvelope,
      onAssistantDelta: applyDelta,
      onReplayBoundary: reloadSnapshot,
      onReplayGap: recoverFromGap,
      onLagged: recoverFromGap,
      onSequenceGap: recoverFromGap,
      onBackpressure: recoverFromGap,
    });

    return () => {
      disposed = true;
      dispose();
      clearTimeout(reloadTimer ?? undefined);
    };
  }, [client, sessionId, subscribeToSessionEvents]);

  return stream;
}
