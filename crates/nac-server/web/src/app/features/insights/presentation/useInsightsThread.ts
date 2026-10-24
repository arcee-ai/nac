import { useCallback, useMemo } from "react";

import type { ThreadRunState } from "@/app/components/inspector/threads/useThreadRunState";
import { flattenInsightEntries } from "@/app/features/insights/model/timeline";
import type { InsightTurnSection } from "@/app/features/insights/model/types";
import type { SessionSnapshotResponse } from "@/app/types/api";

/**
 * Whether this session named the thread. A thread picked in another session
 * stays in the layout store and must not open here.
 */
export function useThreadOwnership(
  snapshot: SessionSnapshotResponse | null,
  timeline: readonly InsightTurnSection[],
  liveThreads: ThreadRunState["liveThreads"],
): (name: string) => boolean {
  const dispatched = useMemo(
    () =>
      new Set(
        flattenInsightEntries(timeline).flatMap((entry) =>
          entry.kind === "thread" ? [entry.thread.name] : [],
        ),
      ),
    [timeline],
  );
  return useCallback(
    (name) => {
      if (dispatched.has(name) || liveThreads[name]) return true;
      if (!snapshot) return false;
      return (
        snapshot.threads.some((thread) => thread.name === name) ||
        Object.hasOwn(snapshot.thread_episodes, name) ||
        (snapshot.active_threads ?? []).includes(name)
      );
    },
    [dispatched, liveThreads, snapshot],
  );
}
