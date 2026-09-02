// Actions-list filter is a viewing preference, not server state. It is stored
// per session type so Agent and Orchestrator keep their own last choice across
// chats, reloads, and leaving the panel.

import { createStore } from "@/app/lib/store";
import type { ActionFilter } from "@/app/lib/actionsTimeline";

export type ActionFilterKind = "agent" | "orchestrator";

interface ActionFilterState {
  agent: ActionFilter;
  orchestrator: ActionFilter;
}

const STORAGE_KEY = "nac.actionFilter";
const FILTERS: readonly ActionFilter[] = ["all", "threads", "tools", "sessions", "worksets"];

const empty = (): ActionFilterState => ({ agent: "all", orchestrator: "all" });

function asFilter(value: unknown): ActionFilter | null {
  return typeof value === "string" && (FILTERS as readonly string[]).includes(value)
    ? (value as ActionFilter)
    : null;
}

function restore(): ActionFilterState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return empty();
    const record = parsed as Record<string, unknown>;
    return {
      agent: asFilter(record.agent) ?? "all",
      orchestrator: asFilter(record.orchestrator) ?? "all",
    };
  } catch {
    return empty();
  }
}

export const actionFilterStore = createStore<ActionFilterState>(restore(), "actionFilter");

const { getState, setState, subscribe, useStore } = actionFilterStore;

subscribe(() => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getState()));
  } catch {
    // Full or forbidden storage only loses the remembered filter.
  }
});

export function setActionFilter(kind: ActionFilterKind, filter: ActionFilter): void {
  setState((state) => (state[kind] === filter ? null : { [kind]: filter }));
}

export function useActionFilter(
  kind: ActionFilterKind,
  options: readonly ActionFilter[],
): [ActionFilter, (filter: ActionFilter) => void] {
  const stored = useStore((state) => state[kind]);
  const value = options.includes(stored) ? stored : "all";
  return [value, (filter) => setActionFilter(kind, filter)];
}
