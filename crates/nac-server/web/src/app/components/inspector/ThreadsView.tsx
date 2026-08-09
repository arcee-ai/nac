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
  DropdownContent,
  Icon,
  IconName,
  Loader,
  LoaderSize,
  LoaderVariant,
  Separator,
  Switch,
} from "@/app/atoms";
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
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useCancelThreadDispatch,
  useSteerThreadDispatch,
  useUpdateRespondLive,
} from "@/app/services/queries";
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
  ActiveThreadDispatchSnapshot,
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
const ToolCallView = memo(function ToolCallView({ entry }: { entry: ToolCallEntry }) {
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
const LogEntryView = memo(function LogEntryView({ entry }: { entry: LogEntry }) {
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

  return (
    <div className="flex flex-col items-start w-full">
      <button
        type="button"
        className="group flex items-center gap-2 py-2 pl-3 pr-2 rounded-[4px] w-full btn-ghost"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Icon
          iconName={expanded ? IconName.Down : IconName.Right}
          size={16}
          className="shrink-0 text-basic-muted"
        />
        <span className="shrink-0 label-micro text-basic-primary">
          {`Episode ${index + 1}`}
        </span>
        <span className="flex-1 min-w-0 label-micro text-basic-secondary truncate">
          {episode.action}
        </span>
      </button>
      <DropdownContent isOpen={expanded} className="w-full">
        <div className="flex flex-col gap-4 pl-3 pr-2 py-3">
          <Markdown className="text-basic-secondary">{episode.action}</Markdown>
          <Separator />
          <Markdown className="text-basic-secondary">{episode.content}</Markdown>
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
  const stuck = useRef(true);
  const dragging = useRef(false);
  const ratio = useThreadLogHeightRatio();
  const entries = useMemo(() => groupThreadLog(lines), [lines]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stuck.current) return;
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
      <div
        ref={scrollRef}
        className="flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0 bg-elevation-level-0-5 border-t border-muted"
        onScroll={() => {
          const element = scrollRef.current;
          if (element) {
            stuck.current = distanceFromBottom(element) <= STICK_TOLERANCE_PX;
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
    </div>
  );
}

function Detail({
  thread,
  episodes,
  events,
  liveLog,
  running,
  sessionId,
  dispatch,
  steeringStatus,
}: {
  thread: ThreadSnapshot;
  episodes: EpisodeSnapshot[];
  /** Commands the store has persisted for this thread. */
  events: AgentEvent[] | undefined;
  /** The same commands as the stream reported them, plus whatever came after. */
  liveLog: ThreadLogLine[];
  running: boolean;
  sessionId: string;
  /** Exact snapshot identity selected from a card/list row. */
  dispatch: ActiveThreadDispatchSnapshot | null;
  steeringStatus: "queued" | "delivered" | "expired" | null;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const [instruction, setInstruction] = useState("");
  const [localSteeringStatus, setLocalSteeringStatus] = useState<
    "queued" | "delivered" | "expired" | "error" | null
  >(null);
  const cancelDispatch = useCancelThreadDispatch();
  const steerDispatch = useSteerThreadDispatch();
  const toast = useToast();
  const log = useMemo(
    () => mergeThreadLog(persistedThreadLog(events), liveLog),
    [events, liveLog],
  );
  const dispatchStatus = dispatch?.status ?? null;
  const terminal =
    dispatchStatus === "completed" ||
    dispatchStatus === "failed" ||
    dispatchStatus === "cancelled" ||
    (cancelDispatch.isSuccess && cancelDispatch.data.terminal);
  const acceptedCancellation =
    cancelDispatch.isSuccess &&
    !cancelDispatch.data.terminal &&
    cancelDispatch.variables.dispatch.dispatch_id === dispatch?.dispatch_id &&
    cancelDispatch.variables.dispatch.run_id === dispatch?.run_id;
  const cancelling =
    dispatchStatus === "cancelling" || cancelDispatch.isPending || acceptedCancellation;
  const actionable = dispatch != null && !terminal;
  const shownSteeringStatus = steeringStatus ?? localSteeringStatus;

  return (
    <div ref={paneRef} className="flex flex-col flex-1 min-h-0 min-w-0">
      <div className="flex flex-wrap items-center gap-[10px] min-h-10 px-4 py-2 shrink-0 border-b border-muted bg-elevation-level-1">
        <span className="label-micro text-btn-secondary truncate">{thread.name}</span>
        {running ? <Loader size={LoaderSize.Micro} variant={LoaderVariant.Neutral} /> : null}
        <span className="flex-1 min-w-0 code code-small text-basic-muted truncate">
          {thread.updated_at}
        </span>
        {dispatchStatus ? (
          <span role="status" className="shrink-0 label-micro text-basic-muted">
            {cancelling
              ? "Cancelling"
              : cancelDispatch.isSuccess && cancelDispatch.data.terminal_status === "cancelled"
                ? "Cancelled"
                : dispatchStatus === "cancelled"
                  ? "Cancelled"
                  : dispatchStatus.replace("_", " ")}
          </span>
        ) : null}
        <span className="shrink-0 code code-small text-basic-muted">
          {thread.episode_count} ep
        </span>
      </div>

      {dispatch ? (
        <div className="flex flex-col gap-2 p-3 border-b border-muted bg-elevation-level-0-5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 label-small"
              disabled={!actionable || cancelling}
              aria-label={`Cancel dispatch ${thread.name}`}
              onClick={() => {
                void cancelDispatch
                  .mutateAsync({ id: sessionId, dispatch })
                  .catch((error) => {
                    toast.error(
                      `Dispatch was not cancelled; refreshed exact state: ${errorMessage(error)}`,
                    );
                  });
              }}
            >
              {cancelling
                ? "Cancelling…"
                : dispatchStatus === "cancelled" ||
                    cancelDispatch.data?.terminal_status === "cancelled"
                  ? "Cancelled"
                  : "Cancel dispatch"}
            </button>
            <span className="code code-micro text-basic-muted break-all">
              {`Run ${dispatch.run_id} · dispatch ${dispatch.dispatch_id}`}
            </span>
          </div>
          <form
            className="flex flex-col sm:flex-row gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = instruction.trim();
              if (!value || !actionable || cancelling) return;
              setLocalSteeringStatus(null);
              void steerDispatch
                .mutateAsync({ id: sessionId, dispatch, instruction: value })
                .then(() => {
                  setInstruction("");
                  setLocalSteeringStatus("queued");
                })
                .catch((error) => {
                  setLocalSteeringStatus("error");
                  toast.error(`Steering was not queued: ${errorMessage(error)}`);
                });
            }}
          >
            <label className="sr-only" htmlFor={`steer-${dispatch.dispatch_id}`}>
              Steer selected dispatch
            </label>
            <input
              id={`steer-${dispatch.dispatch_id}`}
              className="min-w-0 flex-1 rounded-[4px] border border-muted bg-elevation-level-1 px-3 py-2 text-small"
              value={instruction}
              disabled={!actionable || cancelling || steerDispatch.isPending}
              placeholder="Steer this exact thread dispatch"
              onChange={(event) => setInstruction(event.target.value)}
            />
            <button
              type="submit"
              className="btn-secondary px-3 py-2 label-small"
              disabled={
                !actionable ||
                cancelling ||
                steerDispatch.isPending ||
                !instruction.trim()
              }
            >
              {steerDispatch.isPending ? "Sending…" : "Send steering"}
            </button>
          </form>
          {shownSteeringStatus ? (
            <span role="status" className={cn(
              "label-micro",
              shownSteeringStatus === "error" || shownSteeringStatus === "expired"
                ? "text-error-primary"
                : "text-basic-muted",
            )}>
              {`Steering ${shownSteeringStatus}`}
            </span>
          ) : null}
          <span className="label-micro text-basic-muted">
            Delete thread history is a separate action and is unavailable while this dispatch is active or cancelling.
          </span>
        </div>
      ) : null}

      {episodes.length ? (
        <div className="flex flex-col flex-1 min-h-0 overflow-auto p-4 border-t border-muted [&>*]:shrink-0">
          {episodes.map((episode, index) => (
            <EpisodeTab key={episode.id} episode={episode} index={index} />
          ))}
        </div>
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
  selectedEpisode = null,
  onSelect,
}: {
  snapshot: SessionSnapshotResponse | null;
  /** Thread the chat pointed at, if any. */
  selected: string | null;
  /** Exact dispatch key selected by a transcript card, if available. */
  selectedEpisode?: string | null;
  onSelect: (name: string, episodeKey?: string | null) => void;
}) {
  const liveThreads = useLiveThreads();
  const updateRespondLive = useUpdateRespondLive();
  const toast = useToast();
  const threads = useMemo(() => snapshot?.threads ?? [], [snapshot]);
  const activeThreads = snapshot?.active_threads;
  const activeDispatches = snapshot?.active_thread_dispatches;
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
    const projectedNames = new Set<string>();
    for (const dispatch of activeDispatches ?? []) {
      projectedNames.add(dispatch.thread_name);
      if (dispatch.status === "running") running.add(dispatch.thread_name);
      else if (
        dispatch.status === "accepted" ||
        dispatch.status === "dependency_pending" ||
        dispatch.status === "cancelling"
      ) {
        pending.add(dispatch.thread_name);
      }
    }
    // Compatibility snapshots exposed names only. Never spread this fallback
    // across historical cards; this view has one newest row per retained name.
    for (const name of activeThreads ?? []) {
      if (!projectedNames.has(name)) pending.add(name);
    }
    for (const [name, thread] of Object.entries(liveThreads)) {
      if (thread.status === "running") {
        running.add(name);
        pending.delete(name);
      } else if (thread.status === "dependency_pending" || thread.status === "accepted") {
        pending.add(name);
        running.delete(name);
      } else {
        running.delete(name);
        pending.delete(name);
      }
    }
    return { runningNames: running, pendingNames: pending };
  }, [activeThreads, activeDispatches, liveThreads]);

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

  const exactActiveNames = new Set((activeDispatches ?? []).map((item) => item.thread_name));
  const selectable = ordered.filter(
    (thread) => !pendingNames.has(thread.name) || exactActiveNames.has(thread.name),
  );
  const current =
    selectable.find((thread) => thread.name === selected) ??
    selectable[0] ??
    null;
  // Actions are intentionally unavailable without an exact selected dispatch
  // identity. In particular, a reused name never targets whichever run happens
  // to be current.
  const selectedDispatch =
    activeDispatches?.find(
      (dispatch) =>
        dispatch.dispatch_id === selectedEpisode &&
        dispatch.thread_name === current?.name,
    ) ?? null;
  const liveCandidate = current ? liveThreads[current.name] : undefined;
  // A historical selection must not inherit the replacement's name-level log.
  // Compatibility name-only live state remains available only without an exact
  // card selection (the newest list row).
  const live = selectedDispatch
    ? liveCandidate?.runId === selectedDispatch.run_id &&
      liveCandidate.dispatchId === selectedDispatch.dispatch_id &&
      liveCandidate.toolCallId === selectedDispatch.tool_call_id
      ? liveCandidate
      : undefined
    : selectedEpisode == null
      ? liveCandidate
      : undefined;
  const selectedSteering = selectedDispatch
    ? (snapshot.thread_steering ?? [])
        .filter((record) => record.dispatch_id === selectedDispatch.dispatch_id)
        .at(-1)
    : undefined;
  const selectedSteeringStatus = selectedSteering
    ? selectedSteering.status === "claimed"
      ? "queued"
      : selectedSteering.status
    : null;

  return (
    <PanelSplit
      list={
        <>
          <div className="flex items-center justify-between gap-3 border-b border-basic-translucent p-3">
            <div className="min-w-0">
              <div className="label-small text-basic-primary">Respond live</div>
              <div className="label-micro text-basic-muted">
                Continue this turn as its threads finish
              </div>
            </div>
            <Switch
              aria-label="Respond live"
              checked={snapshot.respond_live.enabled}
              disabled={updateRespondLive.isPending}
              onChange={(enabled) => {
                void updateRespondLive
                  .mutateAsync({
                    id: sessionId,
                    enabled,
                    expected_version: snapshot.respond_live.version,
                  })
                  .catch((error) => {
                    toast.error(
                      `Respond live was not changed: ${errorMessage(error)}`,
                    );
                  });
              }}
            />
          </div>
          {ordered.length === 0 ? (
            <div className="p-1 label-micro text-basic-muted">
              No threads yet for this session.
            </div>
          ) : (
          ordered.map((thread) => {
            const pending = pendingNames.has(thread.name);
            const running = runningNames.has(thread.name);
            const errored = liveThreads[thread.name]?.isError;
            const exact = activeDispatches?.find(
              (dispatch) => dispatch.thread_name === thread.name,
            );
            const disabled = pending && !exact;
            return (
              <PanelRow
                key={thread.name}
                label={thread.name}
                active={thread.name === current?.name}
                disabled={disabled}
                title={disabled ? "Waiting on source threads" : undefined}
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
                onClick={() => onSelect(thread.name, exact?.dispatch_id ?? null)}
              />
            );
          })
        )}
        </>
      }
    >
      {current ? (
        <Detail
          key={selectedEpisode ?? current.name}
          thread={current}
          episodes={snapshot.thread_episodes?.[current.name] ?? []}
          events={snapshot.thread_events?.[current.name]}
          liveLog={live?.log ?? []}
          running={
            selectedDispatch
              ? selectedDispatch.status === "running"
              : selectedEpisode == null && runningNames.has(current.name)
          }
          sessionId={sessionId}
          dispatch={selectedDispatch}
          steeringStatus={selectedSteeringStatus}
        />
      ) : (
        <PanelEmpty>No threads yet for this session.</PanelEmpty>
      )}
    </PanelSplit>
  );
}
