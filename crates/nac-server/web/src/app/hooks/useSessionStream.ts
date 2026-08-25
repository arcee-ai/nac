import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { SNAPSHOT_MESSAGE_LIMIT, mergeMessageTail } from "@/app/lib/messageWindow";
import { perfMark } from "@/app/lib/perfDebug";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import {
  beginTailFetch,
  disposeSessionRefresh,
  fenceSessionSnapshot,
  finishTailFetch,
  isCurrentSessionGeneration,
} from "@/app/services/sessionRefresh";
import { subscribeToSessionEvents } from "@/app/services/eventStream";
import {
  applyAssistantDelta,
  applyEnvelope,
  clearRuntimeThreads,
  resetRuntime,
  setStreamStatus,
  syncRunFromSnapshot,
} from "@/app/store/runtimeStore";
import type { ActiveRunSnapshot, SessionSnapshotResponse } from "@/app/types/api";

// Events arrive far faster than a snapshot can be fetched, so reloads are
// coalesced into one request per window.
const RELOAD_DEBOUNCE_MS = 250;

/**
 * Keep the runtime store fed by the session event stream and refresh the
 * snapshot query whenever an event changes canonical state.
 */
export function useSessionStream(sessionId: string | null): void {
  const client = useQueryClient();

  useEffect(() => {
    if (!sessionId) {
      resetRuntime(null);
      return;
    }

    const id = sessionId;
    resetRuntime(id);
    let disposed = false;
    let tailTimer: number | null = null;
    let snapshotTimer: number | null = null;
    let tailRunning = false;
    let snapshotRunning = false;
    let tailDirty = false;
    let highestTranscriptLength = 0;
    let snapshotRequest = 0;
    let epochId: string | null = null;

    function scheduleSnapshot(replace: boolean) {
      if (replace) {
        highestTranscriptLength = 0;
        clearRuntimeThreads();
        void client.cancelQueries({
          queryKey: queryKeys.threadEventsRoot(id),
        });
        client.removeQueries({ queryKey: queryKeys.threadEventsRoot(id) });
      }
      void client.cancelQueries({
        queryKey: queryKeys.sessionSnapshot(id),
        exact: true,
      });
      fenceSessionSnapshot(id, replace);
      clearTimeout(tailTimer ?? undefined);
      tailTimer = null;
      tailDirty = false;
      clearTimeout(snapshotTimer ?? undefined);
      snapshotTimer = setTimeout(() => {
        snapshotTimer = null;
        const requestId = ++snapshotRequest;
        snapshotRunning = true;
        perfMark("query:invalidate.session", { throttleMs: 0 });
        void client
          .invalidateQueries({
            queryKey: queryKeys.sessionSnapshot(id),
            exact: true,
          })
          .finally(() => {
            if (requestId !== snapshotRequest) return;
            snapshotRunning = false;
            if (tailDirty && snapshotTimer === null) void drainTail();
          });
      }, RELOAD_DEBOUNCE_MS);
    }

    async function drainTail() {
      if (disposed || tailRunning || snapshotRunning || snapshotTimer !== null) {
        return;
      }
      let followUpsRemaining = 1;
      tailRunning = true;
      try {
        while (!disposed && tailDirty && !snapshotRunning && snapshotTimer === null) {
          tailDirty = false;
          const token = beginTailFetch(id);
          try {
            const page = await api.getMessages(id, {
              limit: SNAPSHOT_MESSAGE_LIMIT,
              includeSystem: true,
              signal: token.controller.signal,
            });
            if (disposed || !isCurrentSessionGeneration(id, token.generation)) {
              continue;
            }

            let snapshotRequired = false;
            client.setQueryData<SessionSnapshotResponse>(
              queryKeys.sessionSnapshot(id),
              (current) => {
                if (!current) {
                  snapshotRequired = true;
                  return current;
                }
                const merged = mergeMessageTail(current, page);
                if (merged.kind === "snapshot-required") {
                  snapshotRequired = true;
                  return current;
                }
                return merged.snapshot;
              },
            );
            if (snapshotRequired) {
              scheduleSnapshot(true);
              return;
            }
            if (page.page.total < highestTranscriptLength) {
              if (followUpsRemaining === 0) {
                scheduleSnapshot(false);
                return;
              }
              followUpsRemaining -= 1;
              tailDirty = true;
            }
          } catch {
            if (
              !token.controller.signal.aborted &&
              isCurrentSessionGeneration(id, token.generation)
            ) {
              scheduleSnapshot(true);
            }
          } finally {
            finishTailFetch(id, token);
          }
        }
      } finally {
        tailRunning = false;
      }
    }

    const scheduleTail = (transcriptLength: number) => {
      highestTranscriptLength = Math.max(highestTranscriptLength, transcriptLength);
      tailDirty = true;
      if (snapshotTimer !== null || snapshotRunning || tailRunning) return;
      clearTimeout(tailTimer ?? undefined);
      tailTimer = setTimeout(() => {
        tailTimer = null;
        void drainTail();
      }, RELOAD_DEBOUNCE_MS);
    };

    const refreshPermissions = () => {
      // Permission state is intentionally infinitely fresh and normally
      // follows its exact SSE events. Whenever replay continuity is lost, the
      // only safe substitute is a canonical refetch of the active query.
      void client.invalidateQueries({
        queryKey: queryKeys.sessionPermissions(id),
        exact: true,
      });
    };

    const replaceAfterReplayLoss = () => {
      scheduleSnapshot(true);
      refreshPermissions();
    };

    const dispose = subscribeToSessionEvents(id, {
      onEnvelope: (envelope) => {
        if (envelope.event.type === "agent" && envelope.event.event.type === "thread_finished") {
          // The paged command log is intentionally cached forever while live
          // SSE events extend it. Once the worker exits, refetch its newest
          // page so a final tool result cannot remain live-only (or missing
          // after runtime state is cleared during snapshot replacement).
          void client.invalidateQueries({
            queryKey: queryKeys.threadEvents(id, envelope.event.event.name),
            exact: true,
          });
        }
        const refresh = applyEnvelope(envelope);
        if (refresh === "messages") {
          scheduleTail(
            envelope.event.type === "transcript_appended" ? envelope.event.transcript_len : 0,
          );
        } else if (refresh === "snapshot") {
          scheduleSnapshot(false);
        } else if (refresh === "replace-snapshot") {
          scheduleSnapshot(true);
        }
        if (envelope.event.type === "run_completed") {
          void client.invalidateQueries({
            queryKey: queryKeys.workspaceRevisions(id),
          });
        }
        if (
          envelope.event.type === "permission_asked" ||
          envelope.event.type === "permission_replied" ||
          envelope.event.type === "permission_dismissed"
        ) {
          refreshPermissions();
        }
      },
      onAssistantDelta: applyAssistantDelta,
      onStatus: setStreamStatus,
      onReplayBoundary: (boundary) => {
        if (epochId !== null && boundary.epoch_id !== epochId) {
          scheduleSnapshot(true);
          void client.invalidateQueries({
            queryKey: queryKeys.sessionSkills(id),
            exact: true,
          });
          refreshPermissions();
        }
        epochId = boundary.epoch_id;
      },
      onReplayGap: replaceAfterReplayLoss,
      onLagged: replaceAfterReplayLoss,
    });

    return () => {
      snapshotRequest += 1;
      disposed = true;
      dispose();
      clearTimeout(tailTimer ?? undefined);
      clearTimeout(snapshotTimer ?? undefined);
      disposeSessionRefresh(id);
      void client.cancelQueries({ queryKey: queryKeys.threadEventsRoot(id) });
      client.removeQueries({ queryKey: queryKeys.threadEventsRoot(id) });
    };
  }, [sessionId, client]);
}

/**
 * Reconcile the live running flag with the snapshot, so a reload during a run
 * does not show the session as idle until the next event arrives.
 */
export function useRunStateSync(activeRun: ActiveRunSnapshot | null | undefined): void {
  useEffect(() => {
    syncRunFromSnapshot(activeRun);
  }, [activeRun]);
}
