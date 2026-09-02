import { useEffect } from "react";

import {
  noteLiveActionRun,
  useActionsFollowLocked,
  useActionsFollowRunId,
} from "@/app/store/sessionLayoutStore";

/**
 * During a live run the Actions list follows the newest row for the active
 * filter, until the reader clicks a row (or a chat card) and locks follow.
 */
export function useLiveActionFollow(runId: string | null): boolean {
  useEffect(() => {
    noteLiveActionRun(runId);
  }, [runId]);
  const locked = useActionsFollowLocked();
  const tracked = useActionsFollowRunId();
  return Boolean(runId) && !locked && (tracked === runId || tracked == null);
}
