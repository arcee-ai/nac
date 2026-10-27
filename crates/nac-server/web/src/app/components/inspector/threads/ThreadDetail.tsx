import { useMemo } from "react";

import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { TaskButton } from "@/app/components/inspector/TaskPreview";
import { Episodes } from "@/app/components/inspector/threads/ThreadEpisodes";
import { LogPane } from "@/app/components/inspector/threads/ThreadLog";
import {
  ViewPills,
  ViewSwitcher,
  type ThreadDetailView,
} from "@/app/components/inspector/threads/ThreadViewControls";
import { formatInsightTime } from "@/app/features/insights/presentation/insightTime";
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

  // The floating phone pills sit over the top of this column, so the body has
  // to clear them.
  const bodyOffset = isMobile ? "pt-14" : undefined;
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

  // Phone: floating pills over the body. Tablet: switch lives in PanelSplit.
  if (isMobile || isTablet) {
    return (
      <div className="relative flex flex-col flex-1 min-h-0 min-w-0">
        {body}
        {isMobile ? (
          <ViewPills
            view={view}
            action={action}
            canSteer={canSteer}
            onSteer={onSteer}
            onChange={onViewChange}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      {/* The controls wrap under the name once they would squeeze it below its
          basis, as in a detail beside the list at a 1280–1440 px window. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 min-h-14 px-4 py-2 shrink-0 border-b border-muted bg-elevation-ground">
        <div className="flex flex-col grow basis-48 min-w-0 justify-center">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={cn(
                "label-small truncate",
                running ? "text-shimmer-basic" : "text-basic-primary",
              )}
            >
              {thread.name}
            </span>
            {action ? <TaskButton action={action} /> : null}
          </div>
          <span className="code code-micro text-basic-muted truncate">
            {formatInsightTime(thread.updated_at)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {canSteer ? (
            <Button size={ButtonSize.Small} variant={ButtonVariant.Secondary} onClick={onSteer}>
              Steer
            </Button>
          ) : null}
          <ViewSwitcher view={view} onChange={onViewChange} />
          <span className="shrink-0 text-micro text-basic-muted">{episodes.length} ep</span>
        </div>
      </div>
      {body}
    </div>
  );
}
