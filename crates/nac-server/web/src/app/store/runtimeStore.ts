// Live run state for the currently viewed session, driven by the SSE stream.
// The backend streams event- and message-level updates (no token deltas), so
// this tracks a running flag, a human-readable activity line, an error and a
// capped event log feeding the Events tab and the transcript typing indicator.

import { createStore } from "@/app/lib/store";
import { isActiveRun } from "@/app/lib/format";
import type { StreamStatus } from "@/app/services/eventStream";
import type {
  ActiveRunSnapshot,
  AgentEvent,
  SessionEventEnvelope,
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
  action: string;
  exitCode: number | null;
  isError: boolean;
}

interface RuntimeState {
  sessionId: string | null;
  running: boolean;
  activity: string;
  error: string | null;
  streamStatus: StreamStatus;
  events: RuntimeEvent[];
  threads: Record<string, RuntimeThread>;
}

export const runtimeStore = createStore<RuntimeState>({
  sessionId: null,
  running: false,
  activity: "",
  error: null,
  streamStatus: "idle",
  events: [],
  threads: {},
});

const { setState, getState, useStore } = runtimeStore;

const MAX_EVENTS = 300;

export function resetRuntime(sessionId: string | null): void {
  setState({
    sessionId,
    running: false,
    activity: "",
    error: null,
    streamStatus: sessionId ? "connecting" : "idle",
    events: [],
    threads: {},
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

function pushEvent(event: Omit<RuntimeEvent, "ts" | "local"> & { local?: boolean }) {
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
      setState({ running: true, activity: "Run started…", error: null });
      pushEvent({
        seq,
        kind: "run",
        text: `Run started: ${event.prompt_preview}`,
        isError: false,
      });
      return true;
    case "run_completed":
      setState({ running: false, activity: "" });
      pushEvent({ seq, kind: "run", text: "Run completed", isError: false });
      return true;
    case "run_failed":
      setState({ running: false, activity: "", error: event.message });
      pushEvent({ seq, kind: "error", text: event.message, isError: true });
      return true;
    case "snapshot_saved":
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
      pushEvent({
        seq,
        kind: "tool",
        text: `▶ ${event.name}(${event.args_preview})`,
        isError: false,
      });
      return false;
    case "tool_call_finished":
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
export { getState as getRuntimeState };
