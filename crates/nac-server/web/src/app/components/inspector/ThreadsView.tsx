import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useEffect, useMemo, useState } from "react";

import {
  Button,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Loader,
  LoaderSize,
  LoaderVariant,
} from "@/app/atoms";
import { usePagedRows } from "@/app/hooks/usePagedRows";
import {
  PanelEmpty,
  PanelLoading,
  PanelRow,
  PanelSplit,
} from "@/app/components/inspector/PanelSplit";
import { TaskButton } from "@/app/components/inspector/TaskPreview";
import { ThreadSteeringModal } from "@/app/components/inspector/ThreadSteeringModal";
import { ThreadDetail } from "@/app/components/inspector/threads/ThreadDetail";
import {
  ThreadViewSelect,
  type ThreadDetailView,
} from "@/app/components/inspector/threads/ThreadViewControls";
import { cn } from "@/app/lib/cn";
import { mergeThreadEventPages } from "@/app/lib/threadLog";
import {
  cancelledThreadNames,
  dispatchActions,
  dispatchThreadName,
  partitionThreadCalls,
} from "@/app/lib/transcript";
import { useThreadEventPages } from "@/app/services/queries";
import { type RuntimeThread } from "@/app/store/runtimeStore";

import type { SessionSnapshotResponse, ThreadSnapshot, ToolCall } from "@/app/types/api";

/**
 * Whether this session actually named the thread. A leftover selectedThread
 * from another session (or from a live row that has since vanished) is not
 * enough — that used to inject a ghost list row that disappeared on click.
 */
function sessionOwnsThreadName(
  snapshot: SessionSnapshotResponse | null | undefined,
  dispatchedNames: Set<string>,
  liveThreads: Record<string, RuntimeThread>,
  name: string,
): boolean {
  if (!name) return false;
  if (dispatchedNames.has(name)) return true;
  if (liveThreads[name]) return true;
  if (!snapshot) return false;
  if (snapshot.threads.some((thread) => thread.name === name)) return true;
  if (Object.hasOwn(snapshot.thread_episodes, name)) return true;
  return (snapshot.active_threads ?? []).includes(name);
}

function logThreadList(payload: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  console.debug("[nac:threads]", payload);
  const bag = globalThis as { __nacThreadLogs?: Record<string, unknown>[] };
  const logs = (bag.__nacThreadLogs ??= []);
  logs.push(payload);
  if (logs.length > 80) logs.splice(0, logs.length - 80);
}

/**
 * Stand-in row for a thread the stream has announced but the store has not
 * written yet, so a card clicked in the chat lands on the thread it names
 * rather than on whichever one happens to be first.
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

/** Later DAG waves rank higher so they sort to the top of the list. */
function waveRankByName(
  messages: SessionSnapshotResponse["messages"] | undefined,
): Map<string, number> {
  const ranks = new Map<string, number>();
  if (!messages?.length) return ranks;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const calls = (message.tool_calls ?? []).filter(
      (call): call is ToolCall => call.function?.name === "thread",
    );
    if (!calls.length) continue;
    partitionThreadCalls(calls).forEach((level, waveIndex) => {
      for (const call of level) {
        ranks.set(dispatchThreadName(call), waveIndex);
      }
    });
    break;
  }
  return ranks;
}

type ListKind = "pending" | "running" | "done";

const LIST_KIND_ORDER = {
  // Last to execute (queued on deps) above currently running, done last.
  pending: 0,
  running: 1,
  done: 2,
} satisfies Record<ListKind, number>;

/**
 * Retained workstreams and their episodes, merged with the live SSE state so a
 * running thread shows the commands it is issuing before any episode is
 * persisted — and before the thread itself has a row in the store.
 */
export function ThreadsView({
  snapshot,
  selected,
  onSelect,
  canSteerWorkers,
}: {
  snapshot: SessionSnapshotResponse | null;
  /** Thread the chat pointed at, if any. */
  selected: string | null;
  onSelect: (name: string) => void;
  /** True only for the user-owned primary classic orchestrator transcript. */
  canSteerWorkers: boolean;
}) {
  const { setSelectedThreadRunning } = useNativeRuntime().stores.sessionLayoutStore;

  const { useStreamStatus, useLiveThreads } = useNativeRuntime().stores.runtimeStore;

  const liveThreads = useLiveThreads();
  const streamStatus = useStreamStatus();
  const [view, setView] = useState<ThreadDetailView>("log");
  const [steeringThread, setSteeringThread] = useState<string | null>(null);
  const threads = useMemo(() => snapshot?.threads ?? [], [snapshot]);
  const activeThreads = snapshot?.active_threads;
  const sessionId = snapshot?.metadata.session_id ?? "";
  const waveRank = useMemo(() => waveRankByName(snapshot?.messages), [snapshot?.messages]);
  const actions = useMemo(() => dispatchActions(snapshot?.messages ?? []), [snapshot?.messages]);
  const cancelledNames = useMemo(
    () => cancelledThreadNames(snapshot?.messages ?? []),
    [snapshot?.messages],
  );
  // A cancelled dispatch never writes an episode, and `threads` is keyed off
  // episodes. Names belong on the list when the chat still has the card (or
  // the worker is live). `thread_events` keys are not enough: a reverted or
  // superseded first run can leave hundreds of events with no matching
  // tool_call, which used to inject a ghost row that vanished on click.
  const dispatchedNames = useMemo(() => {
    const names = new Set<string>();
    for (const message of snapshot?.messages ?? []) {
      if (message.role !== "assistant") continue;
      for (const call of message.tool_calls ?? []) {
        if (call.function?.name !== "thread") continue;
        names.add(dispatchThreadName(call));
      }
    }
    return names;
  }, [snapshot?.messages]);
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

  const ordered = useMemo(() => {
    const persisted = new Set(threads.map((thread) => thread.name));
    // Names the snapshot never retained (cancelled before an episode, or still
    // in-flight) still belong on the list: the chat already named them.
    const extras = new Set<string>();
    for (const name of dispatchedNames) {
      if (!persisted.has(name)) extras.add(name);
    }
    // A click on the chat card selects a name that is not in thread_events
    // yet. Keep that name on the list so the click lands — but only when this
    // session actually named it. A leftover selectedThread from another
    // session used to be injected here as a ghost row (0 episodes, no
    // commands) that disappeared the moment you clicked a real thread.
    if (
      selected &&
      !persisted.has(selected) &&
      sessionOwnsThreadName(snapshot, dispatchedNames, liveThreads, selected)
    ) {
      extras.add(selected);
    }
    for (const name of runningNames) {
      if (!persisted.has(name)) extras.add(name);
    }
    for (const name of pendingNames) {
      if (!persisted.has(name)) extras.add(name);
    }
    for (const [name, thread] of Object.entries(liveThreads)) {
      if (thread.status === "finished" && !persisted.has(name)) {
        extras.add(name);
      }
    }
    const rows = [...threads, ...[...extras].map((name) => pendingThread(name, sessionId))];
    const kindOf = (name: string): ListKind => {
      if (pendingNames.has(name)) return "pending";
      if (runningNames.has(name)) return "running";
      return "done";
    };
    // Stable sort: later DAG waves (and pending) float up; done sinks.
    return rows.sort((a, b) => {
      const kindDiff = LIST_KIND_ORDER[kindOf(a.name)] - LIST_KIND_ORDER[kindOf(b.name)];
      if (kindDiff !== 0) return kindDiff;
      const rankDiff = (waveRank.get(b.name) ?? -1) - (waveRank.get(a.name) ?? -1);
      if (rankDiff !== 0) return rankDiff;
      return 0;
    });
  }, [
    threads,
    dispatchedNames,
    selected,
    runningNames,
    pendingNames,
    liveThreads,
    sessionId,
    snapshot,
    waveRank,
  ]);

  const selectable = useMemo(
    () => ordered.filter((thread) => !pendingNames.has(thread.name)),
    [ordered, pendingNames],
  );
  // Pending rows stay unclickable, but the detail pane still has to name one
  // when the list is not empty — otherwise a reconnect flash shows the empty
  // copy next to a list that already has threads.
  const current =
    ordered.find((thread) => thread.name === selected) ?? selectable[0] ?? ordered[0] ?? null;
  // A session that fanned out into hundreds of workstreams would otherwise lay
  // every row out at once, on a panel where only the first screen is ever read.
  // The thread opened from a message keeps its row whatever the reader has
  // scrolled to, so the list still shows what the detail pane is about.
  const currentRow = current ? ordered.findIndex((thread) => thread.name === current.name) : -1;
  const { visible, hasMore, sentinelRef } = usePagedRows(ordered, {
    key: sessionId,
    atLeast: currentRow + 1,
  });
  const live = current ? liveThreads[current.name] : undefined;
  const currentAction = current ? actions[current.name] || current.latest_action || "" : "";

  // Keep the layout store on the thread the detail pane is showing, so the
  // phone dialog header names that thread instead of the panel label.
  const currentName = current?.name ?? null;
  const currentRunning = Boolean(currentName && runningNames.has(currentName));
  // `runningNames` deliberately treats active snapshot entries as running
  // while SSE reconnects so the list and detail pane do not flash pending.
  // Steering is a capability boundary, however, and must wait for the live
  // `thread_started` state so a pending or just-finished worker never gains an
  // actionable control during that approximation window.
  const canSteerCurrent = canSteerWorkers && live?.status === "running";
  const eventPages = useThreadEventPages(snapshot ? sessionId : null, currentName);
  const pagedEvents = useMemo(
    () => (eventPages.data ? mergeThreadEventPages(eventPages.data.pages) : undefined),
    [eventPages.data],
  );
  useEffect(() => {
    if (!currentName) return;
    if (selected === currentName) return;
    if (selected && ordered.some((thread) => thread.name === selected)) return;
    onSelect(currentName);
  }, [selected, currentName, ordered, onSelect]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const persisted = threads.map((thread) => thread.name);
    const extras = ordered
      .filter((thread) => !persisted.includes(thread.name))
      .map((thread) => thread.name);
    const eventKeys = Object.keys(snapshot?.thread_events ?? {});
    const orphanEvents = eventKeys.filter(
      (name) =>
        !dispatchedNames.has(name) &&
        !persisted.includes(name) &&
        !liveThreads[name] &&
        !(snapshot?.active_threads ?? []).includes(name),
    );
    const droppedGhost =
      selected && !sessionOwnsThreadName(snapshot, dispatchedNames, liveThreads, selected)
        ? selected
        : null;
    if (!droppedGhost && extras.length === 0 && orphanEvents.length === 0) return;
    logThreadList({
      session: sessionId,
      selected,
      droppedGhost,
      extras,
      orphanEvents,
      dispatched: [...dispatchedNames],
      persisted,
      eventKeys,
      live: Object.keys(liveThreads),
      active: snapshot?.active_threads ?? [],
      listed: ordered.map((thread) => thread.name),
    });
  }, [selected, ordered, dispatchedNames, liveThreads, snapshot, sessionId, threads]);

  // Same running bit the detail pane uses — the dialog title shimmer reads it.
  useEffect(() => {
    setSelectedThreadRunning(currentRunning);
    return () => setSelectedThreadRunning(false);
  }, [currentRunning, setSelectedThreadRunning]);

  if (!snapshot) return <PanelLoading listTitle="Threads" />;

  return (
    <>
      <PanelSplit
        listTitle="Threads"
        title={current?.name}
        titleAction={currentAction ? <TaskButton action={currentAction} /> : null}
        actions={
          current ? (
            <div className="flex items-center gap-2">
              {canSteerCurrent ? (
                <Button
                  size={ButtonSize.Small}
                  variant={ButtonVariant.Secondary}
                  onClick={() => setSteeringThread(current.name)}
                >
                  Steer
                </Button>
              ) : null}
              <ThreadViewSelect view={view} onChange={setView} />
            </div>
          ) : null
        }
        list={
          ordered.length === 0 ? (
            <div className="flex flex-col px-2 pb-4 pt-2 text-micro">
              <p className="text-basic-tertiary">No threads yet.</p>
              <p className="text-basic-muted">Start a conversation to create one.</p>
            </div>
          ) : (
            <>
              {visible.map((thread) => {
                const pending = pendingNames.has(thread.name);
                const running = runningNames.has(thread.name);
                const live = liveThreads[thread.name];
                const lastEpisode = snapshot.thread_episodes?.[thread.name]?.at(-1);
                const episodeCount =
                  snapshot.thread_episodes?.[thread.name]?.length ?? thread.episode_count;
                const cancelled =
                  Boolean(live?.cancelled) ||
                  cancelledNames.has(thread.name) ||
                  lastEpisode?.status === "cancelled" ||
                  (!running && !pending && episodeCount === 0);
                const errored = live?.isError;
                // The task is the only description a thread has, so the row hands
                // it over on hover rather than making the name stand for it.
                const task = actions[thread.name] || thread.latest_action || "";
                return (
                  <PanelRow
                    key={thread.name}
                    label={thread.name}
                    active={thread.name === current?.name}
                    disabled={pending}
                    title={pending ? "Waiting on source threads" : task || undefined}
                    icon={
                      pending ? (
                        <Icon
                          iconName={IconName.Timelaps}
                          size={16}
                          className="shrink-0 [&>path]:!fill-basic-muted"
                        />
                      ) : running ? (
                        <Loader size={LoaderSize.XSmall} variant={LoaderVariant.Neutral} />
                      ) : cancelled ? (
                        <Icon
                          iconName={IconName.Close}
                          size={16}
                          className="shrink-0 [&>path]:!fill-basic-muted"
                        />
                      ) : (
                        <Icon
                          iconName={errored ? IconName.Danger : IconName.CheckCircle}
                          size={16}
                          className={cn("shrink-0", errored && "text-error-primary")}
                        />
                      )
                    }
                    trailing={
                      <span className="code code-micro text-basic-muted shrink-0">
                        {snapshot.thread_episodes?.[thread.name]?.length ?? thread.episode_count}
                      </span>
                    }
                    onClick={() => onSelect(thread.name)}
                  />
                );
              })}
              {hasMore ? <div ref={sentinelRef} aria-hidden className="h-px" /> : null}
            </>
          )
        }
      >
        {current ? (
          <ThreadDetail
            key={`${sessionId}:${current.name}`}
            thread={current}
            action={currentAction}
            episodes={snapshot.thread_episodes?.[current.name] ?? []}
            events={pagedEvents ?? snapshot.thread_events?.[current.name]}
            liveLog={live?.log ?? []}
            running={runningNames.has(current.name)}
            hasOlder={Boolean(eventPages.hasNextPage)}
            loadingOlder={eventPages.isFetchingNextPage}
            loadingInitial={eventPages.isPending}
            historyError={eventPages.error instanceof Error ? eventPages.error.message : null}
            onLoadOlder={async () => {
              await eventPages.fetchNextPage();
            }}
            onRetry={async () => {
              if (eventPages.data) await eventPages.fetchNextPage();
              else await eventPages.refetch();
            }}
            view={view}
            canSteer={canSteerCurrent}
            onSteer={() => setSteeringThread(current.name)}
            onViewChange={setView}
          />
        ) : (
          <PanelEmpty title="No thread selected">
            Threads contain conversations, command output, and file changes for each task. Select a
            thread to view its details.
          </PanelEmpty>
        )}
      </PanelSplit>
      {steeringThread ? (
        <ThreadSteeringModal
          sessionId={sessionId}
          threadName={steeringThread}
          onClose={() => setSteeringThread(null)}
        />
      ) : null}
    </>
  );
}
