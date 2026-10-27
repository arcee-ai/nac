import { type RefObject } from "react";
import type { DelegatedRowKey } from "./model/types";
import type { SessionPanel } from "../../lib/routes";
import type { InsightSelection } from "../../store/sessionLayoutStore";
/**
 * The Insights detail region, for the `aria-controls` of a control that opens
 * an entry there. A session page mounts one detail at a time, so it is unique.
 */
export declare const INSIGHTS_DETAIL_ID = "insights-detail";
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
    /** Files on the working tree's tree listing, with this workspace-relative file open. */
    openFile(path: string): void;
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
    detailFocusRef: {
        current: InsightSelection | null;
    };
}
/** Outside a session page there is no panel to open, so every jump is a no-op. */
export declare const InsightsNavigationContext: import("react").Context<InsightsNavigationValue>;
/**
 * The one way across session surfaces: each call points the target panel's
 * selection at the entry, then brings that panel up — on a phone, as the
 * dialog. A panel the session's policy lacks is never opened.
 */
export declare function useInsightsNavigation(): InsightsNavigation;
/**
 * The detail's side of `focusDetail`: once the detail region shows the stored
 * selection a keyboard call asked for, focus moves into it. Returns the
 * region's ref; `showing` says whether the detail renders that selection.
 */
export declare function useInsightsDetailFocus(selection: InsightSelection | null, showing: boolean): RefObject<HTMLDivElement | null>;
export {};
