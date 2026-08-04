import { useEffect, useMemo, useRef } from "react";

import { Icon, IconName, Loader, LoaderSize, LoaderVariant } from "@/app/atoms";
import {
  PanelEmpty,
  PanelRow,
  PanelSplit,
} from "@/app/components/inspector/PanelSplit";
import { cn } from "@/app/lib/cn";
import { Markdown } from "@/app/lib/markdown";
import {
  STICK_TOLERANCE_PX,
  distanceFromBottom,
  scrollToBottomInstantly,
} from "@/app/lib/scroll";
import {
  mergeThreadLog,
  persistedThreadLog,
  type ThreadLogLine,
} from "@/app/lib/threadLog";
import { useLiveThreads } from "@/app/store/runtimeStore";
import type {
  AgentEvent,
  EpisodeSnapshot,
  SessionSnapshotResponse,
  ThreadSnapshot,
} from "@/app/types/api";

/** Height the log gives up once there are episodes to leave room for. */
const LOG_WITH_EPISODES = "shrink-0 max-h-[220px]";

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

/**
 * Everything the thread has run, oldest first, followed by the operation it is
 * on right now. The view follows the bottom edge the way `tail -f` does and
 * lets go as soon as the user scrolls back to read something.
 */
function LogTail({
  name,
  lines,
  action,
  running,
  className,
}: {
  name: string;
  lines: ThreadLogLine[];
  action: string;
  running: boolean;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // A ref rather than state: nothing renders differently for it, and the scroll
  // handler has to see the current value without waiting for a re-render.
  const stuck = useRef(true);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stuck.current) return;
    scrollToBottomInstantly(element);
  }, [lines.length, action]);

  return (
    <div
      ref={scrollRef}
      className={cn("flex flex-col min-h-0 overflow-auto p-4 [&>*]:shrink-0", className)}
      onScroll={() => {
        const element = scrollRef.current;
        if (element) {
          stuck.current = distanceFromBottom(element) <= STICK_TOLERANCE_PX;
        }
      }}
    >
      <p className="code code-small text-info-primary">
        {`Thread "${name}" command log (${lines.length} total):`}
      </p>
      {lines.map((line) => (
        <p
          key={line.key}
          className={cn(
            "pt-1 code code-small whitespace-pre-wrap break-words",
            line.isError ? "text-error-primary" : "text-basic-secondary",
          )}
        >
          {line.text}
        </p>
      ))}
      {running && action ? (
        <p className="pt-1 code code-small text-shimmer-basic">{`▸ ${action}`}</p>
      ) : null}
      {!lines.length && !running ? (
        <p className="pt-4 code code-small text-basic-muted">
          No commands recorded.
        </p>
      ) : null}
    </div>
  );
}

function Detail({
  thread,
  episodes,
  events,
  liveLog,
  running,
  currentAction,
}: {
  thread: ThreadSnapshot;
  episodes: EpisodeSnapshot[];
  /** Commands the store has persisted for this thread. */
  events: AgentEvent[] | undefined;
  /** The same commands as the stream reported them, plus whatever came after. */
  liveLog: ThreadLogLine[];
  running: boolean;
  currentAction: string;
}) {
  const log = useMemo(
    () => mergeThreadLog(persistedThreadLog(events), liveLog),
    [events, liveLog],
  );

  return (
    <>
      <div className="flex items-center gap-[10px] h-10 px-4 shrink-0 border-b border-muted bg-elevation-level-1">
        <span className="label-micro text-btn-secondary truncate">
          {thread.name}
        </span>
        {running ? (
          <Loader size={LoaderSize.Micro} variant={LoaderVariant.Neutral} />
        ) : null}
        <span className="flex-1 min-w-0 code code-small text-basic-muted truncate">
          {thread.updated_at}
        </span>
        <span className="shrink-0 code code-small text-basic-muted">
          {thread.episode_count} ep
        </span>
      </div>

      <LogTail
        name={thread.name}
        lines={log}
        action={currentAction}
        running={running}
        className={episodes.length ? LOG_WITH_EPISODES : "flex-1"}
      />

      {episodes.length ? (
        <div className="flex flex-col flex-1 min-h-0 overflow-auto p-4 border-t border-muted [&>*]:shrink-0">
          <p className="code code-small text-info-primary">
            {`Thread "${thread.name}" retained episodes (${episodes.length} total):`}
          </p>
          {episodes.map((episode, index) => (
            <div key={episode.id} className="pt-4 flex flex-col gap-2">
              <p className="code code-small text-info-primary opacity-75">
                {`=== Episode ${index + 1} | ${episode.created_at} | action: ${episode.action} ===`}
              </p>
              <div className="p-6 mt-8 rounded-[8px] bg-elevation-level-1 shadow-convex">
                <Markdown className="text-basic-secondary">
                  {episode.content}
                </Markdown>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

/**
 * Retained workstreams and their episodes, merged with the live SSE state so a
 * running thread shows the commands it is issuing before any episode is
 * persisted — and before the thread itself has a row in the store.
 */
export function ThreadsView({
  snapshot,
  selected,
  onSelect,
}: {
  snapshot: SessionSnapshotResponse | null;
  /** Thread the chat pointed at, if any. */
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  const liveThreads = useLiveThreads();
  const threads = useMemo(() => snapshot?.threads ?? [], [snapshot]);
  const activeThreads = snapshot?.active_threads;
  const sessionId = snapshot?.metadata.session_id ?? "";

  const runningNames = useMemo(() => {
    const names = new Set(activeThreads ?? []);
    for (const [name, thread] of Object.entries(liveThreads)) {
      if (thread.status === "running") names.add(name);
      else names.delete(name);
    }
    return names;
  }, [activeThreads, liveThreads]);

  const ordered = useMemo(() => {
    const persisted = new Set(threads.map((thread) => thread.name));
    const rows = [
      ...threads,
      ...[...runningNames]
        .filter((name) => !persisted.has(name))
        .map((name) => pendingThread(name, sessionId)),
    ];
    // Sorting is stable, so this only lifts the running threads to the top and
    // otherwise leaves the store's order alone.
    return rows.sort(
      (a, b) =>
        Number(runningNames.has(b.name)) - Number(runningNames.has(a.name)),
    );
  }, [threads, runningNames, sessionId]);

  if (!snapshot) return <PanelEmpty>Loading…</PanelEmpty>;
  if (ordered.length === 0) {
    return <PanelEmpty>No threads yet for this session.</PanelEmpty>;
  }

  const current =
    ordered.find((thread) => thread.name === selected) ?? ordered[0];
  const live = liveThreads[current.name];

  return (
    <PanelSplit
      list={ordered.map((thread) => {
        const running = runningNames.has(thread.name);
        const errored = liveThreads[thread.name]?.isError;
        return (
          <PanelRow
            key={thread.name}
            label={thread.name}
            active={thread.name === current.name}
            icon={
              running ? (
                <Loader
                  size={LoaderSize.Micro}
                  variant={LoaderVariant.Neutral}
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
                {thread.episode_count}
              </span>
            }
            onClick={() => onSelect(thread.name)}
          />
        );
      })}
    >
      <Detail
        thread={current}
        episodes={snapshot.thread_episodes?.[current.name] ?? []}
        events={snapshot.thread_events?.[current.name]}
        liveLog={live?.log ?? []}
        running={runningNames.has(current.name)}
        currentAction={live?.action || current.latest_action || ""}
      />
    </PanelSplit>
  );
}
