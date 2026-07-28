import { createStore } from "../lib/store.js";
import { useSessions } from "./sessionsStore.js";
import { displaySessionTitle, sessionEnvLabel } from "../lib/format.js";

export const SORT_MANUAL = "manual";

export const SORT_ITEMS = [
  { id: "created_desc", label: "Newest first" },
  { id: "created_asc", label: "Oldest first" },
  { id: "updated_desc", label: "Recently updated" },
  { id: "title_asc", label: "Title A–Z" },
  { id: SORT_MANUAL, label: "Manual" },
];

export const RANGE_ANY = "any";
export const RANGE_ITEMS = [
  { id: RANGE_ANY, label: "Any time" },
  { id: "24h", label: "Last 24 hours" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
];

const RANGE_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000 };

// Client-side view state for the sessions list. The API returns every session,
// so search/sort/filters are applied here.
export const sessionFiltersStore = createStore({
  query: "",
  sort: "created_desc",
  createdRange: RANGE_ANY,
  modifiedRange: RANGE_ANY,
  envs: [], // sessionEnvLabel values
  models: [],
});

const { getState, setState, useStore } = sessionFiltersStore;

const toggle = (list, value) =>
  list.includes(value) ? list.filter((v) => v !== value) : list.concat(value);

export const setQuery = (query) => setState({ query });
export const setSort = (sort) => setState({ sort });
export const setCreatedRange = (createdRange) => setState({ createdRange });
export const setModifiedRange = (modifiedRange) => setState({ modifiedRange });
export const toggleEnv = (env) => setState((s) => ({ envs: toggle(s.envs, env) }));
export const toggleModel = (model) => setState((s) => ({ models: toggle(s.models, model) }));

export function resetFilters() {
  setState({
    query: "",
    createdRange: RANGE_ANY,
    modifiedRange: RANGE_ANY,
    envs: [],
    models: [],
  });
}

export function hasActiveFilters() {
  const s = getState();
  return (
    s.query.trim() !== "" ||
    s.createdRange !== RANGE_ANY ||
    s.modifiedRange !== RANGE_ANY ||
    s.envs.length > 0 ||
    s.models.length > 0
  );
}

const summaryOf = (entry) => entry.summary || entry;

// Unparseable timestamps must not hide a session, so they pass every range.
function withinRange(value, range, now) {
  const span = RANGE_MS[range];
  if (!span) return true;
  const ts = Date.parse(value);
  if (!isFinite(ts)) return true;
  return now - ts <= span;
}

function matchesQuery(summary, needle) {
  if (!needle) return true;
  const haystack = [
    displaySessionTitle(summary),
    summary.cwd,
    summary.model,
    summary.backend,
    summary.ssh_host,
    summary.last_user_prompt,
    summary.session_id,
  ];
  return haystack.some((v) => v && String(v).toLowerCase().includes(needle));
}

const comparators = {
  created_desc: (a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0),
  created_asc: (a, b) => Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0),
  updated_desc: (a, b) => Date.parse(b.updated_at || 0) - Date.parse(a.updated_at || 0),
  title_asc: (a, b) =>
    displaySessionTitle(a).localeCompare(displaySessionTitle(b), undefined, { sensitivity: "base" }),
};

// Filtered + sorted session entries. Pinned grouping stays in the page, which
// renders pinned sessions as their own block above the rest.
export function useVisibleSessions() {
  const sessions = useSessions();
  const filters = useStore();
  const now = Date.now();
  const needle = filters.query.trim().toLowerCase();

  const visible = sessions.filter((entry) => {
    const s = summaryOf(entry);
    if (!matchesQuery(s, needle)) return false;
    if (!withinRange(s.created_at, filters.createdRange, now)) return false;
    if (!withinRange(s.updated_at, filters.modifiedRange, now)) return false;
    if (filters.envs.length > 0 && !filters.envs.includes(sessionEnvLabel(s))) return false;
    if (filters.models.length > 0 && !filters.models.includes(s.model)) return false;
    return true;
  });

  const compare = comparators[filters.sort];
  if (compare) visible.sort((a, b) => compare(summaryOf(a), summaryOf(b)));
  return visible;
}

// Model chips are derived from the data so they never list models nobody uses.
export function useSessionModels() {
  const sessions = useSessions();
  const models = new Set();
  sessions.forEach((entry) => {
    const model = summaryOf(entry).model;
    if (model) models.add(model);
  });
  return Array.from(models).sort();
}

export const useQuery = () => useStore((s) => s.query);
export const useSort = () => useStore((s) => s.sort);
export const useCreatedRange = () => useStore((s) => s.createdRange);
export const useModifiedRange = () => useStore((s) => s.modifiedRange);
export const useSelectedEnvs = () => useStore((s) => s.envs);
export const useSelectedModels = () => useStore((s) => s.models);
export const useIsManualSort = () => useStore((s) => s.sort === SORT_MANUAL);
