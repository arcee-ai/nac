import { createContext, useContext, useEffect, useMemo, useRef, type RefObject } from "react";

import type { DelegatedRowKey, InsightsFilter } from "@/app/features/insights/model/types";
import type { SessionPanel } from "@/app/lib/routes";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { InsightSelection } from "@/app/store/sessionLayoutStore";

/**
 * The Insights detail region, for the `aria-controls` of a control that opens
 * an entry there. A session page mounts one detail at a time, so it is unique.
 */
export const INSIGHTS_DETAIL_ID = "insights-detail";

export interface InsightsOpenOptions {
  /**
   * Keyboard activation: focus moves into the detail once it shows the entry.
   * A pointer leaves focus where it is, so only keyboard callers pass this.
   */
  focusDetail?: boolean;
}

export interface InsightsNavigation {
  /** Insights with the group selected; `segmentKey` points its detail at one segment. */
  openGroup(groupId: string, segmentKey?: string, options?: InsightsOpenOptions): void;
  /** Insights on the thread's detail; `episodeKey` is the dispatch whose card asked. */
  openThread(name: string, episodeKey?: string, options?: InsightsOpenOptions): void;
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

interface InsightsNavigationValue extends InsightsNavigationTarget {
  /** The pick made with `focusDetail` whose detail has not taken the focus yet. */
  detailFocusRef: { current: InsightSelection | null };
}

/** Outside a session page there is no panel to open, so every jump is a no-op. */
export const InsightsNavigationContext = createContext<InsightsNavigationValue>({
  sessionId: "",
  panels: [],
  focusPanel: () => {},
  detailFocusRef: { current: null },
});

/**
 * The one way across session surfaces: each call points the target panel's
 * selection at the entry, then brings that panel up — on a phone, as the
 * dialog. A panel the session's policy lacks is never opened.
 */
export function useInsightsNavigation(): InsightsNavigation {
  const { sessionId, panels, focusPanel, detailFocusRef } = useContext(InsightsNavigationContext);
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
    // The request is the selection object itself, so any later pick outdates it.
    const pick = (selection: InsightSelection, options: InsightsOpenOptions | undefined) => {
      detailFocusRef.current = options?.focusDetail ? selection : null;
      selectInsight(selection);
    };
    return {
      openGroup: (groupId, segmentKey, options) =>
        open("insights", () => {
          revealInList("tools");
          pick({ kind: "group", groupId, segmentKey: segmentKey ?? null }, options);
        }),
      openThread: (name, episodeKey, options) =>
        open("insights", () => {
          revealInList("threads");
          selectThread(name, episodeKey ?? null);
          pick({ kind: "thread" }, options);
        }),
      openSubagent: (rowKey) => open("delegated", () => selectSubagent(sessionId, rowKey)),
      openWorkset: (worksetId) => open("worksets", () => selectWorkset(worksetId)),
    };
  }, [
    sessionId,
    panels,
    focusPanel,
    detailFocusRef,
    sessionLayoutStore,
    selectInsightsFilter,
    selectInsight,
    selectThread,
    selectSubagent,
    selectWorkset,
  ]);
}

/**
 * The detail's side of `focusDetail`: once the detail region shows the stored
 * selection a keyboard call asked for, focus moves into it. Returns the
 * region's ref; `showing` says whether the detail renders that selection.
 */
export function useInsightsDetailFocus(
  selection: InsightSelection | null,
  showing: boolean,
): RefObject<HTMLDivElement | null> {
  const { detailFocusRef } = useContext(InsightsNavigationContext);
  const regionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showing || !selection || detailFocusRef.current !== selection) return undefined;
    // A frame later, once the commit's own effects ran: a phone dialog opening
    // with the detail focuses its card first, and a collapsed panel is inert
    // until the reveal commits.
    const frame = requestAnimationFrame(() => {
      const region = regionRef.current;
      if (!region || detailFocusRef.current !== selection) return;
      detailFocusRef.current = null;
      // The panel may still be sliding in; scrolling to it would drag the page.
      region.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [detailFocusRef, selection, showing]);
  return regionRef;
}
