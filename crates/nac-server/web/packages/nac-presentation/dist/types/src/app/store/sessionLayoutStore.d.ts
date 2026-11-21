import type { InsightsFilter } from "../features/insights/model/types";
/** What the Insights detail shows. */
export type InsightSelection = {
    kind: "group";
    groupId: string;
    segmentKey: string | null;
};
/** A reader-owned origin. Streaming data never writes these saved pointers. */
interface InsightsReturnContext {
    insightSelectionEpoch: number;
    insightFocusNonce: number;
    selectedInsight: InsightSelection | null;
    expandedInsightGroups: ReadonlySet<string>;
    insightsFilter: InsightsFilter;
    panelList: boolean;
}
interface SubagentPageReturn {
    parentSessionId: string;
    context: InsightsReturnContext;
    expanded: boolean;
    collapsed: boolean;
    drawerContent: DrawerContent;
}
interface SessionLayoutState {
    activeSessionId: string | null;
    insightsReturns: ReadonlyMap<string, InsightsReturnContext>;
    subagentPageReturns: ReadonlyMap<string, SubagentPageReturn>;
    insightListPositions: ReadonlyMap<string, {
        top: number;
        focusNonce: number;
        sourceEpoch: number;
        anchor: {
            key: string;
            offset: number;
        } | null;
    }>;
    /** Unique fresh-visit source; exact child returns restore the saved parent source. */
    insightSelectionEpoch: number;
    /**
     * The drawer is closed. Focus opens a session with no drawer, so this
     * defaults to true; a header pill, the transcript or a desktop command
     * opens it on the route's panel.
     */
    collapsed: boolean;
    /** Whether the next collapsed change should tween; restoring a project's stored rail does not. */
    sidePanelAnimate: boolean;
    /**
     * Project the open preference belongs to. Null until the open session's
     * project is known. Only a store created with `rememberPerProject` restores
     * a project's stored drawer; Focus's default never does.
     */
    sidePanelProjectId: string | null;
    /** The floating drawer fills the window instead of its 560px column. */
    expanded: boolean;
    /**
     * Whether the layout has room to dock the drawer as a column beside the
     * chat, as the drawer reports it. The drawer always docks where it fits; a
     * phone or a narrow window floats it instead.
     */
    dockable: boolean;
    /** What the open drawer holds: the route's panel, or the session goal. */
    drawerContent: DrawerContent;
    /**
     * Whether a narrow panel is showing its list of rows. There is no room for
     * the list beside the detail at that width, so the panel opens on the row it
     * has selected and the list comes over it — as a dialog of its own on a
     * phone, in place of the detail on a tablet. Wide layouts ignore this.
     */
    panelList: boolean;
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
export type DrawerContent = "panel" | "goal";
/** One presentation lifetime; hosted preferences are ephemeral. */
export declare function createSessionLayoutStore(storage?: Pick<Storage, "getItem" | "setItem">, { rememberPerProject, }?: {
    /** Restore each project's last drawer state. Off: every session opens quiet. */
    rememberPerProject?: boolean;
}): {
    release: () => void;
    sessionLayoutStore: import("../lib/store").Store<SessionLayoutState>;
    bindSidePanelProject: (projectId: string) => void;
    unbindSidePanelProject: () => void;
    toggleSidePanelExpanded: () => void;
    leaveFocusedSidePanel: () => void;
    openSidePanelList: () => void;
    toggleSidePanelCollapsed: () => void;
    openDrawer: (drawerContent?: DrawerContent) => void;
    closeDrawer: () => void;
    setDrawerDockable: (dockable: boolean) => void;
    showSidePanelList: (panelList: boolean) => void;
    toggleSidePanelList: () => void;
    revealSidePanel: (_asDialog?: boolean) => void;
    selectInsight: (selectedInsight: InsightSelection | null) => void;
    toggleInsightGroup: (groupId: string, expanded?: boolean) => void;
    selectInsightsFilter: (insightsFilter: InsightsFilter) => void;
    selectSubagent: (parentSessionId: string, key: string) => void;
    selectRevision: (selectedRevision: number | null) => void;
    selectFile: (selectedFile: string | null) => void;
    toggleFolder: (path: string) => void;
    selectFileListing: (fileListing: FileListing) => void;
    setSidePanelAnimate: (sidePanelAnimate: boolean) => void;
    resetSessionSelection: () => void;
    activateSessionSelection: (sessionId: string | null) => void;
    rememberInsightsReturn: (parentSessionId: string, shown: InsightSelection | null) => void;
    restoreInsightsReturn: (parentSessionId: string) => boolean;
    rememberInsightListPosition: (sessionId: string, top: number, anchor?: {
        key: string;
        offset: number;
    } | null, source?: {
        focusNonce: number;
        sourceEpoch: number;
    }) => void;
    rememberSubagentPage: (parentSessionId: string, childSessionId: string) => void;
    useInsightsReturn: (sessionId: string) => boolean;
    useSidePanelCollapsed: () => boolean;
    useSidePanelAnimate: () => boolean;
    useSidePanelExpanded: () => boolean;
    useDrawerContent: () => DrawerContent;
    useSidePanelList: () => boolean;
    useSelectedInsight: () => InsightSelection | null;
    useInsightFocusNonce: () => number;
    useExpandedInsightGroups: () => ReadonlySet<string>;
    useInsightsFilter: () => InsightsFilter;
    useSelectedSubagent: (parentSessionId: string) => string | null;
    useSelectedRevision: () => number | null;
    useSelectedFile: () => string | null;
    useToggledFolders: () => ReadonlySet<string>;
    useFileListing: () => FileListing;
};
export declare const release: () => void, sessionLayoutStore: import("../lib/store").Store<SessionLayoutState>, bindSidePanelProject: (projectId: string) => void, unbindSidePanelProject: () => void, toggleSidePanelExpanded: () => void, leaveFocusedSidePanel: () => void, openSidePanelList: () => void, toggleSidePanelCollapsed: () => void, openDrawer: (drawerContent?: DrawerContent) => void, closeDrawer: () => void, setDrawerDockable: (dockable: boolean) => void, showSidePanelList: (panelList: boolean) => void, toggleSidePanelList: () => void, revealSidePanel: (_asDialog?: boolean) => void, selectInsight: (selectedInsight: InsightSelection | null) => void, toggleInsightGroup: (groupId: string, expanded?: boolean) => void, selectInsightsFilter: (insightsFilter: InsightsFilter) => void, selectSubagent: (parentSessionId: string, key: string) => void, selectRevision: (selectedRevision: number | null) => void, selectFile: (selectedFile: string | null) => void, toggleFolder: (path: string) => void, selectFileListing: (fileListing: FileListing) => void, setSidePanelAnimate: (sidePanelAnimate: boolean) => void, resetSessionSelection: () => void, activateSessionSelection: (sessionId: string | null) => void, rememberInsightsReturn: (parentSessionId: string, shown: InsightSelection | null) => void, restoreInsightsReturn: (parentSessionId: string) => boolean, rememberInsightListPosition: (sessionId: string, top: number, anchor?: {
    key: string;
    offset: number;
} | null, source?: {
    focusNonce: number;
    sourceEpoch: number;
}) => void, rememberSubagentPage: (parentSessionId: string, childSessionId: string) => void, useInsightsReturn: (sessionId: string) => boolean, useSidePanelCollapsed: () => boolean, useSidePanelAnimate: () => boolean, useSidePanelExpanded: () => boolean, useDrawerContent: () => DrawerContent, useSidePanelList: () => boolean, useSelectedInsight: () => InsightSelection | null, useInsightFocusNonce: () => number, useExpandedInsightGroups: () => ReadonlySet<string>, useInsightsFilter: () => InsightsFilter, useSelectedSubagent: (parentSessionId: string) => string | null, useSelectedRevision: () => number | null, useSelectedFile: () => string | null, useToggledFolders: () => ReadonlySet<string>, useFileListing: () => FileListing;
export {};
