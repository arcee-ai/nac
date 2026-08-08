import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import {
  Button,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Loader,
  LoaderSize,
  LoaderVariant,
  Select,
  Separator,
} from "@/app/atoms";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import {
  PanelEmpty,
  PanelRow,
  PanelSplit,
} from "@/app/components/inspector/PanelSplit";
import {
  clampThreadLogRatio,
  setThreadLogHeightRatio,
  THREAD_LOG_MAX_RATIO,
  THREAD_LOG_MIN_RATIO,
  useThreadLogHeightRatio,
} from "@/app/hooks/useThreadLogHeight";
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
import { dispatchThreadName, partitionThreadCalls } from "@/app/lib/transcript";
import { useLiveThreads } from "@/app/store/runtimeStore";
import type {
  AgentEvent,
  EpisodeSnapshot,
  SessionSnapshotResponse,
  ThreadSnapshot,
  ToolCall,
} from "@/app/types/api";

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

/**
 * One log line, with the glyph and the tool name lifted out of the command so
 * the eye can find where an entry starts and what issued it.
 */
const LogLine = memo(function LogLine({ line }: { line: ThreadLogLine }) {
  const className =
    "pt-1 code code-small whitespace-pre-wrap break-words " +
    (line.isError ? "text-error-primary" : "text-basic-tertiary");

  // A failed call reads as one red line; picking it apart would bury the mark.
  if (line.isError) return <p className={className}>{line.text}</p>;

  return (
    <p className={className}>
      {line.mark ? (
        <span
          className={
            line.mark === "▸" ? "text-info-primary" : "text-success-primary"
          }
        >
          {`${line.mark} `}
        </span>
      ) : null}
      {line.name ? (
        <span className="text-basic-primary">{`${line.name}: `}</span>
      ) : null}
      {line.body}
    </p>
  );
});

const LIST_KIND_ORDER: Record<ListKind, number> = {
  // Last to execute (queued on deps) above currently running, done last.
  pending: 0,
  running: 1,
  done: 2,
};

/**
 * Everything the thread has run, oldest first, followed by the operation it is
 * on right now. The view follows the bottom edge the way `tail -f` does and
 * lets go as soon as the user scrolls back to read something.
 */
function LogTail({
  lines,
  action,
  running,
  paneRef,
}: {
  lines: ThreadLogLine[];
  action: string;
  running: boolean;
  /** Detail pane whose height the log is sized against. */
  paneRef: RefObject<HTMLDivElement | null>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // A ref rather than state: nothing renders differently for it, and the scroll
  // handler has to see the current value without waiting for a re-render.
  const stuckRef = useRef(true);
  const dragging = useRef(false);
  const ratio = useThreadLogHeightRatio();

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stuckRef.current) return;
    scrollToBottomInstantly(element);
  }, [lines.length, action]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const pane = paneRef.current;
    if (!pane) return;
    event.preventDefault();
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      if (!dragging.current) return;
      const rect = pane.getBoundingClientRect();
      if (rect.height <= 0) return;
      // The log sits at the bottom of the pane; dragging its top edge sets
      // height from the pointer down to the pane's bottom.
      setThreadLogHeightRatio(
        clampThreadLogRatio((rect.bottom - moveEvent.clientY) / rect.height),
      );
    };

    const onUp = (upEvent: PointerEvent) => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      try {
        event.currentTarget.releasePointerCapture(upEvent.pointerId);
      } catch {
        // Already released.
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div
      className="relative flex flex-col shrink-0 min-h-0"
      style={{ height: `${ratio * 100}%` }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize command log"
        aria-valuemin={Math.round(THREAD_LOG_MIN_RATIO * 100)}
        aria-valuemax={Math.round(THREAD_LOG_MAX_RATIO * 100)}
        aria-valuenow={Math.round(ratio * 100)}
        tabIndex={0}
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize touch-none"
        onPointerDown={onPointerDown}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.05 : 0.02;
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setThreadLogHeightRatio(ratio + step);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            setThreadLogHeightRatio(ratio - step);
          }
        }}
      />
      <div className="px-4 py-3 shrink-0 bg-elevation-level-1 border-t border-muted flex items-center gap-2">
        <p className="tag-label text-basic-primary flex-1 min-w-0">
          {`Command log`}
        </p>
        <span className="tag-label text-basic-tertiary shrink-0">
          {`${lines.length} total`}
        </span>
      </div>
      <LogScroller
        scrollRef={scrollRef}
        stuckRef={stuckRef}
        lines={lines}
        action={action}
        running={running}
        className="border-t border-muted"
      />
    </div>
  );
}

/**
 * The log itself: the commands as they were issued, stuck to the bottom for as
 * long as the reader leaves it there.
 */
function LogScroller({
  scrollRef,
  stuckRef,
  lines,
  action,
  running,
  className,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Whether the reader is still at the bottom, so new lines may scroll. */
  stuckRef: RefObject<boolean>;
  lines: ThreadLogLine[];
  action: string;
  running: boolean;
  className?: string;
}) {
  return (
    <div
      ref={scrollRef}
      className={cn(
        "flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0 bg-elevation-level-0-5",
        className,
      )}
      onScroll={() => {
        const element = scrollRef.current;
        if (element) {
          stuckRef.current = distanceFromBottom(element) <= STICK_TOLERANCE_PX;
        }
      }}
    >
      {lines.map((line) => (
        <LogLine key={line.key} line={line} />
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

/** Log pane on its own, for a narrow panel that shows one view at a time. */
function LogPane({
  lines,
  action,
  running,
  className,
}: {
  lines: ThreadLogLine[];
  action: string;
  running: boolean;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stuckRef.current) return;
    scrollToBottomInstantly(element);
  }, [lines.length, action]);

  return (
    <LogScroller
      scrollRef={scrollRef}
      stuckRef={stuckRef}
      lines={lines}
      action={action}
      running={running}
      className={className}
    />
  );
}

/** Retained episodes of one thread, newest last. */
function Episodes({
  thread,
  episodes,
  className,
}: {
  thread: ThreadSnapshot;
  episodes: EpisodeSnapshot[];
  className?: string;
}) {
  if (!episodes.length) {
    return (
      <div className={cn("flex flex-1 min-h-0", className)}>
        <p className="p-4 code code-small text-basic-muted">
          No episodes retained yet.
        </p>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0",
        className,
      )}
    >
      <p className="code code-small text-info-primary">
        {`Thread "${thread.name}" retained episodes (${episodes.length} total):`}
      </p>
      {episodes.map((episode, index) => (
        <div key={episode.id} className="pt-4 flex flex-col gap-8">
          <p className="code code-small text-info-primary opacity-75">
            {`=== Episode ${index + 1} | ${episode.created_at} | action: ${episode.action} ===`}
          </p>
          <Separator />
          <Markdown className="text-basic-secondary">
            {episode.content}
          </Markdown>
        </div>
      ))}
    </div>
  );
}

/** Which half of a thread a narrow panel is showing. */
type ThreadDetailView = "log" | "overview";

const VIEW_LABEL: Record<ThreadDetailView, string> = {
  log: "Command Log",
  overview: "Overview",
};

const THREAD_DETAIL_VIEWS: ThreadDetailView[] = ["log", "overview"];

/**
 * Phone form of the switch: two pills floating over the view they change, since
 * the box header at that width is already full.
 */
function ViewPills({
  view,
  onChange,
}: {
  view: ThreadDetailView;
  onChange: (view: ThreadDetailView) => void;
}) {
  return (
    <div className="absolute inset-x-0 top-0 flex items-center gap-4 p-2">
      {THREAD_DETAIL_VIEWS.map((name) => (
        <div
          key={name}
          className="flex flex-1 min-w-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden"
        >
          <Button
            className="w-full"
            size={ButtonSize.Medium}
            variant={
              view === name ? ButtonVariant.Primary : ButtonVariant.Secondary
            }
            aria-pressed={view === name}
            onClick={() => onChange(name)}
          >
            {VIEW_LABEL[name]}
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Tablet form of the same switch, trailing the panel's own header row. */
function ThreadViewSelect({
  view,
  onChange,
}: {
  view: ThreadDetailView;
  onChange: (view: ThreadDetailView) => void;
}) {
  return (
    <Select
      size={ButtonSize.Small}
      variant={ButtonVariant.Secondary}
      value={view}
      items={THREAD_DETAIL_VIEWS.map((name) => ({
        id: name,
        label: VIEW_LABEL[name],
      }))}
      onValueChange={(id) => onChange(id as ThreadDetailView)}
    />
  );
}

function Detail({
  thread,
  episodes,
  events,
  liveLog,
  running,
  currentAction,
  view,
  onViewChange,
}: {
  thread: ThreadSnapshot;
  episodes: EpisodeSnapshot[];
  /** Commands the store has persisted for this thread. */
  events: AgentEvent[] | undefined;
  /** The same commands as the stream reported them, plus whatever came after. */
  liveLog: ThreadLogLine[];
  running: boolean;
  currentAction: string;
  /** Which view a narrow panel shows; a wide one stacks both and ignores it. */
  view: ThreadDetailView;
  onViewChange: (view: ThreadDetailView) => void;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const log = useMemo(
    () => mergeThreadLog(persistedThreadLog(events), liveLog),
    [events, liveLog],
  );

  // Neither width fits the episodes above the log, so the two become views of
  // their own and the switch above picks one.
  if (isMobile || isTablet) {
    return (
      <div className="relative flex flex-col flex-1 min-h-0 min-w-0">
        {view === "log" ? (
          <LogPane
            lines={log}
            action={currentAction}
            running={running}
            className={isMobile ? "pt-14" : undefined}
          />
        ) : (
          <Episodes
            thread={thread}
            episodes={episodes}
            className={isMobile ? "pt-14" : undefined}
          />
        )}
        {isMobile ? <ViewPills view={view} onChange={onViewChange} /> : null}
      </div>
    );
  }

  return (
    <div ref={paneRef} className="flex flex-col flex-1 min-h-0 min-w-0">
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

      {episodes.length ? (
        <Episodes
          thread={thread}
          episodes={episodes}
          className="border-t border-muted"
        />
      ) : (
        <div className="flex-1 min-h-0" />
      )}
      <LogTail
        lines={log}
        action={currentAction}
        running={running}
        paneRef={paneRef}
      />
    </div>
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
  // Only a narrow panel reads this; the wide one shows both halves at once.
  const [view, setView] = useState<ThreadDetailView>("log");
  const threads = useMemo(() => snapshot?.threads ?? [], [snapshot]);
  const activeThreads = snapshot?.active_threads;
  const sessionId = snapshot?.metadata.session_id ?? "";
  const waveRank = useMemo(
    () => waveRankByName(snapshot?.messages),
    [snapshot?.messages],
  );

  // Backend pre-marks every name in a DAG batch as active. Only
  // `thread_started` means the worker is actually running; the rest are
  // pending on in-batch deps.
  const { runningNames, pendingNames } = useMemo(() => {
    const running = new Set<string>();
    const pending = new Set<string>();
    for (const name of activeThreads ?? []) {
      const live = liveThreads[name];
      if (live?.status === "running") running.add(name);
      else if (live?.status === "finished") {
        // Stay out of both sets until the snapshot drops the name.
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
  }, [activeThreads, liveThreads]);

  const ordered = useMemo(() => {
    const persisted = new Set(threads.map((thread) => thread.name));
    const extras = [...runningNames, ...pendingNames].filter(
      (name) => !persisted.has(name),
    );
    const rows = [
      ...threads,
      ...extras.map((name) => pendingThread(name, sessionId)),
    ];
    const kindOf = (name: string): ListKind => {
      if (pendingNames.has(name)) return "pending";
      if (runningNames.has(name)) return "running";
      return "done";
    };
    // Stable sort: later DAG waves (and pending) float up; done sinks.
    return rows.sort((a, b) => {
      const kindDiff =
        LIST_KIND_ORDER[kindOf(a.name)] - LIST_KIND_ORDER[kindOf(b.name)];
      if (kindDiff !== 0) return kindDiff;
      const rankDiff =
        (waveRank.get(b.name) ?? -1) - (waveRank.get(a.name) ?? -1);
      if (rankDiff !== 0) return rankDiff;
      return 0;
    });
  }, [threads, runningNames, pendingNames, sessionId, waveRank]);

  if (!snapshot) return <PanelEmpty>Loading…</PanelEmpty>;

  const selectable = ordered.filter((thread) => !pendingNames.has(thread.name));
  const current =
    selectable.find((thread) => thread.name === selected) ??
    selectable[0] ??
    null;
  const live = current ? liveThreads[current.name] : undefined;

  return (
    <PanelSplit
      listTitle="Threads"
      title={current?.name}
      actions={
        current ? <ThreadViewSelect view={view} onChange={setView} /> : null
      }
      list={
        ordered.length === 0 ? (
          <div className="p-1 label-micro text-basic-muted">
            No threads yet for this session.
          </div>
        ) : (
          ordered.map((thread) => {
            const pending = pendingNames.has(thread.name);
            const running = runningNames.has(thread.name);
            const errored = liveThreads[thread.name]?.isError;
            return (
              <PanelRow
                key={thread.name}
                label={thread.name}
                active={thread.name === current?.name}
                disabled={pending}
                title={pending ? "Waiting on source threads" : undefined}
                icon={
                  pending ? (
                    <Icon
                      iconName={IconName.Timelaps}
                      size={16}
                      className="shrink-0 [&>path]:!fill-basic-muted"
                    />
                  ) : running ? (
                    <Loader
                      size={LoaderSize.Micro}
                      variant={LoaderVariant.Neutral}
                    />
                  ) : (
                    <Icon
                      iconName={
                        errored ? IconName.Danger : IconName.CheckCircle
                      }
                      size={16}
                      className={cn(
                        "shrink-0",
                        errored && "text-error-primary",
                      )}
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
          })
        )
      }
    >
      {current ? (
        <Detail
          thread={current}
          episodes={snapshot.thread_episodes?.[current.name] ?? []}
          events={snapshot.thread_events?.[current.name]}
          liveLog={live?.log ?? []}
          running={runningNames.has(current.name)}
          currentAction={live?.action || current.latest_action || ""}
          view={view}
          onViewChange={setView}
        />
      ) : (
        <PanelEmpty>No threads yet for this session.</PanelEmpty>
      )}
    </PanelSplit>
  );
}
