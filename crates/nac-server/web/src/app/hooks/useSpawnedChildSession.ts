import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";

import type { AgentToolsGroup } from "@/app/lib/agentSegments";
import { routes } from "@/app/lib/routes";
import { assignmentIsOpen, sessionTypeFromBehavior } from "@/app/lib/sessionBehavior";
import {
  assignmentForSpawn,
  childPreviewLines,
  spawnChildIdFromGroup,
} from "@/app/lib/spawnSession";
import { buildTranscript } from "@/app/lib/transcript";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { toRunError } from "@/app/lib/providerError";
import { ApiError } from "@/app/services/api";
import {
  useCancelSessionSpawn,
  useSessionSnapshot,
  useSessionSpawns,
  useStartSessionSpawn,
} from "@/app/services/queries";

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * Parent-owned controls and peek data for one `session_spawn` card, Actions
 * preview, or Related Sessions detail. `source` is the tools group or the child
 * session id. Snapshot fetch is keyed by child id; it never writes the parent's
 * runtime store.
 */
export function useSpawnedChildSession(
  parentSessionId: string,
  source: AgentToolsGroup | string,
) {
  const navigate = useNavigate();
  const toast = useToast();
  const assignments = useSessionSpawns(parentSessionId, Boolean(parentSessionId));
  const startSpawn = useStartSessionSpawn();
  const cancelSpawn = useCancelSessionSpawn();
  const group = typeof source === "string" ? null : source;
  const assignment = assignmentForSpawn(assignments.data, source);
  const childId =
    (typeof source === "string" ? source : spawnChildIdFromGroup(source)) ||
    assignment?.child_session_id ||
    null;
  const snapshotQuery = useSessionSnapshot(childId, {
    enabled: Boolean(childId),
    retry: false,
    refetchInterval: (query) =>
      assignmentIsOpen(assignment?.status) || Boolean(query.state.data?.active_run) ? 1_000 : false,
  });
  const missing = Boolean(childId) && snapshotQuery.isError && isNotFound(snapshotQuery.error);
  const running =
    assignmentIsOpen(assignment?.status) ||
    Boolean(snapshotQuery.data?.active_run) ||
    (!childId && Boolean(group?.inProgress));
  const title = (assignment?.description || group?.label || "").trim() || "Spawned session";
  const sessionType = sessionTypeFromBehavior(
    assignment?.child_behavior ?? snapshotQuery.data?.metadata.behavior,
  );
  const lines = useMemo(() => {
    const turns = buildTranscript(snapshotQuery.data ?? null, {}, {}, []);
    return childPreviewLines(turns, running);
  }, [snapshotQuery.data, running]);
  const busy = startSpawn.isPending || cancelSpawn.isPending;

  const pause = useCallback(async () => {
    if (!childId) return;
    try {
      await cancelSpawn.mutateAsync({ sessionId: parentSessionId, childId });
    } catch (error) {
      toast.error(`Unable to pause delegated work: ${errorMessage(toRunError(error))}`);
    }
  }, [cancelSpawn, childId, parentSessionId, toast]);

  const stop = useCallback(async () => {
    if (!childId) return;
    try {
      await cancelSpawn.mutateAsync({ sessionId: parentSessionId, childId });
    } catch (error) {
      toast.error(`Unable to stop delegated work: ${errorMessage(toRunError(error))}`);
    }
  }, [cancelSpawn, childId, parentSessionId, toast]);

  const send = useCallback(
    async (prompt: string) => {
      if (!childId) return false;
      const text = prompt.trim();
      if (!text) return false;
      try {
        await startSpawn.mutateAsync({
          sessionId: parentSessionId,
          payload: {
            behavior: assignment?.child_behavior ?? "direct",
            child_session_id: childId,
            description: assignment?.description || group?.label || "Spawned session",
            prompt: text,
            background: true,
          },
        });
        return true;
      } catch (error) {
        toast.error(`Unable to send to spawned session: ${errorMessage(toRunError(error))}`);
        return false;
      }
    },
    [
      assignment?.child_behavior,
      assignment?.description,
      childId,
      group?.label,
      parentSessionId,
      startSpawn,
      toast,
    ],
  );

  const play = useCallback(async () => {
    await send("Continue.");
  }, [send]);

  const open = useCallback(() => {
    if (!childId) return;
    navigate(routes.session(childId));
  }, [childId, navigate]);

  return {
    childId,
    assignment,
    snapshot: snapshotQuery.data ?? null,
    snapshotPending: snapshotQuery.isPending && Boolean(childId),
    missing,
    running,
    title,
    sessionType,
    lines,
    busy,
    pause,
    play,
    send,
    stop,
    open,
  };
}
