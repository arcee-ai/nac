import { useMemo } from "react";

import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { RuntimeThread } from "@/app/store/runtimeStore";

import type { SessionSnapshotResponse } from "@/app/types/api";

export interface ThreadRunState {
  liveThreads: Record<string, RuntimeThread>;
  /** Also holds active snapshot names while the stream is still settling. */
  runningNames: ReadonlySet<string>;
  /** Active names still waiting on in-batch dependencies. */
  pendingNames: ReadonlySet<string>;
}

/**
 * Which of a session's threads run and which wait on their sources, merged
 * from the snapshot's active names and the live stream.
 */
export function useThreadRunState(snapshot: SessionSnapshotResponse | null): ThreadRunState {
  const { useStreamStatus, useLiveThreads } = useNativeRuntime().stores.runtimeStore;

  const liveThreads = useLiveThreads();
  const streamStatus = useStreamStatus();
  const activeThreads = snapshot?.active_threads;
  // Switching tabs resets live thread state before SSE catches up. Until then
  // every `active_threads` name would look pending and the detail pane would
  // claim nothing is selected even though the list already has rows.
  const streamSettling = streamStatus === "connecting" || streamStatus === "reconnecting";

  // Backend pre-marks every name in a DAG batch as active. Only
  // `thread_started` means the worker is actually running; the rest are
  // pending on in-batch deps. While the stream is still catching up, treat
  // those names as running so the pane stays on a real thread.
  const { runningNames, pendingNames } = useMemo(() => {
    const running = new Set<string>();
    const pending = new Set<string>();
    for (const name of activeThreads ?? []) {
      const live = liveThreads[name];
      if (live?.status === "running") running.add(name);
      else if (live?.status === "finished") {
        // Stay out of both sets until the snapshot drops the name.
      } else if (streamSettling) {
        running.add(name);
      } else pending.add(name);
    }
    for (const [name, thread] of Object.entries(liveThreads)) {
      if (thread.status === "running") {
        running.add(name);
        pending.delete(name);
      } else if (thread.status === "finished") {
        running.delete(name);
        pending.delete(name);
      }
    }
    return { runningNames: running, pendingNames: pending };
  }, [activeThreads, liveThreads, streamSettling]);

  return { liveThreads, runningNames, pendingNames };
}

/**
 * `runningNames` deliberately treats active snapshot entries as running
 * while SSE reconnects so the list and detail pane do not flash pending.
 * Steering is a capability boundary, however, and must wait for the live
 * `thread_started` state so a pending or just-finished worker never gains an
 * actionable control during that approximation window.
 */
export function canSteerThread(canSteerWorkers: boolean, live: RuntimeThread | undefined): boolean {
  return canSteerWorkers && live?.status === "running";
}
