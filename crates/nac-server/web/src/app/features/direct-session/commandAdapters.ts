import type { QueryClient } from "@tanstack/react-query";

import { runtimeForQueryClient } from "@/app/runtime/nativeRuntime";
import { queryKeys } from "@/app/services/queries/keys";

import type { ManagedSessionSummary, SessionSnapshotResponse } from "@/app/types/api";
import type { stopRun } from "./commandWorkflow";

/** Restore only optimistic objects still owned by this request; keep newer reads/events. */
export function makeStopPorts(client: QueryClient, id: string): Parameters<typeof stopRun>[0] {
  const {
    api,
    stores: {
      runtimeStore: {
        captureRuntimeActivation,
        finishRunCancel,
        requestRunCancel,
        restoreRunCancel,
        runtimeStore,
      },
    },
  } = runtimeForQueryClient(client);
  const current = captureRuntimeActivation(id);
  const snapshotKey = queryKeys.sessionSnapshot(id);
  let runtime: ReturnType<typeof requestRunCancel> | undefined;
  let before: SessionSnapshotResponse | undefined;
  let optimistic: SessionSnapshotResponse | undefined;
  const entries: {
    stats: boolean;
    before: ManagedSessionSummary;
    optimistic: ManagedSessionSummary;
  }[] = [];
  return {
    optimistic: () => {
      if (current()) runtime = requestRunCancel();
      before = client.getQueryData<SessionSnapshotResponse>(snapshotKey);
      optimistic = before?.active_run ? { ...before, active_run: undefined } : before;
      if (optimistic)
        optimistic = client.setQueryData<SessionSnapshotResponse>(snapshotKey, optimistic);
      for (const stats of [false, true]) {
        const previous = client
          .getQueryData<ManagedSessionSummary[]>(queryKeys.sessions(stats))
          ?.find((entry) => entry.summary.session_id === id);
        const list = client.setQueryData<ManagedSessionSummary[]>(
          queryKeys.sessions(stats),
          (list) =>
            list?.map((entry) => {
              if (
                entry.summary.session_id !== id ||
                (!entry.active && entry.active_run === undefined)
              )
                return entry;
              const optimistic = { ...entry, active: false, active_run: undefined };
              return optimistic;
            }),
        );
        const stored = list?.find((entry) => entry.summary.session_id === id);
        if (previous && stored && previous !== stored)
          entries.push({ stats, before: previous, optimistic: stored });
      }
    },
    cancel: () => api.cancelActiveRun(id),
    rollback: () => {
      if (runtime && current() && runtimeStore.getState().cancelArmed) restoreRunCancel(runtime);
      client.setQueryData<SessionSnapshotResponse>(snapshotKey, (latest) =>
        latest === optimistic ? before : latest,
      );
      for (const { stats, before, optimistic } of entries) {
        client.setQueryData<ManagedSessionSummary[]>(queryKeys.sessions(stats), (list) =>
          list?.map((entry) => (entry === optimistic ? before : entry)),
        );
      }
      void client.invalidateQueries({ queryKey: snapshotKey, exact: true });
    },
    settled: () => {
      if (current() && runtimeStore.getState().cancelArmed) finishRunCancel();
      void client.invalidateQueries({ queryKey: snapshotKey, exact: true });
      void client.invalidateQueries({ queryKey: queryKeys.sessionsAll });
    },
  };
}
