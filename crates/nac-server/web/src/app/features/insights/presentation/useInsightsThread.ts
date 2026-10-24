import { useCallback, useEffect, useMemo } from "react";

import {
  useThreadEventLog,
  type ThreadEventLog,
} from "@/app/components/inspector/threads/useThreadEventLog";
import {
  canSteerThread,
  type ThreadRunState,
} from "@/app/components/inspector/threads/useThreadRunState";
import { flattenInsightEntries } from "@/app/features/insights/model/timeline";
import type { InsightTurnSection } from "@/app/features/insights/model/types";
import type { ThreadLogLine } from "@/app/lib/threadLog";
import { dispatchActions } from "@/app/lib/transcript";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { EpisodeSnapshot, SessionSnapshotResponse, ThreadSnapshot } from "@/app/types/api";

export interface InsightsThreadPane {
  thread: ThreadSnapshot;
  action: string;
  episodes: EpisodeSnapshot[];
  liveLog: ThreadLogLine[];
  running: boolean;
  canSteer: boolean;
  eventLog: ThreadEventLog;
}

/**
 * Stand-in for a thread the stream has announced but the store has not
 * written yet, so the detail opens on the name that was picked.
 */
function pendingThread(name: string, sessionId: string): ThreadSnapshot {
  return {
    name,
    session_id: sessionId,
    created_at: "",
    updated_at: "",
    episode_count: 0,
    latest_action: null,
  };
}

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

/**
 * The phone dialog title names only a picked thread and shimmers from the
 * layout store, so only a picked thread mirrors whether it runs there.
 */
export function useInsightsThreadPane(
  snapshot: SessionSnapshotResponse | null,
  name: string | null,
  picked: boolean,
  { liveThreads, runningNames }: ThreadRunState,
  canSteerWorkers: boolean,
): InsightsThreadPane | null {
  const { setSelectedThreadRunning } = useNativeRuntime().stores.sessionLayoutStore;
  const messages = snapshot?.messages;
  const actions = useMemo(() => dispatchActions(messages ?? []), [messages]);
  const eventLog = useThreadEventLog(snapshot, name);
  const running = Boolean(name && runningNames.has(name));
  const titleRunning = picked && running;

  useEffect(() => {
    setSelectedThreadRunning(titleRunning);
    return () => setSelectedThreadRunning(false);
  }, [titleRunning, setSelectedThreadRunning]);

  if (!snapshot || !name) return null;
  const thread =
    snapshot.threads.find((candidate) => candidate.name === name) ??
    pendingThread(name, snapshot.metadata.session_id ?? "");
  const live = liveThreads[name];
  return {
    thread,
    action: actions[name] || thread.latest_action || "",
    episodes: snapshot.thread_episodes?.[name] ?? [],
    liveLog: live?.log ?? [],
    running,
    canSteer: canSteerThread(canSteerWorkers, live),
    eventLog,
  };
}
