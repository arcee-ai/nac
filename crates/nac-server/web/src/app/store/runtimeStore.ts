// Live run state for the currently viewed session, driven by the SSE stream.
// The backend streams event- and message-level updates (no token deltas), so
// this tracks a running flag, a human-readable activity line, an error and a
// capped event log feeding the Events tab and the transcript typing indicator.

import { createStore } from "@/app/lib/store";
import { isActiveRun } from "@/app/lib/format";
import { threadLogLine, type ThreadLogLine } from "@/app/lib/threadLog";
import type { StreamStatus } from "@/app/services/eventStream";
import type {
  ActiveRunSnapshot,
  AgentEvent,
  AssistantStreamDelta,
  SessionEventEnvelope,
} from "@/app/types/api";

export type RuntimeEventKind =
  "run" | "tool" | "thread" | "assistant" | "steering" | "compaction" | "error";

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
  action: string;
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

interface RuntimeState {
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
    streamText: "",
    streamReasoning: "",
    streamSettled: false,
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
    streamText: "",
    streamReasoning: "",
    streamSettled: false,
  });
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
export function syncRunFromSnapshot(
  activeRun: ActiveRunSnapshot | null | undefined,
): void {
  const running = isActiveRun(activeRun);
  const state = getState();
  if (state.running === running) return;
  setState({ running, activity: running ? state.activity : "" });
}

/** Record a client-side event so the Events tab shows the full interaction. */
export function pushLocalEvent(
  kind: RuntimeEventKind,
  text: string,
  isError = false,
): void {
  pushEvent({ seq: null, kind, text, isError, local: true });
}

function pushEvent(
  event: Omit<RuntimeEvent, "ts" | "local"> & { local?: boolean },
) {
  setState((state) => {
    const events =
      state.events.length >= MAX_EVENTS
        ? state.events.slice(1)
        : state.events.slice();
    events.push({ ts: Date.now(), local: false, ...event });
    return { events };
  });
}

const emptyThread = (name: string): RuntimeThread => ({
  name,
  status: "running",
  action: "",
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

/** Identifies the log lines whose events carry no id of their own. */
let logSequence = 0;

/**
 * Append what an event says about a thread to that thread's log, dropping
 * whatever has scrolled out of reach.
 */
function pushThreadLog(name: string | undefined, event: AgentEvent) {
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

/**
 * Classify one envelope. Returns true when the canonical snapshot should be
 * re-fetched, because the stream carries whole-message granularity and the
 * snapshot is what reconciles ordering.
 */
export function applyEnvelope(envelope: SessionEventEnvelope): boolean {
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
      });
      pushEvent({
        seq,
        kind: "run",
        text: `Run started: ${event.prompt_preview}`,
        isError: false,
      });
      return true;
    case "run_completed":
      // The run's own answer is the authoritative version of whatever the
      // stream last held, so it takes over until the snapshot lands.
      setState({
        running: false,
        activity: "",
        streamText: event.response,
        streamReasoning: "",
        streamSettled: true,
      });
      pushEvent({ seq, kind: "run", text: "Run completed", isError: false });
      return true;
    case "run_failed": {
      // The terminal message is a constant; a provider refusal seen earlier in
      // this run explains the same failure and says something useful.
      const message = getState().modelError ?? event.message;
      setState({
        running: false,
        activity: "",
        error: message,
        streamSettled: true,
      });
      pushEvent({ seq, kind: "error", text: message, isError: true });
      return true;
    }
    case "run_cancelled":
      // Stopping is what the user asked for: the transcript already carries the
      // cancellation marker, so a red box would only contradict it. A provider
      // refusal seen earlier in this run is moot now for the same reason.
      setState({
        running: false,
        activity: "",
        error: null,
        modelError: null,
        streamSettled: true,
      });
      pushEvent({ seq, kind: "run", text: "Run cancelled", isError: false });
      return true;
    case "snapshot_saved":
      return true;
    case "transcript_appended":
      // A message was committed, so the buffers now describe the past.
      setState({ streamSettled: true });
      return true;
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
      });
      return true;
    case "agent":
      return applyAgent(seq, event.event);
    default:
      return false;
  }
}

function applyAgent(seq: number, event: AgentEvent): boolean {
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
      return false;
    case "thread_log":
      // Deliberately not in the log below: the worker prints these as it works,
      // and at that rate they would push everything else out of the events tab.
      pushThreadLog(event.name, event);
      return false;
    case "tool_call_finished":
      pushThreadLog(event.thread_name, event);
      pushEvent({
        seq,
        kind: "tool",
        text: `${event.is_error ? "✕" : "✓"} ${event.name}: ${event.content_preview}`,
        isError: event.is_error,
      });
      return false;
    case "thread_started":
      setState({ activity: `Thread ${event.name}: ${event.action}` });
      pushEvent({
        seq,
        kind: "thread",
        text: `⌥ thread "${event.name}" — ${event.action}`,
        isError: false,
      });
      updateThread(event.name, {
        status: "running",
        action: event.action,
        exitCode: null,
        isError: false,
        // A name can be dispatched again, and the previous run's commands are
        // not this one's.
        log: [],
      });
      return false;
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
      return false;
    case "assistant_message":
      setState({ activity: "" });
      pushEvent({
        seq,
        kind: "assistant",
        text: "New assistant message",
        isError: false,
      });
      return true;
    case "thread_steering_queued":
    case "thread_steering_delivered":
    case "thread_steering_expired":
      pushEvent({
        seq,
        kind: "steering",
        text: `${steeringVerb(event.type)} → ${event.name}: ${event.instruction_preview}`,
        isError: event.type === "thread_steering_expired",
      });
      return false;
    case "orchestrator_steering_queued":
    case "orchestrator_steering_delivered":
    case "orchestrator_steering_expired":
      pushEvent({
        seq,
        kind: "steering",
        text: `${steeringVerb(event.type)} → orchestrator: ${event.instruction_preview}`,
        isError: event.type === "orchestrator_steering_expired",
      });
      return false;
    case "orchestrator_compaction_started":
      setState({ activity: "Compacting context…" });
      pushEvent({
        seq,
        kind: "compaction",
        text: `Compaction started (${event.reason})`,
        isError: false,
      });
      return false;
    case "orchestrator_compaction_completed":
      setState({ activity: "" });
      pushEvent({
        seq,
        kind: "compaction",
        text: "Compaction completed",
        isError: false,
      });
      return true;
    case "orchestrator_compaction_skipped":
      setState({ activity: "" });
      pushEvent({
        seq,
        kind: "compaction",
        text: `Compaction skipped: ${event.cause}`,
        isError: false,
      });
      return false;
    case "orchestrator_compaction_failed":
      setState({ activity: "" });
      pushEvent({
        seq,
        kind: "compaction",
        text: `Compaction failed: ${event.failure}`,
        isError: true,
      });
      return false;
    case "error":
      setState({ error: event.message });
      pushEvent({ seq, kind: "error", text: event.message, isError: true });
      return false;
    case "model_error":
      setState({ error: event.message, modelError: event.message });
      pushEvent({ seq, kind: "error", text: event.message, isError: true });
      return false;
    default:
      return false;
  }
}

function steeringVerb(type: string): string {
  if (type.endsWith("queued")) return "Steering queued";
  if (type.endsWith("delivered")) return "Steering delivered";
  return "Steering expired";
}

export const useRunning = () => useStore((s) => s.running);
export const useActivity = () => useStore((s) => s.activity);
export const useRunError = () => useStore((s) => s.error);
export const useLiveEvents = () => useStore((s) => s.events);
export const useStreamStatus = () => useStore((s) => s.streamStatus);
export const useLiveThreads = () => useStore((s) => s.threads);
export const useStreamText = () => useStore((s) => s.streamText);
export const useStreamReasoning = () => useStore((s) => s.streamReasoning);
export { getState as getRuntimeState };
