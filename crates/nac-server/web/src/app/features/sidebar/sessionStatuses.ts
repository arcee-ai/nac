import { useMemo } from "react";

import { isActiveRun } from "@/app/lib/format";
import { mostUrgent, needsYou, sessionStatus, type SessionStatus } from "@/app/lib/sessionStatus";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useInbox } from "@/app/features/inbox/inboxContext";
import type { ManagedSessionSummary } from "@/app/types/api";

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
  // Pending decisions and unseen failures come from the one fleet attention
  // feed (no per-session polling).
  const { attention, model } = useInbox();
  const failedUnseen = useMemo(
    () => new Set(model.failed.map((row) => row.sessionId)),
    [model.failed],
  );
  const doneUnseen = useMemo(() => new Set(model.done.map((row) => row.sessionId)), [model.done]);

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
      const pending = attention.get(id)?.pending ?? [];
      own.set(
        id,
        sessionStatus({
          pendingPermissions: pending.filter((item) => item.kind !== "question").length,
          pendingQuestions: pending.filter((item) => item.kind === "question").length,
          failedUnseen: failedUnseen.has(id),
          running: running.has(id),
          childrenRunning: descendantsRunning(id),
          attention: Boolean(flagged[id]) || doneUnseen.has(id),
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
  }, [sessions, runningIds, attention, failedUnseen, doneUnseen, flagged]);
}
