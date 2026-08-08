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
  DropdownContent,
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
  groupThreadLog,
  mergeThreadLog,
  persistedThreadLog,
  type LogEntry,
  type ThreadLogLine,
  type ToolCallEntry,
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
 * One tool call and, when it has arrived, the result beneath it. Pending calls
 * shimmer so the eye lands on the command the thread is on right now.
 */
const ToolCallView = memo(function ToolCallView({
  entry,
}: {
  entry: ToolCallEntry;
}) {
  const pending = entry.status === "pending";
  return (
    <div className="pt-1">
      <p
        className={
          "code code-small whitespace-pre-wrap break-words " +
          (pending ? "text-shimmer-basic" : "text-basic-tertiary")
        }
      >
        <span className="text-info-primary">{"▸ "}</span>
        <span className="text-basic-primary">{`${entry.toolName}: `}</span>
        {entry.keyArg}
      </p>
      {entry.resultPreview !== null ? (
        <p
          className={
            "pl-4 pt-0.5 code code-small whitespace-pre-wrap break-words " +
            (entry.isError ? "text-error-primary" : "text-basic-tertiary")
          }
        >
          <span
            className={
              entry.isError ? "text-error-primary" : "text-success-primary"
            }
          >
            {`${entry.isError ? "✕" : "✓"} `}
          </span>
          {entry.resultPreview}
        </p>
      ) : null}
    </div>
  );
});

/**
 * A line the worker printed that is not a tool call — its plain log output.
 */
const StandaloneView = memo(function StandaloneView({
  entry,
}: {
  entry: { kind: "log"; key: string; text: string; isError: boolean };
}) {
  return (
    <p
      className={
        "pt-1 code code-small whitespace-pre-wrap break-words " +
        (entry.isError ? "text-error-primary" : "text-basic-tertiary")
      }
    >
      {entry.text}
    </p>
  );
});

/**
 * Dispatches a grouped log entry to its view. Kept as a switch so the compiler
 * flags any new `LogEntry` kind that is not handled.
 */
const LogEntryView = memo(function LogEntryView({
  entry,
}: {
  entry: LogEntry;
}) {
  if (entry.kind === "tool_call") return <ToolCallView entry={entry} />;
  return <StandaloneView entry={entry} />;
});

/**
 * One retained episode as a collapsible tab. Collapsed it shows the index,
 * timestamp, and a truncated action preview; expanded it reveals the full
 * action and the episode content beneath. Each tab owns its own open state so
 * several can be read at once.
 */
function EpisodeTab({
  episode,
  index,
}: {
  episode: EpisodeSnapshot;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isMobile = useIsMobile();
  return (
    <div className="flex flex-col items-start w-full">
      <button
        type="button"
        className="group flex items-center gap-2 py-3 pl-1 pr-3 md:py-2 md:pl-3 md:pr-2 rounded-[4px] w-full btn-ghost"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Icon
          iconName={expanded ? IconName.Down : IconName.Right}
          size={16}
          className="shrink-0 text-basic-muted"
        />
        <span
          className={`shrink-0 ${isMobile ? "label-small" : "label-micro"} text-basic-primary`}
        >
          {`Episode ${index + 1}`}
        </span>
        <span
          className={`flex-1 min-w-0 ${isMobile ? "label-small" : "label-micro"} text-basic-secondary truncate`}
        >
          {episode.action}
        </span>
      </button>
      <DropdownContent isOpen={expanded} className="w-full">
        <div className="flex flex-col gap-4 md:pl-3 md:pr-2 py-6">
          <Markdown className="text-basic-secondary">{episode.action}</Markdown>
          <Separator />
          <Markdown className="text-basic-secondary">
            {episode.content}
          </Markdown>
        </div>
      </DropdownContent>
    </div>
  );
}

const LIST_KIND_ORDER: Record<ListKind, number> = {
  // Last to execute (queued on deps) above currently running, done last.
  pending: 0,
  running: 1,
  done: 2,
};

/**
 * The log itself: the commands as they were issued, stuck to the bottom for as
 * long as the reader leaves it there.
 */
function LogScroller({
  scrollRef,
  stuckRef,
  entries,
  running,
  className,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Whether the reader is still at the bottom, so new lines may scroll. */
  stuckRef: RefObject<boolean>;
  entries: LogEntry[];
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
      {entries.map((entry) => (
        <LogEntryView
          key={entry.kind === "tool_call" ? `call-${entry.callId}` : entry.key}
          entry={entry}
        />
      ))}
      {!entries.length && !running ? (
        <p className="pt-4 code code-small text-basic-muted">
          No commands recorded.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Everything the thread has run, oldest first. The view follows the bottom
 * edge the way `tail -f` does and lets go as soon as the user scrolls back to
 * read something.
 */
function LogTail({
  lines,
  running,
  paneRef,
}: {
  lines: ThreadLogLine[];
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
  const entries = useMemo(() => groupThreadLog(lines), [lines]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stuckRef.current) return;
    scrollToBottomInstantly(element);
  }, [entries.length]);

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
          {`${entries.length} total`}
        </span>
      </div>
      <LogScroller
        scrollRef={scrollRef}
        stuckRef={stuckRef}
        entries={entries}
        running={running}
        className="border-t border-muted"
      />
    </div>
  );
}

/** Log pane on its own, for a narrow panel that shows one view at a time. */
function LogPane({
  lines,
  running,
  className,
}: {
  lines: ThreadLogLine[];
  running: boolean;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);
  const entries = useMemo(() => groupThreadLog(lines), [lines]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stuckRef.current) return;
    scrollToBottomInstantly(element);
  }, [entries.length]);

  return (
    <LogScroller
      scrollRef={scrollRef}
      stuckRef={stuckRef}
      entries={entries}
      running={running}
      className={className}
    />
  );
}

/** Retained episodes of one thread as collapsible tabs. */
function Episodes({
  episodes,
  className,
}: {
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
      {episodes.map((episode, index) => (
        <div key={episode.id} className="flex flex-col">
          {index > 0 ? <Separator /> : null}
          <EpisodeTab episode={episode} index={index} />
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
            running={running}
            className={isMobile ? "pt-14" : undefined}
          />
        ) : (
          <Episodes
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
        <Episodes episodes={episodes} className="border-t border-muted" />
      ) : (
        <div className="flex-1 min-h-0" />
      )}
      <LogTail lines={log} running={running} paneRef={paneRef} />
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
          view={view}
          onViewChange={setView}
        />
      ) : (
        <PanelEmpty>No threads yet for this session.</PanelEmpty>
      )}
    </PanelSplit>
  );
}
