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
  Badge,
  BadgeColor,
  Button,
  ButtonSize,
  ButtonVariant,
  DropdownContent,
  Icon,
  IconName,
  Select,
  Separator,
  ShimmerLoader,
} from "@/app/atoms";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { usePagedRows } from "@/app/hooks/usePagedRows";
import { SegmentDetailList } from "@/app/components/inspector/agent-segments/SegmentDetailList";
import {
  ActionFilterBar,
  ActionItemList,
  ActionTurnHeader,
} from "@/app/components/inspector/ActionList";
import { PanelEmpty, PanelLoading, PanelSplit } from "@/app/components/inspector/PanelSplit";
import { TaskButton, TaskPill } from "@/app/components/inspector/TaskPreview";
import { cn } from "@/app/lib/cn";
import type { ActionFilter, ActionItem } from "@/app/lib/actionsTimeline";
import {
  buildActionTimeline,
  filterActionTimeline,
  flattenActionItems,
} from "@/app/lib/actionsTimeline";
import type { AgentToolsGroup } from "@/app/lib/agentSegments";
import { Markdown } from "@/app/lib/markdown";
import { SESSION_PANEL_LABEL } from "@/app/lib/routes";
import { STICK_TOLERANCE_PX, distanceFromBottom, scrollToBottomInstantly } from "@/app/lib/scroll";
import {
  groupThreadLog,
  mergeThreadLog,
  mergeThreadEventPages,
  persistedThreadLog,
  threadIsThinking,
  type LogEntry,
  type StandaloneLine,
  type ThreadLogLine,
  type ToolCallEntry,
} from "@/app/lib/threadLog";
import {
  cancelledThreadNames,
  dispatchActions,
  dispatchThreadName,
  partitionThreadCalls,
  buildTranscript,
  withStreamedOutput,
} from "@/app/lib/transcript";
import { useThreadEventPages } from "@/app/services/queries";
import {
  useFinishedToolCalls,
  useLiveThreads,
  usePrimaryToolEvents,
  useStreamReasoning,
  useStreamStatus,
  useStreamText,
  type RuntimeThread,
} from "@/app/store/runtimeStore";
import { setSelectedThreadRunning } from "@/app/store/sessionLayoutStore";
import type {
  AgentEvent,
  EpisodeSnapshot,
  SessionSnapshotResponse,
  ThreadSnapshot,
  ToolCall,
} from "@/app/types/api";

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

/**
 * One tool call and, when it has arrived, the result beneath it. Pending calls
 * shimmer so the eye lands on the command the thread is on right now.
 */
const ToolCallView = memo(function ToolCallView({
  entry,
  running,
}: {
  entry: ToolCallEntry;
  /** Whether the thread is still running — a call with no result in a
   * finished thread is history, not something in flight. */
  running: boolean;
}) {
  const pending = entry.status === "pending" && running;
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
        // Only the glyph carries the outcome. What a failing command printed is
        // the part worth reading, and a whole line of red reads as unreadable
        // rather than as urgent — a "File not found" is a plain fact about the
        // path in it.
        <p className="pl-4 pt-0.5 code code-small whitespace-pre-wrap break-words text-basic-tertiary">
          <span className={entry.isError ? "text-error-primary" : "text-success-primary"}>
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
const StandaloneView = memo(function StandaloneView({ entry }: { entry: StandaloneLine }) {
  return (
    <p className="pt-1 code code-small whitespace-pre-wrap break-words text-basic-tertiary">
      {entry.mark ? (
        <span className={entry.isError ? "text-error-primary" : "text-success-primary"}>
          {`${entry.mark} `}
        </span>
      ) : null}
      {entry.name ? <span className="text-basic-primary">{`${entry.name}: `}</span> : null}
      {entry.body}
    </p>
  );
});

/**
 * Dispatches a grouped log entry to its view. Kept as a switch so the compiler
 * flags any new `LogEntry` kind that is not handled.
 */
const LogEntryView = memo(function LogEntryView({
  entry,
  running,
}: {
  entry: LogEntry;
  running: boolean;
}) {
  if (entry.kind === "tool_call") return <ToolCallView entry={entry} running={running} />;
  return <StandaloneView entry={entry} />;
});

/** How a dispatch that produced no handoff ended, as the badge reads it. */
interface FailedEpisodeBadgeMap {
  [reason: string]: { label: string; color: BadgeColor };
}

const FAILED_EPISODE_BADGE: FailedEpisodeBadgeMap = {
  error: { label: "Failed", color: BadgeColor.Red },
  timed_out: { label: "Timed out", color: BadgeColor.Yellow },
  cancelled: { label: "Cancelled", color: BadgeColor.Yellow },
};

/**
 * One dispatch as a collapsible tab. The row carries the index and how the
 * dispatch ended; expanding it reveals only what the thread handed back, since
 * the prompt is already one click away under the panel's own Task control.
 * Each tab owns its open state so several can be read at once.
 */
function EpisodeTab({ episode, index }: { episode: EpisodeSnapshot; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const isMobile = useIsMobile();
  const failure = FAILED_EPISODE_BADGE[episode.status];
  const labelClass = isMobile ? "label-small" : "label-micro";
  return (
    <div className="flex flex-col items-start w-full">
      <button
        type="button"
        className="group flex items-center gap-2 w-full py-3 pl-1 pr-3 md:py-2 md:pl-3 md:pr-2 rounded-[4px] btn-ghost"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Icon
          iconName={expanded ? IconName.Down : IconName.Right}
          size={16}
          className="shrink-0 text-basic-muted"
        />
        <span className={`shrink-0 ${labelClass} text-basic-primary`}>
          {`Episode ${index + 1}`}
        </span>
        {failure ? <Badge text={failure.label} color={failure.color} className="shrink-0" /> : null}
      </button>
      <DropdownContent isOpen={expanded} className="w-full">
        <div className="flex flex-col pl-1 pr-1 md:pl-3 md:pr-2 pt-2 pb-6">
          {episode.content.trim() ? (
            <Markdown className="text-basic-primary">{episode.content}</Markdown>
          ) : (
            <p className="label-small text-basic-muted">
              {failure
                ? "The dispatch ended before the thread answered."
                : "The thread answered with nothing."}
            </p>
          )}
        </div>
      </DropdownContent>
    </div>
  );
}

const LIST_KIND_ORDER = {
  // Last to execute (queued on deps) above currently running, done last.
  pending: 0,
  running: 1,
  done: 2,
} satisfies Record<ListKind, number>;

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
            key={entry.kind === "tool_call" ? `call-${entry.callId}` : entry.key}
            entry={entry}
            running={running}
          />
        ))}
        {thinking ? (
          <p className="pt-1 code code-small">
            <span className="text-info-primary">{"▸ "}</span>
            <span className="text-shimmer-basic">Working…</span>
          </p>
        ) : null}
        {!entries.length && !thinking && (loading || running) ? (
          <div role="status" aria-label="Loading command log" className="pt-4">
            <ShimmerLoader rows={3} rowClassName="h-6" />
          </div>
        ) : null}
        {!entries.length && !running && !loading ? (
          <p className="pt-4 code code-small text-basic-muted">No commands recorded.</p>
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
  onLoadOlder: () => Promise<void>;
  onRetry: () => Promise<void>;
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
  const thinking = useMemo(() => threadIsThinking(running, lines), [running, lines]);
  const firstEntryKey =
    entries[0]?.kind === "tool_call" ? `call-${entries[0].callId}` : (entries[0]?.key ?? null);

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

  // Before paint, not after: a log is read from its foot, and a pane that put
  // its head on screen first — which is where a fresh scroll container starts,
  // and where opening another chat lands — would show the wrong end of the
  // thread for a frame and then snap away from it.
  useLayoutEffect(() => {
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
                <span className="text-micro text-error-primary">{historyError}</span>
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

/** The dispatches of one thread as collapsible tabs. */
function Episodes({
  episodes,
  running,
  className,
}: {
  episodes: EpisodeSnapshot[];
  running: boolean;
  className?: string;
}) {
  if (!episodes.length) {
    return (
      <div className={cn("flex flex-1 min-h-0", className)}>
        <p className="p-4 max-w-prose label-small text-basic-muted">
          {running
            ? "An episode records one dispatch — what the thread was asked to do and what came back. This one is written when the dispatch ends; until then the Command Log is the live view."
            : "This thread has not been dispatched yet, so it has no episodes."}
        </p>
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0", className)}>
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

const VIEW_LABEL = {
  log: "Command Log",
  overview: "Episodes",
} satisfies Record<ThreadDetailView, string>;

const THREAD_DETAIL_VIEWS: ThreadDetailView[] = ["log", "overview"];

/**
 * Phone form of the switch: pills floating over the view they change, since the
 * box header at that width is already full. The phone's dialog title has no
 * room for the task the wider headers carry beside the thread name, so it rides
 * along here as a third pill — one that opens a sheet instead of swapping the
 * view, and so takes only the width of its own word rather than an equal share.
 */
function ViewPills({
  view,
  action,
  onChange,
}: {
  view: ThreadDetailView;
  /** What the open thread was asked to do, if the dispatch is known. */
  action: string;
  onChange: (view: ThreadDetailView) => void;
}) {
  return (
    <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-2">
      {THREAD_DETAIL_VIEWS.map((name) => (
        <div
          key={name}
          className="flex min-w-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden"
        >
          <Button
            className="w-full"
            size={ButtonSize.Medium}
            variant={view === name ? ButtonVariant.Primary : ButtonVariant.Secondary}
            aria-pressed={view === name}
            onClick={() => onChange(name)}
          >
            {VIEW_LABEL[name]}
          </Button>
        </div>
      ))}
      {action ? (
        <div className="flex shrink-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden">
          <TaskPill action={action} />
        </div>
      ) : null}
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
          variant={view === name ? ButtonVariant.Primary : ButtonVariant.Secondary}
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
      onValueChange={(id) =>
        // SAFETY: the ids are built from THREAD_DETAIL_VIEWS above, so every
        // value the picker can emit is a ThreadDetailView.
        onChange(id as ThreadDetailView)
      }
    />
  );
}

function Detail({
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
  onViewChange,
}: {
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
  onViewChange: (view: ThreadDetailView) => void;
}) {
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
        {isMobile ? <ViewPills view={view} action={action} onChange={onViewChange} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      <div className="flex items-center gap-2 h-14 px-4 shrink-0 border-b border-muted bg-elevation-level-1">
        <div className="flex flex-col flex-1 min-w-0 justify-center">
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
          <span className="code code-micro text-basic-muted truncate">{thread.updated_at}</span>
        </div>
        <ViewSwitcher view={view} onChange={onViewChange} />
        <span className="shrink-0 text-micro text-basic-muted">{episodes.length} ep</span>
      </div>
      {body}
    </div>
  );
}

const ORCHESTRATOR_FILTERS: readonly ActionFilter[] = ["all", "threads", "tools"];

function extraThreadItem(
  thread: ThreadSnapshot,
  state: "running" | "pending" | "done",
  action: string,
): Extract<ActionItem, { kind: "thread" }> {
  return {
    kind: "thread",
    id: `extra:${thread.name}`,
    name: thread.name,
    episodeKey: thread.name,
    nested: false,
    state,
    action,
  };
}

/**
 * Retained workstreams, thoughts, and workset tools for an Orchestrator
 * session. Thread command logs stay on the detail pane; reasoning and other
 * tools use the same segment list as Agent.
 */
export function ThreadsView({
  snapshot,
  selected,
  selectedEpisode = null,
  selectedGroup = null,
  onSelect,
  onSelectGroup,
}: {
  snapshot: SessionSnapshotResponse | null;
  /** Thread the chat pointed at, if any. */
  selected: string | null;
  selectedEpisode?: string | null;
  selectedGroup?: string | null;
  onSelect: (name: string | null, episodeKey?: string | null) => void;
  onSelectGroup?: (id: string | null) => void;
}) {
  const liveThreads = useLiveThreads();
  const streamStatus = useStreamStatus();
  const finishedToolCalls = useFinishedToolCalls();
  const primaryToolEvents = usePrimaryToolEvents();
  const streamText = useStreamText();
  const streamReasoning = useStreamReasoning();
  const [view, setView] = useState<ThreadDetailView>("log");
  const [filter, setFilter] = useState<ActionFilter>("all");
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

  const sections = useMemo(() => {
    const turns = withStreamedOutput(
      buildTranscript(snapshot, liveThreads, finishedToolCalls, primaryToolEvents),
      { text: streamText, reasoning: streamReasoning },
    );
    return buildActionTimeline(turns);
  }, [snapshot, liveThreads, finishedToolCalls, primaryToolEvents, streamText, streamReasoning]);
  const visibleSections = useMemo(() => filterActionTimeline(sections, filter), [sections, filter]);
  const timelineThreadNames = useMemo(() => {
    const names = new Set<string>();
    for (const item of flattenActionItems(sections)) {
      if (item.kind === "thread") names.add(item.name);
    }
    return names;
  }, [sections]);
  const extraItems = useMemo(() => {
    if (filter === "tools") return [];
    return ordered
      .filter((thread) => !timelineThreadNames.has(thread.name))
      .map((thread) =>
        extraThreadItem(
          thread,
          pendingNames.has(thread.name)
            ? "pending"
            : runningNames.has(thread.name)
              ? "running"
              : "done",
          actions[thread.name] || thread.latest_action || "",
        ),
      );
  }, [filter, ordered, timelineThreadNames, pendingNames, runningNames, actions]);
  const listSections = useMemo(() => {
    if (extraItems.length === 0) return visibleSections;
    return [
      {
        key: "live",
        number: visibleSections[0]?.number ?? 1,
        prompt: "",
        createdAt: null,
        items: extraItems,
      },
      ...visibleSections,
    ];
  }, [extraItems, visibleSections]);
  const listItems = useMemo(() => flattenActionItems(listSections), [listSections]);

  const currentGroup: AgentToolsGroup | null = useMemo(() => {
    const match = listItems.find(
      (item) => (item.kind === "group" || item.kind === "spawn") && item.id === selectedGroup,
    );
    if (!match || match.kind === "thread") return null;
    return match.group;
  }, [listItems, selectedGroup]);
  const showingGroup = Boolean(selectedGroup && currentGroup && currentGroup.id === selectedGroup);
  const current = showingGroup
    ? null
    : (ordered.find((thread) => thread.name === selected) ?? null);
  const currentSectionIndex = showingGroup
    ? listSections.findIndex((section) => section.items.some((item) => item.id === selectedGroup))
    : listSections.findIndex((section) =>
        section.items.some((item) => item.kind === "thread" && item.name === current?.name),
      );
  const { visible, hasMore, sentinelRef } = usePagedRows(listSections, {
    key: `${sessionId}:${filter}`,
    atLeast: currentSectionIndex + 1,
  });
  const live = current ? liveThreads[current.name] : undefined;
  const currentAction = current ? actions[current.name] || current.latest_action || "" : "";

  const currentName = current?.name ?? null;
  const currentRunning = Boolean(currentName && runningNames.has(currentName));
  const eventPages = useThreadEventPages(snapshot ? sessionId : null, currentName);
  const pagedEvents = useMemo(
    () => (eventPages.data ? mergeThreadEventPages(eventPages.data.pages) : undefined),
    [eventPages.data],
  );
  useEffect(() => {
    if (selectedGroup) return;
    if (!selected) return;
    if (ordered.some((thread) => thread.name === selected)) return;
    onSelect(null);
  }, [selected, ordered, onSelect, selectedGroup]);
  useEffect(() => {
    if (selectedGroup || selected) return;
    const first = listItems[0];
    if (!first) return;
    if (first.kind === "thread") onSelect(first.name, first.episodeKey);
    else onSelectGroup?.(first.id);
  }, [selectedGroup, selected, listItems, onSelect, onSelectGroup]);

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
  }, [currentRunning]);

  if (!snapshot) return <PanelLoading listTitle={SESSION_PANEL_LABEL.threads} />;

  const threadFlags = (name: string) => {
    const liveRow = liveThreads[name];
    const pending = pendingNames.has(name);
    const running = runningNames.has(name);
    const lastEpisode = snapshot.thread_episodes?.[name]?.at(-1);
    const episodeCount = snapshot.thread_episodes?.[name]?.length ?? 0;
    const cancelled =
      Boolean(liveRow?.cancelled) ||
      cancelledNames.has(name) ||
      lastEpisode?.status === "cancelled" ||
      (!running && !pending && episodeCount === 0);
    return {
      pending,
      running,
      cancelled,
      errored: Boolean(liveRow?.isError),
    };
  };

  const pickGroup = (id: string) => {
    onSelect(null);
    onSelectGroup?.(id);
  };
  const pickThread = (name: string, episodeKey: string) => {
    onSelectGroup?.(null);
    onSelect(name, episodeKey);
  };

  return (
    <PanelSplit
      listTitle={SESSION_PANEL_LABEL.threads}
      title={showingGroup ? currentGroup?.label : current?.name}
      titleAction={!showingGroup && currentAction ? <TaskButton action={currentAction} /> : null}
      actions={
        !showingGroup && current ? <ThreadViewSelect view={view} onChange={setView} /> : null
      }
      listToolbar={
        <ActionFilterBar value={filter} options={ORCHESTRATOR_FILTERS} onChange={setFilter} />
      }
      list={
        listSections.length === 0 ? (
          <div className="flex flex-col px-2 pb-4 pt-2 text-micro">
            <p className="text-basic-tertiary">No actions yet.</p>
            <p className="text-basic-muted">Start a conversation to create one.</p>
          </div>
        ) : (
          <>
            {visible.map((section) => (
              <div key={section.key} className="flex flex-col w-full">
                {section.key === "live" &&
                extraItems.length > 0 &&
                visibleSections.length === 0 ? null : section.prompt ? (
                  <ActionTurnHeader section={section} />
                ) : null}
                <div className="flex flex-col py-2">
                  <ActionItemList
                    items={section.items}
                    selectedGroupId={showingGroup ? (selectedGroup ?? null) : null}
                    selectedThreadEpisode={showingGroup ? null : (selectedEpisode ?? selected)}
                    episodeCount={(name) =>
                      snapshot.thread_episodes?.[name]?.length ??
                      threads.find((thread) => thread.name === name)?.episode_count ??
                      0
                    }
                    threadFlags={threadFlags}
                    onSelectGroup={pickGroup}
                    onSelectThread={pickThread}
                  />
                </div>
              </div>
            ))}
            {hasMore ? <div ref={sentinelRef} aria-hidden className="h-px" /> : null}
          </>
        )
      }
    >
      {showingGroup && currentGroup ? (
        <SegmentDetailList
          key={currentGroup.id}
          group={currentGroup}
          className="flex-1 min-h-0 overflow-auto px-4 py-4 [&>*]:shrink-0"
        />
      ) : current ? (
        <Detail
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
          onViewChange={setView}
        />
      ) : (
        <PanelEmpty title="No action selected">
          Actions include thoughts, worksets, and worker threads. Select a row to view its details.
        </PanelEmpty>
      )}
    </PanelSplit>
  );
}
