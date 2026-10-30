import type { InsightsFilter } from "../features/insights/model/types";
/** What the Insights detail shows. A thread reads its name from `selectedThread`. */
export type InsightSelection = {
    kind: "group";
    groupId: string;
    segmentKey: string | null;
} | {
    kind: "thread";
};
interface SessionLayoutState {
    /** Side box slid off to its 52px icon rail. Defaults to collapsed. */
    collapsed: boolean;
    /** Whether the next collapsed change should tween; restoring a project's stored rail does not. */
    sidePanelAnimate: boolean;
    /**
     * Project the collapsed preference belongs to. Null until the open session's
     * project is known. Switching projects restores that project's stored rail.
     */
    sidePanelProjectId: string | null;
    /**
     * Side box focused: on a phone, the dialog over the session; wider, the box
     * covering the chat beside it until Back to chat. Never browser fullscreen.
     */
    expanded: boolean;
    /**
     * Whether a narrow panel is showing its list of rows. There is no room for
     * the list beside the detail at that width, so the panel opens on the row it
     * has selected and the list comes over it — as a dialog of its own on a
     * phone, in place of the detail on a tablet. Wide layouts ignore this.
     */
    panelList: boolean;
    /** Thread the chat last pointed Insights at; its detail shows this one. */
    selectedThread: string | null;
    /**
     * Which of that thread's chat cards did the pointing, or null when the pick
     * came from the panel's own list. A re-dispatched thread has one card per
     * episode, and only the card clicked belongs highlighted.
     */
    selectedThreadEpisode: string | null;
    /** Entry the Insights detail shows; null until the panel or the chat picks one. */
    selectedInsight: InsightSelection | null;
    /**
     * Bumps on every Insights pick, so picking the entry already shown still
     * scrolls the detail back to it.
     */
    insightFocusNonce: number;
    /** Insights groups whose child rows are open, by group id. */
    expandedInsightGroups: ReadonlySet<string>;
    insightsFilter: InsightsFilter;
    /** Workset the chat last pointed the Worksets panel at. */
    selectedWorkset: string | null;
    /** Open Subagents row per parent, kept so returning from a transcript reopens it. */
    selectedSubagents: ReadonlyMap<string, string>;
    /** Revision the panels are looking at, or null for the live working tree. */
    selectedRevision: number | null;
    /** File the Files panel is showing. */
    selectedFile: string | null;
    /** Folders flipped away from their default open state, by path. */
    toggledFolders: ReadonlySet<string>;
    /**
     * Whether the Changes panel lists the whole project as a tree or only what
     * git reports as changed.
     */
    fileListing: FileListing;
}
export type FileListing = "tree" | "changed";
/** One presentation lifetime; hosted preferences are ephemeral. */
export declare function createSessionLayoutStore(storage?: Pick<Storage, "getItem" | "setItem">): {
    release: () => void;
    sessionLayoutStore: import("../lib/store").Store<SessionLayoutState>;
    bindSidePanelProject: (projectId: string) => void;
    unbindSidePanelProject: () => void;
    toggleSidePanelExpanded: () => void;
    leaveFocusedSidePanel: () => void;
    openSidePanelList: () => void;
    toggleSidePanelCollapsed: () => void;
    showSidePanelList: (panelList: boolean) => void;
    toggleSidePanelList: () => void;
    revealSidePanel: (asDialog?: boolean) => void;
    selectThread: (selectedThread: string | null, selectedThreadEpisode?: string | null) => void;
    selectInsight: (selectedInsight: InsightSelection | null) => void;
    toggleInsightGroup: (groupId: string, expanded?: boolean) => void;
    selectInsightsFilter: (insightsFilter: InsightsFilter) => void;
    selectWorkset: (selectedWorkset: string | null) => void;
    selectSubagent: (parentSessionId: string, key: string) => void;
    selectRevision: (selectedRevision: number | null) => void;
    selectFile: (selectedFile: string | null) => void;
    toggleFolder: (path: string) => void;
    selectFileListing: (fileListing: FileListing) => void;
    setSidePanelAnimate: (sidePanelAnimate: boolean) => void;
    resetSessionSelection: () => void;
    useSidePanelCollapsed: () => boolean;
    useSidePanelAnimate: () => boolean;
    useSidePanelExpanded: () => boolean;
    useSidePanelList: () => boolean;
    useSelectedThread: () => string | null;
    useSelectedThreadEpisode: () => string | null;
    useSelectedInsight: () => InsightSelection | null;
    useInsightFocusNonce: () => number;
    useExpandedInsightGroups: () => ReadonlySet<string>;
    useInsightsFilter: () => InsightsFilter;
    useSelectedWorkset: () => string | null;
    useSelectedSubagent: (parentSessionId: string) => string | null;
    useSelectedRevision: () => number | null;
    useSelectedFile: () => string | null;
    useToggledFolders: () => ReadonlySet<string>;
    useFileListing: () => FileListing;
};
export declare const release: () => void, sessionLayoutStore: import("../lib/store").Store<SessionLayoutState>, bindSidePanelProject: (projectId: string) => void, unbindSidePanelProject: () => void, toggleSidePanelExpanded: () => void, leaveFocusedSidePanel: () => void, openSidePanelList: () => void, toggleSidePanelCollapsed: () => void, showSidePanelList: (panelList: boolean) => void, toggleSidePanelList: () => void, revealSidePanel: (asDialog?: boolean) => void, selectThread: (selectedThread: string | null, selectedThreadEpisode?: string | null) => void, selectInsight: (selectedInsight: InsightSelection | null) => void, toggleInsightGroup: (groupId: string, expanded?: boolean) => void, selectInsightsFilter: (insightsFilter: InsightsFilter) => void, selectWorkset: (selectedWorkset: string | null) => void, selectSubagent: (parentSessionId: string, key: string) => void, selectRevision: (selectedRevision: number | null) => void, selectFile: (selectedFile: string | null) => void, toggleFolder: (path: string) => void, selectFileListing: (fileListing: FileListing) => void, setSidePanelAnimate: (sidePanelAnimate: boolean) => void, resetSessionSelection: () => void, useSidePanelCollapsed: () => boolean, useSidePanelAnimate: () => boolean, useSidePanelExpanded: () => boolean, useSidePanelList: () => boolean, useSelectedThread: () => string | null, useSelectedThreadEpisode: () => string | null, useSelectedInsight: () => InsightSelection | null, useInsightFocusNonce: () => number, useExpandedInsightGroups: () => ReadonlySet<string>, useInsightsFilter: () => InsightsFilter, useSelectedWorkset: () => string | null, useSelectedSubagent: (parentSessionId: string) => string | null, useSelectedRevision: () => number | null, useSelectedFile: () => string | null, useToggledFolders: () => ReadonlySet<string>, useFileListing: () => FileListing;
export {};
