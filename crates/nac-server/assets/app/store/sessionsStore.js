import { createStore } from "../lib/store.js";
import { api } from "../services/api.js";

// Global sessions state (no Redux). Holds store info, the session list
// (ManagedSessionSummary[]), per-session snapshots, plus polling + SSE plumbing.
export const sessionsStore = createStore({
  storeInfo: null,
  sessions: [], // ManagedSessionSummary[]
  snapshots: {}, // id -> SessionSummarySnapshot (full snapshot)
  loading: false,
  error: null,
});

const { getState, setState, useStore } = sessionsStore;

let pollTimer = null;
let eventSource = null;
let eventSessionId = null;

export async function loadStoreInfo() {
  try {
    const info = await api.getStore();
    setState({ storeInfo: info });
    return info;
  } catch (e) {
    setState({ error: `store: ${e.message}` });
    return null;
  }
}

export async function loadSessions({ workspaceStats = false, silent = false } = {}) {
  if (!silent) setState({ loading: true, error: null });
  try {
    const list = await api.listSessions(workspaceStats);
    setState({ sessions: Array.isArray(list) ? list : [], loading: false });
    return list;
  } catch (e) {
    setState({ loading: false, error: `sesje: ${e.message}` });
    return null;
  }
}

export async function loadSnapshot(id) {
  if (!id) return null;
  try {
    const snap = await api.getSession(id);
    setState((s) => ({ snapshots: { ...s.snapshots, [id]: snap } }));
    return snap;
  } catch (e) {
    setState({ error: `snapshot: ${e.message}` });
    return null;
  }
}

export function startPolling(ms = 5000, opts = {}) {
  stopPolling();
  pollTimer = setInterval(() => loadSessions({ ...opts, silent: true }), ms);
}

export function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Connect to a session's SSE stream. The server emits *named* SSE events
// (`session_event`, `replay_boundary`, `replay_gap`, `lagged`), so we must use
// addEventListener — EventSource.onmessage only fires for unnamed events.
// onEnvelope receives the parsed SessionEventEnvelope for each `session_event`.
export function connectStream(id, onEnvelope) {
  disconnectStream();
  if (!id) return null;
  eventSessionId = id;
  eventSource = new EventSource(api.eventStreamUrl(id));

  const parse = (e) => {
    try {
      return JSON.parse(e.data);
    } catch (_) {
      return null;
    }
  };

  eventSource.addEventListener("session_event", (e) => {
    const env = parse(e);
    if (env && onEnvelope) onEnvelope(env);
  });
  // control frames are informational; kept quiet in the preview
  eventSource.addEventListener("lagged", () => {});
  eventSource.addEventListener("replay_boundary", () => {});
  eventSource.addEventListener("replay_gap", () => {});
  eventSource.onerror = () => {
    /* browser auto-reconnects */
  };
  return eventSource;
}

export function disconnectStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
    eventSessionId = null;
  }
}

// ---- selectors / hooks ----
export const useStoreInfo = () => useStore((s) => s.storeInfo);
export const useSessions = () => useStore((s) => s.sessions);
export const useSessionsLoading = () => useStore((s) => s.loading);
export const useSessionsError = () => useStore((s) => s.error);
export const useSnapshot = (id) => useStore((s) => (id ? s.snapshots[id] : undefined));

export { getState as getSessionsState };
