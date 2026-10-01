import { useContext, useEffect } from "react";
import { RegistryContext } from "@effect/atom-react";

import { atomRefresh, patchRemote, refreshPrefixed, resetPrefixed } from "@/app/effect/remote";
import { SNAPSHOT_MESSAGE_LIMIT, mergeMessageTail } from "@/app/lib/messageWindow";
import { perfMark } from "@/app/lib/perfDebug";
import { api } from "@/app/services/api";
import { atomIds } from "@/app/services/queries/keys";
import { sessionSkillsAtom } from "@/app/services/queries/configuration";
import { sessionPermissionsAtom } from "@/app/services/queries/direct";
import {
  sessionSnapshotAtom,
  threadEventsAtom,
  threadEventsKey,
} from "@/app/services/queries/session";
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
import type { ActiveRunSnapshot } from "@/app/types/api";

// Events arrive far faster than a snapshot can be fetched, so reloads are
// coalesced into one request per window.
const RELOAD_DEBOUNCE_MS = 250;

/** Paged thread logs for one session: `session\0${id}\0thread-events\0${name}`. */
function threadEventsPrefix(id: string): string {
  return `${atomIds.session(id)}\u0000thread-events`;
}

/**
 * Keep the runtime store fed by the session event stream and refresh the
 * snapshot atom whenever an event changes canonical state.
 */
export function useSessionStream(sessionId: string | null): void {
  const registry = useContext(RegistryContext);

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
        resetPrefixed(registry, threadEventsPrefix(id));
      }
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
        void atomRefresh.run(registry, sessionSnapshotAtom(id)).finally(() => {
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
            patchRemote(registry, sessionSnapshotAtom(id), (current) => {
              if (!current) {
                snapshotRequired = true;
                return undefined;
              }
              const merged = mergeMessageTail(current, page);
              if (merged.kind === "snapshot-required") {
                snapshotRequired = true;
                return undefined;
              }
              return merged.snapshot;
            });
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
      // only safe substitute is a canonical refetch of the active atom.
      void atomRefresh.run(registry, sessionPermissionsAtom(id));
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
          void atomRefresh.run(
            registry,
            threadEventsAtom(threadEventsKey(id, envelope.event.event.name)),
          );
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
          void refreshPrefixed(registry, atomIds.workspaceRevisions(id));
        }
        if (
          envelope.event.type === "permission_asked" ||
          envelope.event.type === "permission_replied" ||
          envelope.event.type === "permission_dismissed" ||
          envelope.event.type === "permission_approval_mode_changed"
        ) {
          refreshPermissions();
        }
      },
      onAssistantDelta: applyAssistantDelta,
      onStatus: setStreamStatus,
      onReplayBoundary: (boundary) => {
        if (epochId !== null && boundary.epoch_id !== epochId) {
          scheduleSnapshot(true);
          void atomRefresh.run(registry, sessionSkillsAtom(id));
          refreshPermissions();
        }
        epochId = boundary.epoch_id;
      },
      onReplayGap: replaceAfterReplayLoss,
      onLagged: replaceAfterReplayLoss,
      onSequenceGap: replaceAfterReplayLoss,
      onBackpressure: replaceAfterReplayLoss,
    });

    return () => {
      snapshotRequest += 1;
      disposed = true;
      dispose();
      clearTimeout(tailTimer ?? undefined);
      clearTimeout(snapshotTimer ?? undefined);
      disposeSessionRefresh(id);
      resetPrefixed(registry, threadEventsPrefix(id));
    };
  }, [sessionId, registry]);
}

/**
 * Keep a delegated child's approval channel live from its parent chat without
 * applying that child's runtime events to the parent's transcript store.
 */
export function useDelegatedPermissionStream(sessionId: string, enabled: boolean): void {
  const registry = useContext(RegistryContext);

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      void atomRefresh.run(registry, sessionPermissionsAtom(sessionId));
    };
    const dispose = subscribeToSessionEvents(sessionId, {
      onEnvelope: (envelope) => {
        if (
          envelope.event.type === "permission_asked" ||
          envelope.event.type === "permission_replied" ||
          envelope.event.type === "permission_dismissed" ||
          envelope.event.type === "permission_approval_mode_changed"
        ) {
          refresh();
        }
      },
      onStatus: (status) => {
        if (status === "live") refresh();
      },
      onReplayBoundary: refresh,
      onReplayGap: refresh,
      onLagged: refresh,
      onSequenceGap: refresh,
      onBackpressure: refresh,
    });
    return dispose;
  }, [registry, enabled, sessionId]);
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
