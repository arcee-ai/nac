// Live run state for the currently viewed session, driven by the SSE stream.
// This tracks a running flag, a human-readable activity line, an error, the
// usage the current run has accrued and a capped event log feeding the Events
// tab and the transcript typing indicator.

import { createStore } from "@/app/lib/store";
import { addTokenUsage, isActiveRun, maxBillableUsage, tokenUsageHasSpend } from "@/app/lib/format";
import { threadLogLine, toolCallFailed, type ThreadLogLine } from "@/app/lib/threadLog";
import type { StreamStatus } from "@/app/services/eventStream";
import type {
  ActiveRunSnapshot,
  AgentEvent,
  AssistantStreamDelta,
  SessionEventEnvelope,
  TokenUsage,
} from "@/app/types/api";

export type RuntimeEventKind =
  | "run"
  | "tool"
  | "thread"
  | "assistant"
  | "steering"
  | "compaction"
  | "error";

export interface RuntimeEvent {
  seq: number | null;
  kind: RuntimeEventKind;
  text: string;
  isError: boolean;
  ts: number;
  local: boolean;
}

export interface RuntimeThread {
  name: string;
  status: "running" | "finished";
  /** The active dispatch ended because the parent run was stopped. */
  cancelled: boolean;
  exitCode: number | null;
  isError: boolean;
  /**
   * The commands the thread has issued and their results, oldest first. The
   * card tails the last few lines of it and the side panel shows all of them.
   */
  log: ThreadLogLine[];
}

/**
 * How much of a thread's log is kept. Long enough to scroll back through in the
 * side panel, which is the only place that shows more than the newest lines.
 */
const THREAD_LOG_LIMIT = 200;

export interface RuntimeState {
  sessionId: string | null;
  running: boolean;
  activity: string;
  error: string | null;
  /**
   * The provider's own reason for refusing the current run's model call. The
   * terminal `run_failed` says only "run failed", so this is what turns the red
   * box into something the user can act on.
   */
  modelError: string | null;
  streamStatus: StreamStatus;
  events: RuntimeEvent[];
  threads: Record<string, RuntimeThread>;
  /**
   * Orchestrator tool-call ids that have already emitted `tool_call_finished`.
   * Used by the transcript so a workset badge can leave the pending state
   * before the DAG batch commits its tool messages.
   */
  finishedToolCalls: Record<string, true>;
  /** Prose the current model call has produced so far. */
  streamText: string;
  /** Reasoning the current model call has produced so far. */
  streamReasoning: string;
  /**
   * The buffers hold output that is already committed, so the next delta starts
   * a new call rather than appending to it. They are kept rather than cleared so
   * the transcript does not blink between the commit and the refetched snapshot;
   * the renderer drops whichever part the snapshot already covers.
   */
  streamSettled: boolean;
  /**
   * Prompt shown in the chat from the moment Send is pressed until the
   * snapshot (or active_run) catches up. Without this the model pill appears
   * first and jumps down when the user bubble finally lands.
   */
  optimisticUserPrompt: string | null;
  /**
   * What the current run has spent so far, summed from the usage events the
   * model calls emit. The snapshot only learns the run's usage once the run
   * ends, so this is the only account of an hour-long run in progress. It is
   * a delta over the snapshot totals, which stay fixed for the whole run.
   */
  runUsage: TokenUsage | null;
  /**
   * Session spend that only rises while this tab is open. Stop must not drop
   * the composer totals back to a zero snapshot; `run_started` only clears
   * the live delta above.
   */
  sessionSpend: TokenUsage | null;
  /**
   * Wall-clock start of the current run, kept after Stop so the composer
   * clock can keep showing elapsed instead of falling back to a previous
   * response's duration (or `--:--`).
   */
  runStartedAt: number | null;
  /** Frozen elapsed ms from the last run, used once live `startedAt` is gone. */
  lastElapsedMs: number | null;
  /**
   * Bumped by every event that could have touched the checkout. The Files panel
   * watches it to reread the diff while a run is still going, instead of
   * standing on whatever the checkout looked like when the panel opened.
   */
  workspaceEpoch: number;
  /**
   * Stop was painted; the HTTP cancel is still waiting on worker trees.
   * Composer Send and transcript Resend stay blocked, and a still-live
   * `active_run` on the snapshot must not snap the chrome back to running.
   */
  cancelArmed: boolean;
}

export const runtimeStore = createStore<RuntimeState>(
  {
    sessionId: null,
    running: false,
    activity: "",
    error: null,
    modelError: null,
    streamStatus: "idle",
    events: [],
    threads: {},
    finishedToolCalls: {},
    streamText: "",
    streamReasoning: "",
    streamSettled: false,
    optimisticUserPrompt: null,
    runUsage: null,
    sessionSpend: null,
    runStartedAt: null,
    lastElapsedMs: null,
    workspaceEpoch: 0,
    cancelArmed: false,
  },
  "runtime",
);

const { setState, getState, useStore } = runtimeStore;

const MAX_EVENTS = 300;

export function resetRuntime(sessionId: string | null): void {
  setState({
    sessionId,
    running: false,
    activity: "",
    error: null,
    modelError: null,
    streamStatus: sessionId ? "connecting" : "idle",
    events: [],
    threads: {},
    finishedToolCalls: {},
    streamText: "",
    streamReasoning: "",
    streamSettled: false,
    optimisticUserPrompt: null,
    runUsage: null,
    sessionSpend: null,
    runStartedAt: null,
    lastElapsedMs: null,
    workspaceEpoch: 0,
    cancelArmed: false,
  });
}

export function clearRuntimeThreads(): void {
  setState({ threads: {} });
}

/** Raise session spend to match a snapshot total; never lowers it. */
export function liftSessionSpend(persisted: TokenUsage | null | undefined): void {
  if (!tokenUsageHasSpend(persisted) || !persisted) return;
  setState((state) => {
    const next = maxBillableUsage(state.sessionSpend, persisted);
    if (
      next?.input_tokens === state.sessionSpend?.input_tokens &&
      next?.output_tokens === state.sessionSpend?.output_tokens &&
      next?.cache_read_tokens === state.sessionSpend?.cache_read_tokens &&
      next?.cache_write_tokens === state.sessionSpend?.cache_write_tokens &&
      (next?.cost?.total ?? 0) === (state.sessionSpend?.cost?.total ?? 0)
    ) {
      return {};
    }
    return { sessionSpend: next };
  });
}

/** Paint the user bubble immediately on submit; cleared once the transcript owns it. */
export function setOptimisticUserPrompt(prompt: string | null): void {
  setState({ optimisticUserPrompt: prompt });
}

/**
 * Fold one slice of live model output into the buffers. Only the orchestrator's
 * own output belongs in the chat — a thread's output is summarized on its card.
 */
export function applyAssistantDelta(delta: AssistantStreamDelta): void {
  if (delta.thread_name) return;
  setState((state) => {
    const base = state.streamSettled
      ? { streamText: "", streamReasoning: "" }
      : {
          streamText: state.streamText,
          streamReasoning: state.streamReasoning,
        };
    return {
      streamSettled: false,
      streamText: base.streamText + (delta.text ?? ""),
      streamReasoning: base.streamReasoning + (delta.reasoning ?? ""),
    };
  });
}

export function setStreamStatus(streamStatus: StreamStatus): void {
  setState({ streamStatus });
}

/**
 * Seed the running flag from a snapshot. Without this a reload or reconnect in
 * the middle of a run would show the session as idle until the next event, the
 * way the legacy UI did.
 */
export function syncRunFromSnapshot(activeRun: ActiveRunSnapshot | null | undefined): void {
  const running = isActiveRun(activeRun);
  const state = getState();
  if (state.cancelArmed) {
    // Optimistic cache already dropped `active_run`, so an idle snapshot here
    // does not mean cancel HTTP finished. Keep Stopping until finishRunCancel
    // or a terminal SSE event.
    return;
  }
  const runStartedAt = running && activeRun ? activeRun.started_at_epoch_ms : state.runStartedAt;
  if (state.running === running && state.runStartedAt === runStartedAt) return;
  setState({
    running,
    activity: running ? state.activity : "",
    runStartedAt: running ? runStartedAt : null,
    lastElapsedMs: running ? null : freezeElapsed(state),
  });
}

/** Record a client-side event so the Events tab shows the full interaction. */
export function pushLocalEvent(kind: RuntimeEventKind, text: string, isError = false): void {
  pushEvent({ seq: null, kind, text, isError, local: true });
}

function pushEvent(event: Omit<RuntimeEvent, "ts" | "local"> & { local?: boolean }) {
  setState((state) => {
    const events = state.events.length >= MAX_EVENTS ? state.events.slice(1) : state.events.slice();
    events.push({ ts: Date.now(), local: false, ...event });
    return { events };
  });
}

const emptyThread = (name: string): RuntimeThread => ({
  name,
  status: "running",
  cancelled: false,
  exitCode: null,
  isError: false,
  log: [],
});

function updateThread(name: string, patch: Partial<RuntimeThread>) {
  if (!name) return;
  setState((state) => ({
    threads: {
      ...state.threads,
      [name]: { ...(state.threads[name] ?? emptyThread(name)), ...patch },
    },
  }));
}

/** Records which threads a stop interrupted, before they are terminalized. */
function flagCancelledThreads(
  threads: Record<string, RuntimeThread>,
): Record<string, RuntimeThread> {
  return Object.fromEntries(
    Object.entries(threads).map(([name, thread]) => [
      name,
      thread.status === "running" ? { ...thread, cancelled: true } : thread,
    ]),
  );
}

function elapsedSince(startedAt: number | null | undefined): number | null {
  if (startedAt == null || startedAt <= 0) return null;
  return Math.max(0, Date.now() - startedAt);
}

function freezeElapsed(
  state: Pick<RuntimeState, "runStartedAt" | "lastElapsedMs">,
  extra?: number | null,
): number | null {
  const candidates = [elapsedSince(state.runStartedAt), state.lastElapsedMs, extra].filter(
    (value): value is number => value != null,
  );
  return candidates.length ? Math.max(...candidates) : null;
}

/**
 * Paint Stopping immediately. The HTTP cancel still waits for worker trees;
 * `finishRunCancel` and SSE `run_cancelled` clear the arm without flipping
 * running back on.
 */
export function requestRunCancel(): RuntimeState {
  const previous = getState();
  if (!previous.running) {
    return previous;
  }
  setState((state) => ({
    running: false,
    activity: "",
    error: null,
    modelError: null,
    streamSettled: true,
    cancelArmed: true,
    lastElapsedMs: freezeElapsed(state),
    runStartedAt: null,
    threads: terminalizeThreads(flagCancelledThreads(state.threads)),
  }));
  return previous;
}

/** Restore the pre-Stop snapshot when the cancel request itself fails. */
export function restoreRunCancel(previous: RuntimeState): void {
  setState({
    running: previous.running,
    activity: previous.activity,
    error: previous.error,
    modelError: previous.modelError,
    streamSettled: previous.streamSettled,
    threads: previous.threads,
    cancelArmed: previous.cancelArmed,
    lastElapsedMs: previous.lastElapsedMs,
  });
}

/**
 * Cancel HTTP returned: worker trees are down, so Send/Resend are honest again.
 * SSE `run_cancelled` does the same; either may win.
 */
export function finishRunCancel(): void {
  setState((state) => ({
    cancelArmed: false,
    running: false,
    activity: "",
    lastElapsedMs: freezeElapsed(state),
    runStartedAt: null,
  }));
}

/** Identifies the log lines whose events carry no id of their own. */
let logSequence = 0;

/**
 * Append what an event says about a thread to that thread's log, dropping
 * whatever has scrolled out of reach.
 */
function pushThreadLog(name: string | null | undefined, event: AgentEvent) {
  if (!name) return;
  logSequence += 1;
  const line = threadLogLine(event, logSequence);
  if (!line) return;
  setState((state) => {
    const thread = state.threads[name] ?? emptyThread(name);
    const log = [...thread.log, line].slice(-THREAD_LOG_LIMIT);
    return { threads: { ...state.threads, [name]: { ...thread, log } } };
  });
}

/** Marks every still-running thread finished once the run itself is over. */
function terminalizeThreads(threads: Record<string, RuntimeThread>): Record<string, RuntimeThread> {
  return Object.fromEntries(
    Object.entries(threads).map(([name, thread]) => [
      name,
      thread.status === "running"
        ? { ...thread, status: "finished", exitCode: null, isError: false }
        : thread,
    ]),
  );
}

export type RefreshKind = "none" | "messages" | "snapshot" | "replace-snapshot";

/**
 * Classify one envelope by the smallest canonical projection it invalidates.
 * Runtime state is updated synchronously before the caller starts that read.
 */
export function applyEnvelope(envelope: SessionEventEnvelope): RefreshKind {
  const seq = envelope.sequence_id;
  const event = envelope.event;
  switch (event.type) {
    case "run_started":
      setState({
        running: true,
        // Keep the chat chrome as a plain live ModelMessage (pill + model);
        // tool/thread events fill activity once there is something to name.
        activity: "",
        error: null,
        modelError: null,
        streamText: "",
        streamReasoning: "",
        streamSettled: false,
        // Only this run's live delta resets. Session spend lives on the
        // snapshot, including unattributed usage from cancelled or rewound turns.
        runUsage: null,
        finishedToolCalls: {},
        runStartedAt: event.started_at_epoch_ms,
        lastElapsedMs: null,
        cancelArmed: false,
        // Stop left workers as finished+cancelled. A follow-up that reuses a
        // name would inherit that flag and keep the new card on Close until
        // thread_started, so this run starts with an empty live map.
        threads: {},
      });
      pushEvent({
        seq,
        kind: "run",
        text: `Run started: ${event.prompt_preview}`,
        isError: false,
      });
      return "snapshot";
    case "run_completed":
      // The run's own answer is the authoritative version of whatever the
      // stream last held, so it takes over until the snapshot lands. The run
      // outlives every worker it dispatched, so a thread still marked running
      // here only means its own finish event never arrived.
      setState((state) => ({
        running: false,
        activity: "",
        streamText: event.response,
        streamReasoning: "",
        streamSettled: true,
        cancelArmed: false,
        lastElapsedMs: freezeElapsed(state, event.duration_ms ?? null),
        runStartedAt: null,
        threads: terminalizeThreads(state.threads),
      }));
      pushEvent({ seq, kind: "run", text: "Run completed", isError: false });
      return "snapshot";
    case "run_failed": {
      // The terminal message is a constant; a provider refusal seen earlier in
      // this run explains the same failure and says something useful.
      const message = getState().modelError ?? event.message;
      setState((state) => ({
        running: false,
        activity: "",
        error: message,
        streamSettled: true,
        cancelArmed: false,
        lastElapsedMs: freezeElapsed(state),
        runStartedAt: null,
        threads: terminalizeThreads(state.threads),
      }));
      pushEvent({ seq, kind: "error", text: message, isError: true });
      return "snapshot";
    }
    case "run_cancelled":
      // Stopping is what the user asked for: the transcript already carries the
      // cancellation marker, so a red box would only contradict it. Terminalize
      // only live workers; completed cards and their logs remain useful history.
      setState((state) => ({
        running: false,
        activity: "",
        error: null,
        modelError: null,
        streamSettled: true,
        cancelArmed: false,
        lastElapsedMs: freezeElapsed(state),
        runStartedAt: null,
        threads: terminalizeThreads(flagCancelledThreads(state.threads)),
      }));
      pushEvent({ seq, kind: "run", text: "Run cancelled", isError: false });
      return "snapshot";
    case "snapshot_saved":
      return "snapshot";
    case "transcript_appended":
      // A message was committed, so the buffers now describe the past.
      setState({ streamSettled: true });
      return "messages";
    case "transcript_reverted":
      // The messages the buffers were catching up to no longer exist, so the
      // leftovers would be replayed against a transcript that never had them.
      // The live threads went with those messages, and a rerun that dispatches
      // the same name again would otherwise inherit the discarded run's log.
      setState({
        streamSettled: true,
        streamText: "",
        streamReasoning: "",
        threads: {},
        finishedToolCalls: {},
      });
      return "replace-snapshot";
    case "agent":
      return applyAgent(seq, event.event);
    default:
      return "none";
  }
}

function applyAgent(seq: number, event: AgentEvent): RefreshKind {
  switch (event.type) {
    case "tool_call_started":
      setState({ activity: `Tool: ${event.name}` });
      // A thread's own calls also feed its card in the chat and its tail in the
      // side panel, which is why they are kept per thread as well as below.
      pushThreadLog(event.thread_name, event);
      pushEvent({
        seq,
        kind: "tool",
        text: `▶ ${event.name}(${event.args_preview})`,
        isError: false,
      });
      return "none";
    case "thread_log":
      // Deliberately not in the log below: the worker prints these as it works,
      // and at that rate they would push everything else out of the events tab.
      pushThreadLog(event.name, event);
      return "none";
    case "mcp_server_skipped":
      // A configured server the worker could not load; show it in the thread
      // log so the missing tools are explained rather than silent.
      pushThreadLog(event.thread_name, event);
      return "none";
    case "tool_call_finished": {
      const failed = toolCallFailed(event);
      pushThreadLog(event.thread_name, event);
      pushEvent({
        seq,
        kind: "tool",
        text: `${failed ? "✕" : "✓"} ${event.name}: ${event.content_preview}`,
        isError: failed,
      });
      const orchestratorCall = !event.thread_name;
      setState((state) => ({
        workspaceEpoch: state.workspaceEpoch + 1,
        ...(orchestratorCall
          ? { finishedToolCalls: { ...state.finishedToolCalls, [event.call_id]: true as const } }
          : {}),
      }));
      // Worksets land in SQLite as soon as `workset_define` returns, but the
      // tool message waits for the rest of the DAG batch. Refetch so the
      // panel and the badge see the saved plan without waiting on threads.
      return event.name === "workset_define" ? "snapshot" : "none";
    }
    case "token_usage_updated":
      setState((state) => ({
        runUsage: addTokenUsage(
          state.runUsage,
          event.usage,
          // The gauge measures the orchestrator's own context window, so a
          // worker's reading of its private one must not stand in for it.
          event.thread_name ? (state.runUsage?.total_tokens ?? 0) : event.usage.total_tokens,
        ),
        sessionSpend: addTokenUsage(
          state.sessionSpend,
          event.usage,
          event.thread_name
            ? (state.sessionSpend?.total_tokens ?? 0)
            : event.usage.total_tokens || (state.sessionSpend?.total_tokens ?? 0),
        ),
      }));
      return "none";
    case "thread_started":
      // The action is not carried here: event sanitization replaces it with a
      // placeholder. The task text comes from the orchestrator's tool call.
      setState({ activity: `Thread ${event.name} dispatched` });
      pushEvent({
        seq,
        kind: "thread",
        text: `⌥ thread "${event.name}" dispatched`,
        isError: false,
      });
      updateThread(event.name, {
        status: "running",
        cancelled: false,
        exitCode: null,
        isError: false,
        // A name can be dispatched again, and the previous run's commands are
        // not this one's.
        log: [],
      });
      // A re-dispatched name already has a persisted episode ending in
      // thread_finished, and the transcript lines episodes up with dispatch
      // cards newest-first. Until the refetch brings this dispatch's own
      // thread_started into that window, the new card inherits the previous
      // episode's finish and reads as done while the worker is still running.
      return "snapshot";
    case "thread_finished":
      pushEvent({
        seq,
        kind: "thread",
        text: `⌦ thread "${event.name}" (exit ${event.exit_code ?? "?"})`,
        isError: Boolean(event.exit_code),
      });
      updateThread(event.name, {
        status: "finished",
        exitCode: event.exit_code,
        isError: Boolean(event.exit_code),
      });
      // The dispatch's episode is written as it ends, and the snapshot is the
      // only thing that carries episodes. Waiting for the run to finish would
      // hold every one of them back until the whole orchestration was over.
      return "snapshot";
    case "assistant_message":
      setState({ activity: "" });
      pushEvent({
        seq,
        kind: "assistant",
        text: "New assistant message",
        isError: false,
      });
      return "none";
    case "thread_steering_queued":
    case "thread_steering_delivered":
    case "thread_steering_expired":
      pushEvent({
        seq,
        kind: "steering",
        text: `${steeringVerb(event.type)} → ${event.name}: ${event.instruction_preview}`,
        isError: event.type === "thread_steering_expired",
      });
      return "none";
    case "orchestrator_steering_queued":
    case "orchestrator_steering_delivered":
    case "orchestrator_steering_expired":
      pushEvent({
        seq,
        kind: "steering",
        text: `${steeringVerb(event.type)} → orchestrator: ${event.instruction_preview}`,
        isError: event.type === "orchestrator_steering_expired",
      });
      return "none";
    case "orchestrator_compaction_started":
      setState({ activity: "Compacting context…" });
      pushEvent({
        seq,
        kind: "compaction",
        text: `Compaction started (${event.reason})`,
        isError: false,
      });
      return "none";
    case "orchestrator_compaction_completed":
      setState({ activity: "" });
      pushEvent({
        seq,
        kind: "compaction",
        text: "Compaction completed",
        isError: false,
      });
      return "replace-snapshot";
    case "orchestrator_compaction_skipped":
      setState({ activity: "" });
      pushEvent({
        seq,
        kind: "compaction",
        text: `Compaction skipped: ${event.cause}`,
        isError: false,
      });
      return "none";
    case "orchestrator_compaction_failed":
      setState({ activity: "" });
      pushEvent({
        seq,
        kind: "compaction",
        text: `Compaction failed: ${event.failure}`,
        isError: true,
      });
      return "none";
    case "error":
      setState({ error: event.message });
      pushEvent({ seq, kind: "error", text: event.message, isError: true });
      return "none";
    case "model_error":
      setState({ error: event.message, modelError: event.message });
      pushEvent({ seq, kind: "error", text: event.message, isError: true });
      return "none";
    default:
      return "none";
  }
}

function steeringVerb(type: string): string {
  if (type.endsWith("queued")) return "Steering queued";
  if (type.endsWith("delivered")) return "Steering delivered";
  return "Steering expired";
}

export const useRunning = (sessionId: string | null) =>
  useStore((state) => state.sessionId === sessionId && state.running);
export const useCancelArmed = (sessionId: string | null) =>
  useStore((state) => state.sessionId === sessionId && state.cancelArmed);
export const useActivity = () => useStore((s) => s.activity);
export const useRunError = () => useStore((s) => s.error);
export const useLiveEvents = () => useStore((s) => s.events);
export const useStreamStatus = () => useStore((s) => s.streamStatus);
export const useLiveThreads = () => useStore((s) => s.threads);
export const useFinishedToolCalls = () => useStore((s) => s.finishedToolCalls);
export const useRunUsage = () => useStore((s) => s.runUsage);
export const useSessionSpend = () => useStore((s) => s.sessionSpend);
export const useRunStartedAt = () => useStore((s) => s.runStartedAt);
export const useLastElapsedMs = () => useStore((s) => s.lastElapsedMs);
export const useWorkspaceEpoch = () => useStore((s) => s.workspaceEpoch);
export const useStreamText = () => useStore((s) => s.streamText);
export const useStreamReasoning = () => useStore((s) => s.streamReasoning);
export const useOptimisticUserPrompt = () => useStore((s) => s.optimisticUserPrompt);
export { getState as getRuntimeState };
