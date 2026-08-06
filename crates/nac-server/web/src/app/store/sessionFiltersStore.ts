// Client-side view state for the sessions list. The API returns every session,
// so search, sort and filters are applied here.

import { useMemo } from "react";

import { createStore } from "@/app/lib/store";
import { useNow } from "@/app/hooks/useNow";
import {
  displaySessionTitle,
  sessionEnvLabel,
  type SessionEnv,
} from "@/app/lib/format";
import { providersFromBackends } from "@/app/lib/providers";
import type { ManagedSessionSummary, SessionSummarySnapshot } from "@/app/types/api";

export const SORT_MANUAL = "manual";

export type SortId =
  | "created_desc"
  | "created_asc"
  | "updated_desc"
  | "title_asc"
  | typeof SORT_MANUAL;

export const SORT_ITEMS: { id: SortId; label: string }[] = [
  { id: "created_desc", label: "Newest first" },
  { id: "created_asc", label: "Oldest first" },
  { id: "updated_desc", label: "Recently updated" },
  { id: "title_asc", label: "Title A–Z" },
  { id: SORT_MANUAL, label: "Manual" },
];

export const RANGE_ANY = "any";
export type RangeId = typeof RANGE_ANY | "24h" | "7d" | "30d";

export const RANGE_ITEMS: { id: RangeId; label: string }[] = [
  { id: RANGE_ANY, label: "Any time" },
  { id: "24h", label: "Last 24 hours" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
];

const RANGE_TICK_MS = 60_000;

const RANGE_MS: Record<string, number> = {
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
};

interface FiltersState {
  query: string;
  sort: SortId;
  createdRange: RangeId;
  modifiedRange: RangeId;
  envs: SessionEnv[];
  /** Selected `BackendKind` values, not their display labels. */
  providers: string[];
}

export const sessionFiltersStore = createStore<FiltersState>({
  query: "",
  sort: "created_desc",
  createdRange: RANGE_ANY,
  modifiedRange: RANGE_ANY,
  envs: [],
  providers: [],
});

const { getState, setState, useStore } = sessionFiltersStore;

const toggle = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : list.concat(value);

export const setQuery = (query: string) => setState({ query });
export const setSort = (sort: SortId) => setState({ sort });
export const setCreatedRange = (createdRange: RangeId) =>
  setState({ createdRange });
export const setModifiedRange = (modifiedRange: RangeId) =>
  setState({ modifiedRange });
export const toggleEnv = (env: SessionEnv) =>
  setState((s) => ({ envs: toggle(s.envs, env) }));
export const toggleProvider = (provider: string) =>
  setState((s) => ({ providers: toggle(s.providers, provider) }));

export function resetFilters(): void {
  setState({
    query: "",
    createdRange: RANGE_ANY,
    modifiedRange: RANGE_ANY,
    envs: [],
    providers: [],
  });
}

export function hasActiveFilters(): boolean {
  const s = getState();
  return (
    s.query.trim() !== "" ||
    s.createdRange !== RANGE_ANY ||
    s.modifiedRange !== RANGE_ANY ||
    s.envs.length > 0 ||
    s.providers.length > 0
  );
}

/** Unparseable timestamps must not hide a session, so they pass every range. */
function withinRange(value: string, range: RangeId, now: number): boolean {
  const span = RANGE_MS[range];
  if (!span) return true;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return true;
  return now - ts <= span;
}

function matchesQuery(
  summary: SessionSummarySnapshot,
  needle: string,
): boolean {
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

type Comparator = (
  a: SessionSummarySnapshot,
  b: SessionSummarySnapshot,
) => number;

const comparators: Partial<Record<SortId, Comparator>> = {
  created_desc: (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  created_asc: (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
  updated_desc: (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
  title_asc: (a, b) =>
    displaySessionTitle(a).localeCompare(displaySessionTitle(b), undefined, {
      sensitivity: "base",
    }),
};

/**
 * Filtered and sorted entries. Pinned grouping stays in the page, which renders
 * pinned sessions as their own block above the rest.
 */
export function useVisibleSessions(
  sessions: ManagedSessionSummary[],
): ManagedSessionSummary[] {
  const filters = useStore();
  // Relative ranges span hours, so re-evaluating them once a minute is plenty.
  const now = useNow(RANGE_TICK_MS);
  return useMemo(() => {
    const needle = filters.query.trim().toLowerCase();
    const visible = sessions.filter(({ summary }) => {
      if (!matchesQuery(summary, needle)) return false;
      if (!withinRange(summary.created_at, filters.createdRange, now)) return false;
      if (!withinRange(summary.updated_at, filters.modifiedRange, now)) return false;
      if (
        filters.envs.length > 0 &&
        !filters.envs.includes(sessionEnvLabel(summary))
      ) {
        return false;
      }
      if (
        filters.providers.length > 0 &&
        !filters.providers.includes(summary.backend)
      ) {
        return false;
      }
      return true;
    });

    const compare = comparators[filters.sort];
    // Manual sort keeps whatever order the API returned.
    if (compare) visible.sort((a, b) => compare(a.summary, b.summary));
    return visible;
  }, [sessions, filters, now]);
}

/** Provider chips are derived from the data so they never list unused ones. */
export function useSessionProviders(
  sessions: ManagedSessionSummary[],
): string[] {
  return useMemo(
    () => providersFromBackends(sessions.map(({ summary }) => summary.backend)),
    [sessions],
  );
}

export const useFilterQuery = () => useStore((s) => s.query);
export const useSort = () => useStore((s) => s.sort);
export const useCreatedRange = () => useStore((s) => s.createdRange);
export const useModifiedRange = () => useStore((s) => s.modifiedRange);
export const useSelectedEnvs = () => useStore((s) => s.envs);
export const useSelectedProviders = () => useStore((s) => s.providers);
export const useIsManualSort = () => useStore((s) => s.sort === SORT_MANUAL);
