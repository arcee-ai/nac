import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
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
  mergeThreadEventPages,
  persistedThreadLog,
  threadIsThinking,
  type LogEntry,
  type ThreadLogLine,
  type ToolCallEntry,
} from "@/app/lib/threadLog";
import { dispatchThreadName, partitionThreadCalls } from "@/app/lib/transcript";
import { useThreadEventPages } from "@/app/services/queries";
import { useLiveThreads } from "@/app/store/runtimeStore";
import { setSelectedThreadRunning } from "@/app/store/sessionLayoutStore";
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
        className={cn(
          "code code-small whitespace-pre-wrap break-words",
          // Solid colours on child spans would override the fill the shimmer
          // needs, so a pending line stays one clipped gradient.
          pending ? "text-shimmer-basic" : "text-basic-tertiary",
        )}
      >
        {pending ? (
          <>
            {"▸ "}
            {`${entry.toolName}: `}
            {entry.keyArg}
          </>
        ) : (
          <>
            <span className="text-info-primary">{"▸ "}</span>
            <span className="text-basic-primary">{`${entry.toolName}: `}</span>
            {entry.keyArg}
          </>
        )}
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
  thinking,
  loading,
  className,
  historyControl,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Whether the reader is still at the bottom, so new lines may scroll. */
  stuckRef: RefObject<boolean>;
  entries: LogEntry[];
  running: boolean;
  /** Model is between tool calls — show a live shimmer line under the log. */
  thinking: boolean;
  loading: boolean;
  className?: string;
  historyControl?: ReactNode;
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
      {historyControl}
      <div className="pb-[128px] md:pb-4">
        {entries.map((entry) => (
          <LogEntryView
            key={
              entry.kind === "tool_call" ? `call-${entry.callId}` : entry.key
            }
            entry={entry}
          />
        ))}
        {thinking ? (
          <p className="pt-1 code code-small">
            <span className="text-info-primary">{"▸ "}</span>
            <span className="text-shimmer-basic">Working…</span>
          </p>
        ) : null}
        {!entries.length && !running && !loading ? (
          <p className="pt-4 code code-small text-basic-muted">
            No commands recorded.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Command log filling the detail pane. */
function LogPane({
  lines,
  running,
  hasOlder,
  loadingOlder,
  loadingInitial,
  historyError,
  onRetry,
  onLoadOlder,
  className,
}: {
  lines: ThreadLogLine[];
  running: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadingInitial: boolean;
  historyError: string | null;
  onLoadOlder: () => Promise<unknown>;
  onRetry: () => Promise<unknown>;
  className?: string;
}) {
  const prependAnchor = useRef<{
    height: number;
    top: number;
    firstKey: string | null;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);
  const entries = useMemo(() => groupThreadLog(lines), [lines]);
  const thinking = useMemo(
    () => threadIsThinking(running, lines),
    [running, lines],
  );
  const firstEntryKey =
    entries[0]?.kind === "tool_call"
      ? `call-${entries[0].callId}`
      : entries[0]?.key ?? null;

  useLayoutEffect(() => {
    const anchor = prependAnchor.current;
    const element = scrollRef.current;
    if (!anchor || !element || anchor.firstKey === firstEntryKey) return;
    element.scrollTop = anchor.top + (element.scrollHeight - anchor.height);
    prependAnchor.current = null;
  }, [firstEntryKey]);

  useEffect(() => {
    const anchor = prependAnchor.current;
    if (!loadingOlder && anchor?.firstKey === firstEntryKey) {
      prependAnchor.current = null;
    }
  }, [firstEntryKey, loadingOlder]);

  const loadOlder = () => {
    stuckRef.current = false;
    const element = scrollRef.current;
    if (element) {
      prependAnchor.current = {
        height: element.scrollHeight,
        top: element.scrollTop,
        firstKey: firstEntryKey,
      };
    }
    void onLoadOlder().catch(() => {
      prependAnchor.current = null;
    });
  };

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stuckRef.current) return;
    scrollToBottomInstantly(element);
  }, [entries.length, thinking]);

  return (
    <LogScroller
      scrollRef={scrollRef}
      stuckRef={stuckRef}
      entries={entries}
      running={running}
      thinking={thinking}
      loading={loadingInitial}
      className={className}
      historyControl={
        hasOlder || historyError ? (
          <div className="flex items-center gap-2 pb-3">
            {hasOlder ? (
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Secondary}
                disabled={loadingOlder}
                onClick={loadOlder}
              >
                {loadingOlder ? "Loading…" : "Load older commands"}
              </Button>
            ) : null}
            {historyError ? (
              <>
                <span className="text-micro text-error-primary">
                  {historyError}
                </span>
                <Button
                  size={ButtonSize.Small}
                  variant={ButtonVariant.Ghost}
                  onClick={() => {
                    if (hasOlder) loadOlder();
                    else void onRetry();
                  }}
                >
                  Try again
                </Button>
              </>
            ) : null}
          </div>
        ) : null
      }
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
      <div className="pb-[128px] md:pb-4 flex flex-col">
        {episodes.map((episode, index) => (
          <div key={episode.id} className="flex flex-col">
            {index > 0 ? <Separator /> : null}
            <EpisodeTab episode={episode} index={index} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Which half of a thread the detail pane is showing. */
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

/** Compact Command Log / Overview pills for the desktop detail header. */
function ViewSwitcher({
  view,
  onChange,
}: {
  view: ThreadDetailView;
  onChange: (view: ThreadDetailView) => void;
}) {
  return (
    <div
      className="flex items-center gap-2 shrink-0"
      role="tablist"
      aria-label="Thread detail view"
    >
      {THREAD_DETAIL_VIEWS.map((name) => (
        <Button
          key={name}
          size={ButtonSize.Small}
          variant={
            view === name ? ButtonVariant.Primary : ButtonVariant.Secondary
          }
          className="!rounded-full"
          aria-pressed={view === name}
          onClick={() => onChange(name)}
        >
          {VIEW_LABEL[name]}
        </Button>
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
  hasOlder,
  loadingOlder,
  loadingInitial,
  historyError,
  onLoadOlder,
  onRetry,
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
  hasOlder: boolean;
  loadingOlder: boolean;
  loadingInitial: boolean;
  historyError: string | null;
  onLoadOlder: () => Promise<unknown>;
  onRetry: () => Promise<unknown>;
  view: ThreadDetailView;
  onViewChange: (view: ThreadDetailView) => void;
}) {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const log = useMemo(
    () => mergeThreadLog(persistedThreadLog(events), liveLog),
    [events, liveLog],
  );

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
        className={isMobile ? "pt-14" : undefined}
      />
    ) : (
      <Episodes
        episodes={episodes}
        className={isMobile ? "pt-14" : undefined}
      />
    );

  // Phone: floating pills over the body. Tablet: switch lives in PanelSplit.
  if (isMobile || isTablet) {
    return (
      <div className="relative flex flex-col flex-1 min-h-0 min-w-0">
        {body}
        {isMobile ? <ViewPills view={view} onChange={onViewChange} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <div className="flex items-center gap-2 h-14 px-4 shrink-0 border-b border-muted bg-elevation-level-1">
        <div className="flex flex-col flex-1 min-w-0 justify-center">
          <span
            className={cn(
              "label-small truncate",
              running ? "text-shimmer-basic" : "text-basic-primary",
            )}
          >
            {thread.name}
          </span>
          <span className="code code-micro text-basic-muted truncate">
            {thread.updated_at}
          </span>
        </div>
        <ViewSwitcher view={view} onChange={onViewChange} />
        <span className="shrink-0 text-micro text-basic-muted">
          {thread.episode_count} ep
        </span>
      </div>
      {body}
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
    // Live-only rows fill the gap until the snapshot retains them. Finished
    // ones stay too — otherwise the row blinks out between `thread_finished`
    // and the refetch that brings episodes.
    const extras = new Set<string>();
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
    const rows = [
      ...threads,
      ...[...extras].map((name) => pendingThread(name, sessionId)),
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
  }, [threads, runningNames, pendingNames, liveThreads, sessionId, waveRank]);

  const selectable = useMemo(
    () => ordered.filter((thread) => !pendingNames.has(thread.name)),
    [ordered, pendingNames],
  );
  const current =
    selectable.find((thread) => thread.name === selected) ??
    selectable[0] ??
    null;
  const live = current ? liveThreads[current.name] : undefined;

  // Keep the layout store on the thread the detail pane is showing, so the
  // phone dialog header names that thread instead of the panel label.
  const currentName = current?.name ?? null;
  const currentRunning = Boolean(currentName && runningNames.has(currentName));
  const eventPages = useThreadEventPages(
    snapshot ? sessionId : null,
    currentName,
  );
  const pagedEvents = useMemo(
    () =>
      eventPages.data
        ? mergeThreadEventPages(eventPages.data.pages)
        : undefined,
    [eventPages.data],
  );
  useEffect(() => {
    if (selected || !currentName) return;
    onSelect(currentName);
  }, [selected, currentName, onSelect]);

  // Same running bit the detail pane uses — the dialog title shimmer reads it.
  useEffect(() => {
    setSelectedThreadRunning(currentRunning);
    return () => setSelectedThreadRunning(false);
  }, [currentRunning]);

  if (!snapshot) return <PanelEmpty>Loading…</PanelEmpty>;

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
          key={`${sessionId}:${current.name}`}
          thread={current}
          episodes={snapshot.thread_episodes?.[current.name] ?? []}
          events={
            pagedEvents ?? snapshot.thread_events?.[current.name]
          }
          liveLog={live?.log ?? []}
          running={runningNames.has(current.name)}
          hasOlder={Boolean(eventPages.hasNextPage)}
          loadingOlder={eventPages.isFetchingNextPage}
          loadingInitial={eventPages.isPending}
          historyError={
            eventPages.error instanceof Error ? eventPages.error.message : null
          }
          onLoadOlder={() => eventPages.fetchNextPage()}
          onRetry={() =>
            eventPages.data
              ? eventPages.fetchNextPage()
              : eventPages.refetch()
          }
          view={view}
          onViewChange={setView}
        />
      ) : (
        <PanelEmpty>No threads yet for this session.</PanelEmpty>
      )}
    </PanelSplit>
  );
}
