import { createStore } from "../lib/store.js";

// Live run state for the currently viewed session, driven by the SSE stream.
// Backend streams event/message-level updates (no token deltas), so we track a
// running flag, a human-readable "activity" line, an error, and a capped event
// log (used by the Events tab and the transcript's typing indicator).
export const runtimeStore = createStore({
  sessionId: null,
  running: false,
  activity: "",
  error: null,
  streamStatus: "idle", // idle | connecting | live | reconnecting
  events: [], // [{ seq, kind, text, isError, ts, local }]
  threads: {}, // name -> { status, action, lastLine, exitCode, isError }
});

const { setState, getState, useStore } = runtimeStore;

const MAX_EVENTS = 300;

export function resetRuntime(sessionId) {
  setState({
    sessionId,
    running: false,
    activity: "",
    error: null,
    streamStatus: "connecting",
    events: [],
    threads: {},
  });
}

export function setStreamStatus(streamStatus) {
  setState({ streamStatus });
}

// Record a client-side event (prompt submitted, run cancelled, stream error) so
// the Events tab shows the full interaction, not just server frames.
export function pushLocalEvent(kind, text, isError = false) {
  pushEvent({ seq: null, kind, text, isError, local: true });
}

function pushEvent(ev) {
  setState((s) => {
    const events = s.events.length >= MAX_EVENTS ? s.events.slice(1) : s.events.slice();
    events.push({ ts: Date.now(), ...ev });
    return { events };
  });
}

function updateThread(name, patch) {
  if (!name) return;
  setState((s) => ({ threads: { ...s.threads, [name]: { ...(s.threads[name] || {}), name, ...patch } } }));
}

// Classify one envelope. Returns true when the canonical snapshot should be
// re-fetched (whole-message granularity == reload to reconcile ordering).
export function applyEnvelope(env) {
  const seq = env.sequence_id;
  const e = env.event || {};
  switch (e.type) {
    case "run_started":
      setState({ running: true, activity: "Run started…", error: null });
      pushEvent({ seq, kind: "run", text: `Run started: ${e.prompt_preview || ""}` });
      return true; // submitted user message shows up in snapshot
    case "run_completed":
      setState({ running: false, activity: "" });
      pushEvent({ seq, kind: "run", text: "Run completed" });
      return true;
    case "run_failed":
      setState({ running: false, activity: "", error: e.message || "Run failed" });
      pushEvent({ seq, kind: "error", text: e.message || "Run failed", isError: true });
      return true;
    case "snapshot_saved":
      return true;
    case "agent":
      return applyAgent(seq, e.event || {});
    default:
      return false;
  }
}

function applyAgent(seq, a) {
  switch (a.type) {
    case "model_call_started":
      setState({ activity: `Model thinking…${a.iteration ? ` (iter ${a.iteration})` : ""}` });
      return false;
    case "tool_call_started":
      setState({ activity: `Tool: ${a.name}` });
      pushEvent({ seq, kind: "tool", text: `▶ ${a.name}(${a.args_preview || ""})` });
      return false;
    case "tool_call_finished":
      pushEvent({
        seq,
        kind: "tool",
        text: `${a.is_error ? "✕" : "✓"} ${a.name}: ${a.content_preview || ""}`,
        isError: !!a.is_error,
      });
      return false;
    case "thread_started":
      setState({ activity: `Thread ${a.name}: ${a.action || ""}` });
      pushEvent({ seq, kind: "thread", text: `⌥ thread "${a.name}" — ${a.action || ""}` });
      updateThread(a.name, { status: "running", action: a.action || "", lastLine: "", exitCode: null });
      return false;
    case "thread_log":
      pushEvent({ seq, kind: "log", text: `${a.name}: ${a.line || ""}` });
      updateThread(a.name, { lastLine: a.line || "" });
      return false;
    case "thread_finished":
      pushEvent({ seq, kind: "thread", text: `⌦ thread "${a.name}" (exit ${a.exit_code})` });
      updateThread(a.name, { status: "finished", exitCode: a.exit_code, isError: !!a.exit_code });
      return false;
    case "assistant_message":
      setState({ activity: "" });
      pushEvent({ seq, kind: "assistant", text: "New assistant message" });
      return true; // reconcile transcript from snapshot
    case "error":
      setState({ error: a.message || "Error" });
      pushEvent({ seq, kind: "error", text: a.message || "Error", isError: true });
      return false;
    case "run_finished":
      return false;
    default:
      return false;
  }
}

export const useRunning = () => useStore((s) => s.running);
export const useActivity = () => useStore((s) => s.activity);
export const useRunError = () => useStore((s) => s.error);
export const useLiveEvents = () => useStore((s) => s.events);
export const useStreamStatus = () => useStore((s) => s.streamStatus);
export const useLiveThreads = () => useStore((s) => s.threads);
export { getState as getRuntimeState };
