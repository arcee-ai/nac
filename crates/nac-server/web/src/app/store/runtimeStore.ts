// Live run state for the currently viewed session, driven by the SSE stream.
// Sequenced lifecycle events reconcile canonical state; unsequenced token
// deltas are accepted only when their run and provider-call ownership matches.

import { createStore } from "@/app/lib/store";
import { displayPromptFromMessageText, isActiveRun } from "@/app/lib/format";
import { threadLogLine, type ThreadLogLine } from "@/app/lib/threadLog";
import type { StreamStatus } from "@/app/services/eventStream";
import type {
  ActiveRunSnapshot,
  ActiveThreadDispatchSnapshot,
  AgentEvent,
  BufferedThreadCompletionSnapshot,
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

export type GuidanceDisplayStatus =
  "queued" | "delivered" | "expired" | "error";

export interface RuntimeGuidance {
  steeringId: number | null;
  runId: string;
  status: GuidanceDisplayStatus;
  message?: string;
}

export interface RuntimeThread {
  name: string;
  status: "accepted" | "dependency_pending" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
  deliveryStatus?: "available" | "delivered" | null;
  runId: string | null;
  dispatchId: string | null;
  toolCallId: string | null;
  action: string;
  exitCode: number | null;
  isError: boolean;
  /**
   * The commands the thread has issued and their results, oldest first. The
   * card tails the last few lines of it and the side panel shows all of them.
   */
  log: ThreadLogLine[];
  /** Monotonic local order used only for newest-name compatibility. */
  updatedAt?: number;
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
  /** Run and provider-call ownership for the live-only delta buffers. */
  streamRunId: string | null;
  streamModelCallId: string | null;
  /** Calls already committed/discarded; late chunks from them stay rejected. */
  retiredModelCallIds: string[];
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
  /** Suppresses a stale snapshot's queue bubble during authoritative handoff. */
  admittedQueuedRunId: string | null;
  /** Latest guidance submitted from this tab and its live lifecycle. */
  guidance: RuntimeGuidance | null;
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
    streamRunId: null,
    streamModelCallId: null,
    retiredModelCallIds: [],
    streamSettled: false,
    optimisticUserPrompt: null,
    admittedQueuedRunId: null,
    guidance: null,
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
    streamRunId: null,
    streamModelCallId: null,
    retiredModelCallIds: [],
    streamSettled: false,
    optimisticUserPrompt: null,
    admittedQueuedRunId: null,
    guidance: null,
  });
}

/** Paint the user bubble immediately on submit; cleared once the transcript owns it. */
export function setOptimisticUserPrompt(prompt: string | null): void {
  setState({ optimisticUserPrompt: prompt });
}

export function setGuidanceStatus(guidance: RuntimeGuidance | null): void {
  setState({ guidance });
}

/**
 * Fold one slice of live model output into the buffers. Only the orchestrator's
 * own output belongs in the chat — a thread's output is summarized on its card.
 */
export function applyAssistantDelta(delta: AssistantStreamDelta): void {
  if (delta.thread_name) return;
  setState((state) => {
    if (
      !state.running ||
      delta.run_id !== state.streamRunId ||
      state.retiredModelCallIds.includes(delta.model_call_id) ||
      (state.streamModelCallId !== null &&
        state.streamModelCallId !== delta.model_call_id)
    ) {
      return {};
    }
    const base = state.streamSettled
      ? { streamText: "", streamReasoning: "" }
      : {
          streamText: state.streamText,
          streamReasoning: state.streamReasoning,
        };
    return {
      streamModelCallId: delta.model_call_id,
      streamSettled: false,
      streamText: base.streamText + (delta.text ?? ""),
      streamReasoning: base.streamReasoning + (delta.reasoning ?? ""),
    };
  });
}

/** Drop non-authoritative partial output and permanently retire its call id. */
export function discardAssistantStream(): void {
  setState((state) => ({
    streamText: "",
    streamReasoning: "",
    streamModelCallId: null,
    retiredModelCallIds: state.streamModelCallId
      ? [...state.retiredModelCallIds, state.streamModelCallId].slice(-16)
      : state.retiredModelCallIds,
    streamSettled: false,
  }));
}

export function setStreamStatus(streamStatus: StreamStatus): void {
  if (streamStatus === "reconnecting" || streamStatus === "error") {
    discardAssistantStream();
  }
  setState({ streamStatus });
}

/**
 * Seed the running flag and run identity from a snapshot. A changed run owns a
 * fresh delta namespace; an idle snapshot owns no live partial output.
 */
export function syncRunFromSnapshot(
  activeRun: ActiveRunSnapshot | null | undefined,
): void {
  const running = isActiveRun(activeRun);
  const runId = running ? (activeRun?.run_id ?? null) : null;
  const state = getState();
  if (state.running === running && state.streamRunId === runId) return;
  const runChanged = state.streamRunId !== runId;
  setState({
    running,
    activity: running ? state.activity : "",
    streamRunId: runId,
    ...(runChanged
      ? {
          streamText: "",
          streamReasoning: "",
          streamModelCallId: null,
          retiredModelCallIds: [],
          streamSettled: false,
        }
      : {}),
  });
}

/** Reconcile exact active and buffered dispatch identities after reload/reconnect. */
export function syncThreadsFromSnapshot(
  active: ActiveThreadDispatchSnapshot[] | null | undefined,
  buffered: BufferedThreadCompletionSnapshot[] | null | undefined,
): void {
  setState((state) => {
    // These two lists are one authoritative registry projection. Persisted
    // terminal history is rebuilt from thread_finished events by transcript
    // selectors; keeping identities absent here would leave delivered results
    // or completed live entries stuck in the runtime store after reconnect.
    const threads: Record<string, RuntimeThread> = {};
    for (const item of [...(active ?? []), ...(buffered ?? [])]) {
      const identity = {
        name: item.thread_name,
        runId: item.run_id,
        dispatchId: item.dispatch_id,
        toolCallId: item.tool_call_id,
      };
      const key = runtimeThreadKey(identity);
      const prior = state.threads[key] ?? emptyThread(item.thread_name);
      threadSequence += 1;
      threads[key] = {
        ...prior,
        ...identity,
        status: item.status,
        deliveryStatus: "delivery_status" in item ? "available" : null,
        isError: item.status === "failed",
        updatedAt: threadSequence,
      };
    }
    return { threads };
  });
}

export function selectNewestThreadsByName(threads: Record<string, RuntimeThread>) {
  const selected: Record<string, RuntimeThread> = {};
  for (const thread of Object.values(threads)) {
    if (!selected[thread.name] || (selected[thread.name].updatedAt ?? 0) < (thread.updatedAt ?? 0)) selected[thread.name] = thread;
  }
  return selected;
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

let threadSequence = 0;

export function runtimeThreadKey(identity: {
  runId: string | null; name: string; dispatchId: string | null; toolCallId: string | null;
}): string {
  return identity.runId && identity.dispatchId && identity.toolCallId
    ? `${identity.runId}\u001f${identity.name}\u001f${identity.dispatchId}\u001f${identity.toolCallId}`
    : `name:${identity.name}`;
}

const emptyThread = (name: string): RuntimeThread => ({
  name,
  status: "running",
  runId: null,
  dispatchId: null,
  toolCallId: null,
  action: "",
  exitCode: null,
  isError: false,
  deliveryStatus: null,
  log: [],
  updatedAt: 0,
});

function newestThreadByName(threads: Record<string, RuntimeThread>, name: string) {
  return Object.values(threads)
    .filter((thread) => thread.name === name)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
}

function updateThread(name: string, patch: Partial<RuntimeThread>) {
  if (!name) return;
  setState((state) => {
    const identity = {
      name,
      runId: patch.runId ?? null,
      dispatchId: patch.dispatchId ?? null,
      toolCallId: patch.toolCallId ?? null,
    };
    let key = runtimeThreadKey(identity);
    if (key.startsWith("name:")) {
      const newest = newestThreadByName(state.threads, name);
      if (newest) key = runtimeThreadKey(newest);
    }
    const current = state.threads[key] ?? emptyThread(name);
    threadSequence += 1;
    return { threads: { ...state.threads, [key]: { ...current, ...patch, updatedAt: threadSequence } } };
  });
}

function markRunThreadsTerminal(runId: string | undefined, status: "failed" | "cancelled") {
  if (!runId) return;
  setState((state) => ({
    threads: Object.fromEntries(
      Object.entries(state.threads).map(([name, thread]) => [
        name,
        thread.runId === runId &&
        (thread.status === "accepted" ||
          thread.status === "dependency_pending" ||
          thread.status === "running")
          ? { ...thread, status, isError: status === "failed" }
          : thread,
      ]),
    ),
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
    const thread = newestThreadByName(state.threads, name) ?? emptyThread(name);
    const key = runtimeThreadKey(thread);
    threadSequence += 1;
    const log = [...thread.log, line].slice(-THREAD_LOG_LIMIT);
    return { threads: { ...state.threads, [key]: { ...thread, log, updatedAt: threadSequence } } };
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
        streamRunId: envelope.run_id ?? null,
        streamModelCallId: null,
        retiredModelCallIds: [],
        streamSettled: false,
        optimisticUserPrompt: event.submitted_user_message
          ? displayPromptFromMessageText(event.submitted_user_message.content)
          : null,
      });
      pushEvent({
        seq,
        kind: "run",
        text: `Run started: ${event.prompt_preview}`,
        isError: false,
      });
      return true;
    case "queued_run_created":
    case "queued_run_updated":
      setState((state) => ({
        admittedQueuedRunId:
          state.admittedQueuedRunId === event.queued_message.queued_run_id
            ? null
            : state.admittedQueuedRunId,
      }));
      return true;
    case "queued_run_deleted":
      return true;
    case "queued_run_admitted":
      setState({ admittedQueuedRunId: event.queued_run_id });
      return true;
    case "run_completed":
      // The run's own answer is the authoritative version of whatever the
      // stream last held, so it takes over until the snapshot lands.
      setState({
        running: false,
        activity: "",
        streamText: event.response,
        streamReasoning: "",
        streamRunId: null,
        streamModelCallId: null,
        retiredModelCallIds: [],
        streamSettled: true,
      });
      pushEvent({ seq, kind: "run", text: "Run completed", isError: false });
      return true;
    case "run_failed": {
      markRunThreadsTerminal(envelope.run_id, "failed");
      // The terminal message is a constant; a provider refusal seen earlier in
      // this run explains the same failure and says something useful.
      const message = getState().modelError ?? event.message;
      setState({
        running: false,
        activity: "",
        error: message,
        streamText: "",
        streamReasoning: "",
        streamRunId: null,
        streamModelCallId: null,
        retiredModelCallIds: [],
        streamSettled: false,
      });
      pushEvent({ seq, kind: "error", text: message, isError: true });
      return true;
    }
    case "run_cancelled":
      markRunThreadsTerminal(envelope.run_id, "cancelled");
      // Stopping is what the user asked for: the transcript already carries the
      // cancellation marker, so a red box would only contradict it. A provider
      // refusal seen earlier in this run is moot now for the same reason.
      setState({
        running: false,
        activity: "",
        error: null,
        modelError: null,
        streamText: "",
        streamReasoning: "",
        streamRunId: null,
        streamModelCallId: null,
        retiredModelCallIds: [],
        streamSettled: false,
      });
      pushEvent({ seq, kind: "run", text: "Run cancelled", isError: false });
      return true;
    case "snapshot_saved":
    case "respond_live_updated":
      return true;
    case "transcript_appended":
      // A message was committed, so the active call is retired. Cross-channel
      // scheduling may still deliver one of its deltas after this event.
      setState((state) => ({
        streamSettled: true,
        streamModelCallId: null,
        retiredModelCallIds: state.streamModelCallId
          ? [...state.retiredModelCallIds, state.streamModelCallId].slice(-16)
          : state.retiredModelCallIds,
      }));
      return true;
    case "transcript_reverted":
      // The messages the buffers were catching up to no longer exist, so the
      // leftovers would be replayed against a transcript that never had them.
      // The live threads went with those messages, and a rerun that dispatches
      // the same name again would otherwise inherit the discarded run's log.
      setState((state) => ({
        streamSettled: false,
        streamText: "",
        streamReasoning: "",
        streamModelCallId: null,
        retiredModelCallIds: state.streamModelCallId
          ? [...state.retiredModelCallIds, state.streamModelCallId].slice(-16)
          : state.retiredModelCallIds,
        threads: {},
      }));
      return true;
    case "agent":
      return applyAgent(seq, envelope.run_id, event.event);
    default:
      return false;
  }
}

function applyAgent(seq: number, envelopeRunId: string | undefined, event: AgentEvent): boolean {
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
      if (event.dispatch_thread_name && event.dispatch_status) {
        updateThread(event.dispatch_thread_name, {
          status: event.dispatch_status,
          runId: envelopeRunId ?? null,
          dispatchId: event.dispatch_id ?? null,
          toolCallId: event.call_id,
          isError: event.is_error,
        });
      }
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
        status: event.status ?? "running",
        runId: event.run_id ?? envelopeRunId ?? null,
        dispatchId: event.dispatch_id ?? null,
        toolCallId: event.tool_call_id ?? null,
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
        status:
          event.status ?? (event.exit_code ? "failed" : "completed"),
        runId: event.run_id ?? envelopeRunId ?? null,
        dispatchId: event.dispatch_id ?? null,
        toolCallId: event.tool_call_id ?? null,
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
    case "orchestrator_steering_expired": {
      const status = event.type.endsWith("delivered")
        ? "delivered"
        : event.type.endsWith("expired")
          ? "expired"
          : "queued";
      setState((state) => ({
        guidance:
          !state.guidance || state.guidance.steeringId === event.steering_id
            ? {
                steeringId: event.steering_id,
                runId: state.streamRunId ?? state.guidance?.runId ?? "",
                status,
              }
            : state.guidance,
      }));
      pushEvent({
        seq,
        kind: "steering",
        text: `${steeringVerb(event.type)} → orchestrator: ${event.instruction_preview}`,
        isError: event.type === "orchestrator_steering_expired",
      });
      // Delivery appends a canonical user message; all lifecycle states are
      // durable and should reconcile after reconnect.
      return true;
    }
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
export const useRuntimeThreads = () => useStore((s) => s.threads);
export const useLiveThreads = () => useStore((s) => s.threads);
export const useStreamText = () => useStore((s) => s.streamText);
export const useStreamReasoning = () => useStore((s) => s.streamReasoning);
export const useOptimisticUserPrompt = () =>
  useStore((s) => s.optimisticUserPrompt);
export const useAdmittedQueuedRunId = () =>
  useStore((s) => s.admittedQueuedRunId);
export const useGuidanceStatus = () => useStore((s) => s.guidance);
export { getState as getRuntimeState };
