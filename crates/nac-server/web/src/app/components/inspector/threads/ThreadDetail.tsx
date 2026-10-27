import { useMemo } from "react";

import { Button, ButtonSize, ButtonVariant, StickyButton } from "@/app/atoms";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { TaskButton } from "@/app/components/inspector/TaskPreview";
import { Episodes } from "@/app/components/inspector/threads/ThreadEpisodes";
import { LogPane } from "@/app/components/inspector/threads/ThreadLog";
import {
  ThreadViewSelect,
  ViewSwitcher,
  type ThreadDetailView,
} from "@/app/components/inspector/threads/ThreadViewControls";
import { cn } from "@/app/lib/cn";
import { mergeThreadLog, persistedThreadLog, type ThreadLogLine } from "@/app/lib/threadLog";

import type { AgentEvent, EpisodeSnapshot, ThreadSnapshot } from "@/app/types/api";

export interface ThreadDetailProps {
  thread: ThreadSnapshot;
  /** What this thread was asked to do, live for the dispatch in flight. */
  action: string;
  episodes: EpisodeSnapshot[];
  /** Commands the store has persisted for this thread. */
  events: AgentEvent[] | undefined;
  /** The same commands as the stream reported them, plus whatever came after. */
  liveLog: ThreadLogLine[];
  running: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadingInitial: boolean;
  historyError: string | null;
  onLoadOlder: () => Promise<void>;
  onRetry: () => Promise<void>;
  view: ThreadDetailView;
  canSteer: boolean;
  onSteer: () => void;
  onViewChange: (view: ThreadDetailView) => void;
}

/**
 * One thread's command log or its episodes. Key it by session and thread: the
 * log's scroll anchoring lives in refs that must not carry over to another
 * thread.
 */
export function ThreadDetail({
  thread,
  action,
  episodes,
  events,
  liveLog,
  running,
  hasOlder,
  loadingOlder,
  loadingInitial,
  historyError,
  onLoadOlder,
  onRetry,
  view,
  canSteer,
  onSteer,
  onViewChange,
}: ThreadDetailProps) {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const log = useMemo(() => mergeThreadLog(persistedThreadLog(events), liveLog), [events, liveLog]);

  // A phone's header floats over the top of this column, so the body clears it.
  const bodyOffset = isMobile ? "pt-18" : undefined;
  const body =
    view === "log" ? (
      <LogPane
        lines={log}
        running={running}
        hasOlder={hasOlder}
        loadingInitial={loadingInitial}
        loadingOlder={loadingOlder}
        historyError={historyError}
        onLoadOlder={onLoadOlder}
        onRetry={onRetry}
        className={bodyOffset}
      />
    ) : (
      <Episodes episodes={episodes} running={running} className={bodyOffset} />
    );

  // A tablet's panel header carries the controls.
  if (isTablet) {
    return <div className="flex flex-col flex-1 min-h-0 min-w-0">{body}</div>;
  }

  // A phone's header has room for the task only, so Steer and the view switch
  // float over the foot of the body, which its bottom padding keeps clear.
  if (isMobile) {
    return (
      <div className="relative flex flex-col flex-1 min-h-0 min-w-0">
        {body}
        <div
          role="toolbar"
          aria-label="Thread controls"
          className="fade-from-bottom absolute inset-x-0 bottom-0 flex items-center justify-end gap-3 p-3"
        >
          {canSteer ? (
            <StickyButton variant={ButtonVariant.Ghost} onClick={onSteer}>
              Steer
            </StickyButton>
          ) : null}
          <ThreadViewSelect view={view} onChange={onViewChange} floating />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      {/* The controls wrap under the name once they would squeeze it below its
          basis, as in a detail beside the list at a 1280–1440 px window. */}
      <div className="flex flex-wrap items-center gap-2 min-h-14 pl-4 pr-2 py-3 shrink-0 border-b border-muted bg-elevation-ground">
        <div className="flex grow basis-48 min-w-0 items-center gap-3">
          {/* Truncated here: clipping the shimmer's own box would stop it. */}
          <span className="min-w-0 truncate label-small text-basic-primary">
            <span className={cn(running && "text-shimmer-basic")}>{thread.name}</span>
          </span>
          <span className="shrink-0 text-micro text-basic-muted">{episodes.length} ep</span>
          {action ? <TaskButton action={action} /> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {canSteer ? (
            <Button size={ButtonSize.Small} variant={ButtonVariant.Secondary} onClick={onSteer}>
              Steer
            </Button>
          ) : null}
          <ViewSwitcher view={view} onChange={onViewChange} />
        </div>
      </div>
      {body}
    </div>
  );
}
