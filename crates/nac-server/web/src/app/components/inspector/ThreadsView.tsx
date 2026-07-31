import { Fragment, useMemo, useState } from "react";

import { Badge, BadgeColor, Icon, IconName, Loader, LoaderSize } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { Markdown } from "@/app/lib/markdown";
import { useLiveThreads } from "@/app/store/runtimeStore";
import type { RuntimeThread } from "@/app/store/runtimeStore";
import type {
  EpisodeSnapshot,
  SessionSnapshotResponse,
  ThreadSnapshot,
} from "@/app/types/api";

function Episode({ episode }: { episode: EpisodeSnapshot }) {
  return (
    <div className="rounded-lg border border-secondary bg-elevation-level-0-5 p-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="label-small text-basic-primary truncate">
          {episode.action || "(action)"}
        </span>
        <span className="text-micro text-basic-muted font-mono shrink-0">
          #{episode.id} · {episode.created_at}
        </span>
      </div>
      <div className="markdown paragraph-medium text-basic-secondary">
        <Markdown>{episode.content}</Markdown>
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  episodes,
  live,
  running,
}: {
  thread: ThreadSnapshot;
  episodes: EpisodeSnapshot[];
  live: RuntimeThread | undefined;
  running: boolean;
}) {
  const [open, setOpen] = useState(false);
  // The current operation prefers the live SSE action over the persisted one.
  const currentOp = live?.action || thread.latest_action || "";
  const exitCode = live?.exitCode;

  return (
    <div
      className={cn(
        "rounded-xl border bg-elevation-level-1",
        running ? "border-success-muted" : "border-secondary",
      )}
    >
      <button
        type="button"
        className="w-full flex items-center gap-2 p-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon
          iconName={IconName.Down}
          className={cn("transition-transform", open ? "rotate-0" : "-rotate-90")}
        />
        <span className="label-small text-basic-primary truncate flex-grow">
          {thread.name}
        </span>
        {running ? <Loader size={LoaderSize.Small} /> : null}
        {running ? <Badge text="running" color={BadgeColor.Green} /> : null}
        {exitCode != null ? (
          <Badge
            text={`exit ${exitCode}`}
            color={live?.isError ? BadgeColor.Red : BadgeColor.Gray}
          />
        ) : null}
        <Badge text={`${thread.episode_count} ep`} color={BadgeColor.Gray} />
      </button>

      {currentOp && !open ? (
        <div className="px-3 pb-3 -mt-1 text-micro text-basic-muted truncate font-mono">
          {currentOp}
        </div>
      ) : null}

      {open ? (
        <div className="px-3 pb-3 flex flex-col gap-2">
          {live?.action ? (
            <div className="text-micro text-basic-muted font-mono">▸ {live.action}</div>
          ) : null}
          {episodes.length === 0 ? (
            <div className="text-basic-muted text-micro">No episodes retained.</div>
          ) : (
            episodes.map((episode) => <Episode key={episode.id} episode={episode} />)
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Retained workstreams and their episodes, merged with live SSE state (running
 * status, current operation, exit code). Running threads are shown first.
 */
export function ThreadsView({ snapshot }: { snapshot: SessionSnapshotResponse | null }) {
  const liveThreads = useLiveThreads();
  const threads = useMemo(() => snapshot?.threads ?? [], [snapshot]);
  const episodes = snapshot?.thread_episodes ?? {};
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

  if (!snapshot) {
    return <div className="p-6 text-basic-muted label-small">Loading…</div>;
  }
  if (threads.length === 0) {
    return (
      <div className="p-6 text-basic-muted label-small">
        No threads yet for this session.
      </div>
    );
  }

  const runningCount = ordered.filter((t) => runningNames.has(t.name)).length;

  return (
    <div className="h-full overflow-auto p-4 flex flex-col gap-3 [&>*]:shrink-0">
      {runningCount > 0 ? (
        <div className="tag-label text-basic-muted">Running ({runningCount})</div>
      ) : null}
      {ordered.map((thread, index) => {
        const running = runningNames.has(thread.name);
        const showFinishedHeader = runningCount > 0 && index === runningCount;
        // A fragment keeps the rows as direct flex children, which the
        // `[&>*]:shrink-0` guard on the scroll container depends on.
        return (
          <Fragment key={thread.name}>
            {showFinishedHeader ? (
              <div className="tag-label text-basic-muted pt-1">Finished</div>
            ) : null}
            <ThreadRow
              thread={thread}
              episodes={episodes[thread.name] ?? []}
              live={liveThreads[thread.name]}
              running={running}
            />
          </Fragment>
        );
      })}
    </div>
  );
}
