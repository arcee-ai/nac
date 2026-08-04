import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/app/services/queries";
import { subscribeToSessionEvents } from "@/app/services/eventStream";
import {
  applyAssistantDelta,
  applyEnvelope,
  resetRuntime,
  setStreamStatus,
  syncRunFromSnapshot,
} from "@/app/store/runtimeStore";
import type { ActiveRunSnapshot } from "@/app/types/api";

// Events arrive far faster than a snapshot can be fetched, so reloads are
// coalesced into one request per window.
const RELOAD_DEBOUNCE_MS = 250;

/**
 * Keep the runtime store fed by the session event stream and refresh the
 * snapshot query whenever an event changes canonical state.
 */
export function useSessionStream(sessionId: string | null): void {
  const client = useQueryClient();
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!sessionId) {
      resetRuntime(null);
      return;
    }

    resetRuntime(sessionId);

    const scheduleReload = () => {
      if (reloadTimer.current) return;
      reloadTimer.current = setTimeout(() => {
        reloadTimer.current = null;
        void client.invalidateQueries({ queryKey: queryKeys.session(sessionId) });
      }, RELOAD_DEBOUNCE_MS);
    };

    const dispose = subscribeToSessionEvents(sessionId, {
      onEnvelope: (envelope) => {
        if (applyEnvelope(envelope)) scheduleReload();
        // A finished run leaves a new revision behind, and it is the only
        // moment one ever appears.
        if (envelope.event.type === "run_completed") {
          void client.invalidateQueries({
            queryKey: queryKeys.workspaceRevisions(sessionId),
          });
        }
      },
      // Deltas never invalidate the snapshot: they are the same text the
      // assistant message will bring, only sooner.
      onAssistantDelta: applyAssistantDelta,
      onStatus: setStreamStatus,
      // A gap or a lagged subscriber means events were dropped, so the
      // snapshot is the only reliable way back to a consistent view.
      onReplayGap: scheduleReload,
      onLagged: scheduleReload,
    });

    return () => {
      dispose();
      if (reloadTimer.current) {
        clearTimeout(reloadTimer.current);
        reloadTimer.current = null;
      }
    };
  }, [sessionId, client]);
}

/**
 * Reconcile the live running flag with the snapshot, so a reload during a run
 * does not show the session as idle until the next event arrives.
 */
export function useRunStateSync(
  activeRun: ActiveRunSnapshot | null | undefined,
): void {
  useEffect(() => {
    syncRunFromSnapshot(activeRun);
  }, [activeRun]);
}
