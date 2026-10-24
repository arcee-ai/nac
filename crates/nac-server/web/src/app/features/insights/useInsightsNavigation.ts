import { createContext, useContext, useMemo } from "react";

import type { DelegatedRowKey, InsightsFilter } from "@/app/features/insights/model/types";
import type { SessionPanel } from "@/app/lib/routes";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";

export interface InsightsNavigation {
  /** Insights with the group selected; `segmentKey` points its detail at one segment. */
  openGroup(groupId: string, segmentKey?: string): void;
  /** Insights on the thread's detail; `episodeKey` is the dispatch whose card asked. */
  openThread(name: string, episodeKey?: string): void;
  /** Subagents with that row open; the newest row stands in until the list has it. */
  openSubagent(rowKey: DelegatedRowKey): void;
  openWorkset(worksetId: string): void;
}

/** What the session page lends the hook: its session, its panels and how it brings one up. */
export interface InsightsNavigationTarget {
  /** The Subagents panel keeps its open row per parent session. */
  sessionId: string;
  panels: readonly SessionPanel[];
  focusPanel: (panel: SessionPanel) => void;
}

/** Outside a session page there is no panel to open, so every jump is a no-op. */
export const InsightsNavigationContext = createContext<InsightsNavigationTarget>({
  sessionId: "",
  panels: [],
  focusPanel: () => {},
});

/**
 * The one way across session surfaces: each call points the target panel's
 * selection at the entry, then brings that panel up — on a phone, as the
 * dialog. A panel the session's policy lacks is never opened.
 */
export function useInsightsNavigation(): InsightsNavigation {
  const { sessionId, panels, focusPanel } = useContext(InsightsNavigationContext);
  const {
    sessionLayoutStore,
    selectInsightsFilter,
    selectInsight,
    selectThread,
    selectSubagent,
    selectWorkset,
  } = useNativeRuntime().stores.sessionLayoutStore;

  return useMemo(() => {
    const open = (panel: SessionPanel, select: () => void) => {
      if (!panels.includes(panel)) return;
      select();
      focusPanel(panel);
    };
    // A jump must never land on an entry the list hides, so any filter but
    // the one that keeps this kind of entry widens back to all.
    const revealInList = (keptBy: InsightsFilter) => {
      const filter = sessionLayoutStore.getState().insightsFilter;
      if (filter !== "all" && filter !== keptBy) selectInsightsFilter("all");
    };
    return {
      openGroup: (groupId, segmentKey) =>
        open("insights", () => {
          revealInList("tools");
          selectInsight({ kind: "group", groupId, segmentKey: segmentKey ?? null });
        }),
      openThread: (name, episodeKey) =>
        open("insights", () => {
          revealInList("threads");
          selectThread(name, episodeKey ?? null);
          selectInsight({ kind: "thread" });
        }),
      openSubagent: (rowKey) => open("delegated", () => selectSubagent(sessionId, rowKey)),
      openWorkset: (worksetId) => open("worksets", () => selectWorkset(worksetId)),
    };
  }, [
    sessionId,
    panels,
    focusPanel,
    sessionLayoutStore,
    selectInsightsFilter,
    selectInsight,
    selectThread,
    selectSubagent,
    selectWorkset,
  ]);
}
