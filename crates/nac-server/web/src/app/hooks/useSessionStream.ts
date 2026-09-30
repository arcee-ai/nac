import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { makeObservationPorts } from "@/app/features/direct-session/browserAdapters";
import { openSessionObservation } from "@/app/features/direct-session/browserRuntime";
import { queryKeys } from "@/app/services/queries/keys";
import { subscribeToSessionEvents } from "@/app/services/eventStream";
import { resetRuntime, syncRunFromSnapshot } from "@/app/store/runtimeStore";
import type { ActiveRunSnapshot } from "@/app/types/api";

/** Bind React activation to the scoped session observation workflow. */
export function useSessionStream(sessionId: string | null): void {
  const client = useQueryClient();
  useEffect(() => {
    if (!sessionId) {
      resetRuntime(null);
      return;
    }
    return openSessionObservation(makeObservationPorts(client, sessionId));
  }, [sessionId, client]);
}

/**
 * Keep a delegated child's approval channel live from its parent chat without
 * applying that child's runtime events to the parent's transcript store.
 */
export function useDelegatedPermissionStream(sessionId: string, enabled: boolean): void {
  const client = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      void client.invalidateQueries({
        queryKey: queryKeys.sessionPermissions(sessionId),
        exact: true,
      });
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
  }, [client, enabled, sessionId]);
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
