import { runtimeForQueryClient } from "@/app/runtime/nativeRuntime";
import type { QueryClient } from "@tanstack/react-query";

import { SNAPSHOT_MESSAGE_LIMIT, mergeMessageTail } from "@/app/lib/messageWindow";
import { perfMark } from "@/app/lib/perfDebug";
import { api } from "@/app/services/api";
import { subscribeToSessionEvents } from "@/app/services/eventStream";
import { queryKeys } from "@/app/services/queries/keys";
import {
  beginTailFetch,
  disposeSessionRefresh,
  fenceSessionSnapshot,
  finishTailFetch,
  isCurrentSessionGeneration,
  sessionRefreshKey,
} from "@/app/services/sessionRefresh";

import type { SessionSnapshotResponse } from "@/app/types/api";
import type { ObservationPorts } from "./streamReconciliation";

/** Bind canonical cache, generation, and live projection adapters to one endpoint/cache. */
export function makeObservationPorts(
  client: QueryClient,
  id: string,
  adapters: {
    readMessages: typeof api.getMessages;
    subscribe: typeof subscribeToSessionEvents;
  } = {
    readMessages: runtimeForQueryClient(client).api.getMessages,
    subscribe: runtimeForQueryClient(client).events,
  },
): ObservationPorts {
  const {
    applyAssistantDelta,
    applyEnvelope,
    captureRuntimeActivation,
    clearRuntimeThreads,
    resetRuntime,
    setStreamStatus,
    syncRunFromSnapshot,
  } = runtimeForQueryClient(client).stores.runtimeStore;
  const refreshKey = sessionRefreshKey(client, id);
  let active = false;
  let ownsRuntime = () => false;
  return {
    attach: () => {
      active = true;
      resetRuntime(id);
      ownsRuntime = captureRuntimeActivation(id);
      syncRunFromSnapshot(
        client.getQueryData<SessionSnapshotResponse>(queryKeys.sessionSnapshot(id))?.active_run,
      );
    },
    detach: () => {
      active = false;
      if (ownsRuntime()) resetRuntime(null);
      disposeSessionRefresh(refreshKey);
      void client.cancelQueries({ queryKey: queryKeys.sessionSnapshot(id), exact: true });
      void client.cancelQueries({ queryKey: queryKeys.threadEventsRoot(id) });
      client.removeQueries({ queryKey: queryKeys.threadEventsRoot(id) });
    },
    subscribe: (callbacks) =>
      adapters.subscribe(id, {
        onEnvelope: (envelope) => {
          if (!active) return;
          const event = envelope.event;
          callbacks.change({
            refresh: applyEnvelope(envelope),
            transcriptLength: event.type === "transcript_appended" ? event.transcript_len : 0,
            finishedThread:
              event.type === "agent" && event.event.type === "thread_finished"
                ? event.event.name
                : undefined,
            runCompleted: event.type === "run_completed",
            permissionsChanged:
              event.type === "permission_asked" ||
              event.type === "permission_replied" ||
              event.type === "permission_dismissed" ||
              event.type === "permission_approval_mode_changed",
          });
        },
        onAssistantDelta: (delta) => {
          if (active) applyAssistantDelta(delta);
        },
        onStatus: (status) => {
          if (active) setStreamStatus(status);
        },
        onReplayBoundary: (boundary) => {
          if (active) callbacks.epoch(boundary.epoch_id);
        },
        onReplayGap: callbacks.replayLost,
        onLagged: callbacks.replayLost,
        onSequenceGap: callbacks.replayLost,
        onBackpressure: callbacks.replayLost,
      }),
    fenceSnapshot: (replace) => {
      if (replace) {
        clearRuntimeThreads();
        void client.cancelQueries({ queryKey: queryKeys.threadEventsRoot(id) });
        client.removeQueries({ queryKey: queryKeys.threadEventsRoot(id) });
      }
      void client.cancelQueries({ queryKey: queryKeys.sessionSnapshot(id), exact: true });
      fenceSessionSnapshot(refreshKey, replace);
    },
    snapshot: async () => {
      perfMark("query:invalidate.session", { throttleMs: 0 });
      await client.invalidateQueries({ queryKey: queryKeys.sessionSnapshot(id), exact: true });
    },
    tail: async (signal) => {
      const token = beginTailFetch(refreshKey);
      const readSignal = AbortSignal.any([signal, token.controller.signal]);
      try {
        const page = await adapters.readMessages(id, {
          limit: SNAPSHOT_MESSAGE_LIMIT,
          includeSystem: true,
          signal: readSignal,
        });
        if (
          !active ||
          readSignal.aborted ||
          !isCurrentSessionGeneration(refreshKey, token.generation)
        ) {
          return { kind: "obsolete" };
        }
        let snapshotRequired = false;
        client.setQueryData<SessionSnapshotResponse>(queryKeys.sessionSnapshot(id), (current) => {
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
        });
        return snapshotRequired
          ? { kind: "snapshot-required" }
          : { kind: "accepted", total: page.page.total };
      } catch (error) {
        if (readSignal.aborted || !isCurrentSessionGeneration(refreshKey, token.generation)) {
          return { kind: "obsolete" };
        }
        throw error;
      } finally {
        finishTailFetch(refreshKey, token);
      }
    },
    invalidate: (kind, thread) => {
      const key =
        kind === "permissions"
          ? queryKeys.sessionPermissions(id)
          : kind === "skills"
            ? queryKeys.sessionSkills(id)
            : kind === "revisions"
              ? queryKeys.workspaceRevisions(id)
              : queryKeys.threadEvents(id, thread ?? "");
      void client.invalidateQueries({ queryKey: key, exact: true });
    },
  };
}
