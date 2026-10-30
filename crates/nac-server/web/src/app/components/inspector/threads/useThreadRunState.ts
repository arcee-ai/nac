import { useMemo } from "react";

import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { RuntimeThread } from "@/app/store/runtimeStore";

import type { SessionSnapshotResponse } from "@/app/types/api";

export interface ThreadRunState {
  liveThreads: Record<string, RuntimeThread>;
  /** Also holds active snapshot names while the stream is still settling. */
  runningNames: ReadonlySet<string>;
}

/**
 * Which of a session's threads run, merged from the snapshot's active names
 * and the live stream.
 */
export function useThreadRunState(snapshot: SessionSnapshotResponse | null): ThreadRunState {
  const { useStreamStatus, useLiveThreads } = useNativeRuntime().stores.runtimeStore;

  const liveThreads = useLiveThreads();
  const streamStatus = useStreamStatus();
  const activeThreads = snapshot?.active_threads;
  // Switching tabs resets live thread state before SSE catches up. Until then
  // every `active_threads` name would look pending, so a running thread's
  // detail would flash as stopped.
  const streamSettling = streamStatus === "connecting" || streamStatus === "reconnecting";

  // Backend pre-marks every name in a DAG batch as active. Only
  // `thread_started` means the worker is actually running; the rest are
  // pending on in-batch deps. While the stream is still catching up, treat
  // those names as running.
  const runningNames = useMemo(() => {
    const running = new Set<string>();
    for (const name of activeThreads ?? []) {
      const status = liveThreads[name]?.status;
      // A finished name stays out until the snapshot drops it.
      if (status === "running" || (status !== "finished" && streamSettling)) running.add(name);
    }
    for (const [name, thread] of Object.entries(liveThreads)) {
      if (thread.status === "running") running.add(name);
      else if (thread.status === "finished") running.delete(name);
    }
    return running;
  }, [activeThreads, liveThreads, streamSettling]);

  return { liveThreads, runningNames };
}

/**
 * `runningNames` deliberately treats active snapshot entries as running
 * while SSE reconnects so the thread detail does not flash pending.
 * Steering is a capability boundary, however, and must wait for the live
 * `thread_started` state so a pending or just-finished worker never gains an
 * actionable control during that approximation window.
 */
export function canSteerThread(canSteerWorkers: boolean, live: RuntimeThread | undefined): boolean {
  return canSteerWorkers && live?.status === "running";
}
