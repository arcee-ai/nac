import { createStore } from "../lib/store.js";
import { clearSelection, selectSession } from "./selectionStore.js";
import { loadSnapshot, clearAttention } from "./sessionsStore.js";

export const ROUTE_LIST = "list";
export const ROUTE_SESSION = "session";

// Two screens, addressable by hash: the sessions list and one session's detail.
export const routeStore = createStore({ name: ROUTE_LIST, sessionId: null });

const { setState, useStore } = routeStore;

// URL shape matches the legacy UI: the list lives on the bare path, a session
// is addressed by the `#session/<id>` fragment.
const listUrl = () => `${window.location.pathname}${window.location.search}`;
const sessionUrl = (id) => `#session/${encodeURIComponent(id)}`;

function parseHash(hash) {
  const match = String(hash || "").match(/^#session\/(.+)$/);
  if (!match) return { name: ROUTE_LIST, sessionId: null };
  return { name: ROUTE_SESSION, sessionId: decodeURIComponent(match[1]) };
}

function applyHash() {
  const route = parseHash(window.location.hash);
  setState(route);
  // Deep links must hydrate the same state a click would, so the inspector and
  // the card's selected outline work on a cold load too.
  if (route.name === ROUTE_SESSION) {
    selectSession(route.sessionId);
    loadSnapshot(route.sessionId);
  } else {
    // Otherwise the last opened card keeps its selected outline on the list.
    clearSelection();
  }
}

// Subscribe to hash changes. A bare URL is left untouched so the list keeps a
// clean address. Returns a cleanup fn.
export function startRouter() {
  applyHash();
  window.addEventListener("hashchange", applyHash);
  return () => window.removeEventListener("hashchange", applyHash);
}

// `pushState` keeps the back button meaningful and, unlike assigning
// `location.hash`, can drop the fragment entirely when returning to the list.
// It emits no `hashchange`, so the store is updated here.
function navigate(url, route) {
  window.history.pushState(null, "", url);
  setState(route);
}

export function openSession(id) {
  if (!id) return;
  clearAttention(id);
  selectSession(id);
  loadSnapshot(id);
  navigate(sessionUrl(id), { name: ROUTE_SESSION, sessionId: id });
}

export function openList() {
  clearSelection();
  navigate(listUrl(), { name: ROUTE_LIST, sessionId: null });
}

export const useRoute = () => useStore((s) => s.name);
export const useRouteSessionId = () => useStore((s) => s.sessionId);
