import { useMemo } from "react";

import { Icon, IconName, Loader, LoaderSize, LoaderVariant } from "@/app/atoms";
import {
  PanelEmpty,
  PanelRow,
  PanelSplit,
} from "@/app/components/inspector/PanelSplit";
import { cn } from "@/app/lib/cn";
import { useLiveThreads } from "@/app/store/runtimeStore";
import type {
  EpisodeSnapshot,
  SessionSnapshotResponse,
  ThreadSnapshot,
} from "@/app/types/api";

function Detail({
  thread,
  episodes,
  running,
  currentAction,
}: {
  thread: ThreadSnapshot;
  episodes: EpisodeSnapshot[];
  running: boolean;
  currentAction: string;
}) {
  return (
    <>
      <div className="flex items-center gap-[10px] h-10 px-4 shrink-0 border-b border-muted bg-elevation-level-1">
        <span className="label-micro text-btn-secondary truncate">{thread.name}</span>
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

      <div className="flex flex-col flex-1 min-h-0 overflow-auto p-4 code code-small text-basic-secondary whitespace-pre-wrap [&>*]:shrink-0">
        <p className="text-basic-primary">
          {`Thread "${thread.name}" retained episodes (${episodes.length} total):`}
        </p>
        {running && currentAction ? (
          <p className="pt-4 text-shimmer-basic">{`▸ ${currentAction}`}</p>
        ) : null}
        {episodes.length === 0 && !running ? (
          <p className="pt-4 text-basic-muted">No episodes retained.</p>
        ) : null}
        {episodes.map((episode, index) => (
          <div key={episode.id} className="pt-4">
            <p className="text-basic-tertiary">
              {`=== Episode ${index + 1} | ${episode.created_at} | action: ${episode.action} ===`}
            </p>
            <p>{episode.content}</p>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * Retained workstreams and their episodes, merged with the live SSE state so a
 * running thread shows its current operation before any episode is persisted.
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

  const runningNames = useMemo(() => {
    const names = new Set(activeThreads ?? []);
    for (const [name, thread] of Object.entries(liveThreads)) {
      if (thread.status === "running") names.add(name);
      else names.delete(name);
    }
    return names;
  }, [activeThreads, liveThreads]);

  const ordered = useMemo(
    () =>
      threads
        .slice()
        .sort(
          (a, b) =>
            Number(runningNames.has(b.name)) - Number(runningNames.has(a.name)),
        ),
    [threads, runningNames],
  );

  if (!snapshot) return <PanelEmpty>Loading…</PanelEmpty>;
  if (ordered.length === 0) {
    return <PanelEmpty>No threads yet for this session.</PanelEmpty>;
  }

  const current = ordered.find((thread) => thread.name === selected) ?? ordered[0];
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
                <Loader size={LoaderSize.Micro} variant={LoaderVariant.Neutral} />
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
        running={runningNames.has(current.name)}
        currentAction={live?.action || current.latest_action || ""}
      />
    </PanelSplit>
  );
}
