import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { isActiveRun } from "@/app/lib/format";
import { mostUrgent, needsYou, sessionStatus, type SessionStatus } from "@/app/lib/sessionStatus";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { queryKeys } from "@/app/services/queries/keys";
import type { ManagedSessionSummary } from "@/app/types/api";

/** Only a live run can be waiting on approval, so only those are probed. */
const MAX_PROBED = 12;
const PROBE_POLL_MS = 2_000;

/**
 * Pending permission counts for the sessions that are running right now.
 * Shares the session permission query key, so an open session's own 1s poll
 * and this probe read one cache entry.
 */
function usePendingPermissionCounts(runningIds: readonly string[]): ReadonlyMap<string, number> {
  const { api } = useNativeRuntime();
  const results = useQueries({
    queries: runningIds.slice(0, MAX_PROBED).map((id) => ({
      queryKey: queryKeys.sessionPermissions(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.getPermissions(id, signal),
      refetchInterval: PROBE_POLL_MS,
      staleTime: 0,
      retry: false,
    })),
  });
  const counts = results.map((result) => result.data?.requests.length ?? 0).join(",");
  return useMemo(() => {
    const map = new Map<string, number>();
    const values = counts ? counts.split(",").map(Number) : [];
    runningIds.slice(0, MAX_PROBED).forEach((id, index) => {
      if ((values[index] ?? 0) > 0) map.set(id, values[index]);
    });
    return map;
  }, [counts, runningIds]);
}

export interface SessionStatusIndex {
  /** A session's own rung. */
  own: (sessionId: string) => SessionStatus;
  /** Its own rung, raised to any descendant's rung that needs the user. */
  rolled: (sessionId: string) => SessionStatus;
}

/**
 * One status ladder over the whole session list: live runs, pending
 * approvals, finished-and-unseen (the attention store), and children working
 * while their parent waits.
 */
export function useSessionStatuses(sessions: readonly ManagedSessionSummary[]): SessionStatusIndex {
  const { attentionStore } = useNativeRuntime().stores.attentionStore;
  const flagged = attentionStore.useStore((state) => state.flagged);
  const runningIds = useMemo(
    () =>
      sessions
        .filter((entry) => isActiveRun(entry.active_run))
        .map((entry) => entry.summary.session_id),
    [sessions],
  );
  const runningKey = runningIds.join("\n");
  // Stable identity for the query list while the set of running ids is unchanged.
  const stableRunning = useMemo(() => (runningKey ? runningKey.split("\n") : []), [runningKey]);
  const pending = usePendingPermissionCounts(stableRunning);

  return useMemo(() => {
    const children = new Map<string, string[]>();
    for (const entry of sessions) {
      const parent = entry.lineage?.parent_session_id;
      if (!parent) continue;
      const bucket = children.get(parent);
      if (bucket) bucket.push(entry.summary.session_id);
      else children.set(parent, [entry.summary.session_id]);
    }
    const running = new Set(runningIds);
    const own = new Map<string, SessionStatus>();
    const rolledCache = new Map<string, SessionStatus>();

    const descendantsRunning = (id: string, seen = new Set<string>()): boolean => {
      for (const child of children.get(id) ?? []) {
        if (seen.has(child)) continue;
        seen.add(child);
        if (running.has(child) || descendantsRunning(child, seen)) return true;
      }
      return false;
    };

    for (const entry of sessions) {
      const id = entry.summary.session_id;
      own.set(
        id,
        sessionStatus({
          pendingPermissions: pending.get(id) ?? 0,
          running: running.has(id),
          childrenRunning: descendantsRunning(id),
          attention: Boolean(flagged[id]),
        }),
      );
    }

    const rolled = (id: string, seen = new Set<string>()): SessionStatus => {
      const cached = rolledCache.get(id);
      if (cached) return cached;
      seen.add(id);
      const statuses: SessionStatus[] = [own.get(id) ?? "idle"];
      for (const child of children.get(id) ?? []) {
        if (seen.has(child)) continue;
        // A folded parent borrows only what needs the user; "working below"
        // is already its own waiting rung.
        const status = rolled(child, seen);
        if (needsYou(status)) statuses.push(status);
      }
      const result = mostUrgent(statuses);
      rolledCache.set(id, result);
      return result;
    };

    return { own: (id) => own.get(id) ?? "idle", rolled: (id) => rolled(id) };
  }, [sessions, runningIds, pending, flagged]);
}
