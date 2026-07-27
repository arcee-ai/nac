import { createStore } from "../lib/store.js";
import { api } from "../services/api.js";
import { isActiveRun } from "../lib/format.js";
import { selectionStore } from "./selectionStore.js";

// Global sessions state (no Redux). Holds store info, the session list
// (ManagedSessionSummary[]), per-session snapshots, plus polling + SSE plumbing.
export const sessionsStore = createStore({
  storeInfo: null,
  sessions: [], // ManagedSessionSummary[]
  snapshots: {}, // id -> SessionSummarySnapshot (full snapshot)
  attention: {}, // id -> true when a run finished while unfocused
  loading: false,
  error: null,
});

const { getState, setState, useStore } = sessionsStore;
const summaryOf = (entry) => entry.summary || entry;

// Track prior run activity across polls so we can flag "attention" (a run that
// finished for a session the user isn't currently viewing).
let prevActive = {};

function trackAttention(list) {
  const selId = selectionStore.getState().selectedId;
  const nextActive = {};
  const attention = { ...getState().attention };
  for (const entry of list) {
    const s = summaryOf(entry);
    const id = s.session_id;
    const active = isActiveRun(entry.active_run || s.active_run);
    nextActive[id] = active;
    if (prevActive[id] === true && !active && id !== selId) attention[id] = true;
  }
  prevActive = nextActive;
  return attention;
}

export function clearAttention(id) {
  const cur = getState().attention;
  if (!cur[id]) return;
  const attention = { ...cur };
  delete attention[id];
  setState({ attention });
}

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
    const raw = await api.listSessions(workspaceStats);
    const list = Array.isArray(raw) ? raw : [];
    setState({ sessions: list, loading: false, attention: trackAttention(list) });
    return list;
  } catch (e) {
    setState({ loading: false, error: `sessions: ${e.message}` });
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

// ---- mutations (create / rename / delete / config) ----
export async function createSession(payload) {
  const snap = await api.createSession(payload);
  await loadSessions({ silent: true });
  return snap;
}

export async function renameSession(id, payload) {
  const res = await api.renameSession(id, payload);
  await loadSessions({ silent: true });
  return res;
}

export async function deleteSession(id) {
  await api.deleteSession(id);
  setState((s) => {
    const snapshots = { ...s.snapshots };
    delete snapshots[id];
    return { snapshots };
  });
  await loadSessions({ silent: true });
}

export async function updateConfig(id, payload) {
  const res = await api.updateConfig(id, payload);
  await loadSnapshot(id);
  await loadSessions({ silent: true });
  return res;
}

// Pin/unpin a session, preserving its current title and presentation version.
export async function togglePin(entry) {
  const s = summaryOf(entry);
  const res = await api.renameSession(s.session_id, {
    title: typeof s.title === "string" ? s.title : "",
    pinned: !s.pinned,
    expected_version: Number(s.presentation_version) || 0,
  });
  await loadSessions({ silent: true });
  return res;
}

// Optimistically move `dragId` to `targetId`'s slot within the same pinned
// group. Returns the group's `pinned` flag (to persist) or null if the move is
// invalid (cross-group or unknown ids).
export function reorderSessionsLocal(dragId, targetId) {
  if (dragId === targetId) return null;
  let pinned = null;
  setState((st) => {
    const list = st.sessions.slice();
    const from = list.findIndex((e) => summaryOf(e).session_id === dragId);
    const to = list.findIndex((e) => summaryOf(e).session_id === targetId);
    if (from < 0 || to < 0) return {};
    const dragged = list[from];
    if (!!summaryOf(dragged).pinned !== !!summaryOf(list[to]).pinned) return {};
    pinned = !!summaryOf(dragged).pinned;
    list.splice(from, 1);
    list.splice(to, 0, dragged);
    return { sessions: list };
  });
  return pinned;
}

// Persist the current order of one pinned group via PUT /sessions/order.
export async function persistReorder(pinned) {
  const group = getState().sessions.filter((e) => !!summaryOf(e).pinned === !!pinned);
  const session_ids = group.map((e) => summaryOf(e).session_id);
  const expected_versions = {};
  group.forEach((e) => {
    const s = summaryOf(e);
    expected_versions[s.session_id] = s.presentation_version ?? 0;
  });
  const res = await api.reorderSessions({ pinned: !!pinned, session_ids, expected_versions });
  await loadSessions({ silent: true });
  return res;
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
export function connectStream(id, onEnvelope, onStatus) {
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

  eventSource.onopen = () => onStatus && onStatus("live");
  eventSource.addEventListener("session_event", (e) => {
    const env = parse(e);
    if (env && onEnvelope) onEnvelope(env);
  });
  // control frames are informational; kept quiet in the preview
  eventSource.addEventListener("lagged", () => {});
  eventSource.addEventListener("replay_boundary", () => {});
  eventSource.addEventListener("replay_gap", () => {});
  eventSource.onerror = () => {
    // The browser auto-reconnects; reflect the transient state in the UI.
    if (onStatus) onStatus("reconnecting");
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
export const useAttention = (id) => useStore((s) => (id ? !!s.attention[id] : false));

export { getState as getSessionsState };
