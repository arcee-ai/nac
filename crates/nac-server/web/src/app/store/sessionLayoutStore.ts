// Whether the session's drawer is open (floating or docked beside the chat),
// and which row its panels point at. Kept outside the URL because both are
// viewing preferences, not locations; the route's `:panel` picks the content.

import type { InsightsFilter } from "@/app/features/insights/model/types";
import { createStore, standalonePreferenceStorage } from "@/app/lib/store";

/** What the Insights detail shows. A thread reads its name from `selectedThread`. */
export type InsightSelection =
  | { kind: "group"; groupId: string; segmentKey: string | null }
  | { kind: "thread" };

/** A reader-owned origin. Streaming data never writes these saved pointers. */
interface InsightsReturnContext {
  insightSelectionEpoch: number;
  insightFocusNonce: number;
  selectedInsight: InsightSelection | null;
  selectedThread: string | null;
  selectedThreadEpisode: string | null;
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
  insightListPositions: ReadonlyMap<
    string,
    {
      top: number;
      focusNonce: number;
      sourceEpoch: number;
      anchor: { key: string; offset: number } | null;
    }
  >;

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
  /** The drawer docks as a column beside the chat instead of floating (⌘\). */
  pinned: boolean;
  /** What the open drawer holds: the route's panel, or the session goal. */
  drawerContent: DrawerContent;
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
export function createSessionLayoutStore(
  storage?: Pick<Storage, "getItem" | "setItem">,
  {
    rememberPerProject = false,
  }: {
    /** Restore each project's last drawer state. Off: every session opens quiet. */
    rememberPerProject?: boolean;
  } = {},
) {
  const sessionLayoutStore = createStore<SessionLayoutState>({
    insightSelectionEpoch: 0,
    activeSessionId: null,
    insightsReturns: new Map(),
    subagentPageReturns: new Map(),
    insightListPositions: new Map(),
    collapsed: true,
    sidePanelAnimate: true,
    sidePanelProjectId: null,
    expanded: false,
    pinned: false,
    drawerContent: "panel",
    panelList: false,
    selectedThread: null,
    selectedThreadEpisode: null,
    selectedInsight: null,
    insightFocusNonce: 0,
    expandedInsightGroups: new Set(),
    insightsFilter: "all",
    selectedSubagents: new Map(),
    selectedRevision: null,
    selectedFile: null,
    toggledFolders: new Set(),
    fileListing: "tree",
  });
  const initial_sessionLayoutStore = sessionLayoutStore.getState();
  // Restoring an older parent source must never rewind the allocator.
  let nextInsightSelectionEpoch = 0;

  const { getState, setState, useStore } = sessionLayoutStore;

  const COLLAPSED_STORAGE_PREFIX = "nac.rightSidebar.collapsed.";

  function collapsedStorageKey(projectId: string): string {
    return `${COLLAPSED_STORAGE_PREFIX}${projectId || "none"}`;
  }

  function readCollapsed(projectId: string): boolean {
    try {
      const stored = storage?.getItem(collapsedStorageKey(projectId));
      if (stored === "0") return false;
      if (stored === "1") return true;
    } catch {
      // A private-mode store that throws is the same as no preference.
    }
    return true;
  }

  function writeCollapsed(projectId: string, collapsed: boolean): void {
    try {
      storage?.setItem(collapsedStorageKey(projectId), collapsed ? "1" : "0");
    } catch {
      // Preference is convenience; the panel still works without it.
    }
  }

  function rememberCollapsed(collapsed: boolean): void {
    if (!rememberPerProject) return;
    const projectId = getState().sidePanelProjectId;
    if (projectId == null) return;
    writeCollapsed(projectId, collapsed);
  }

  function applyCollapsed(collapsed: boolean): void {
    if (getState().collapsed !== collapsed) setState({ collapsed });
    rememberCollapsed(collapsed);
  }

  /**
   * Bind the collapse preference to the session's project. Each project keeps
   * its own stored rail state. A missing value starts collapsed, except when the
   * user already opened the panel before the project id was known — that click
   * must not be overwritten by the default.
   */
  function bindSidePanelProject(projectId: string): void {
    const current = getState().sidePanelProjectId;
    if (current === projectId) return;
    if (!rememberPerProject) {
      setState({ sidePanelProjectId: projectId });
      return;
    }
    const openedBeforeBind = current == null && !getState().collapsed;
    const collapsed = openedBeforeBind ? false : readCollapsed(projectId);
    const changed = getState().collapsed !== collapsed;
    setState({
      sidePanelProjectId: projectId,
      collapsed,
      sidePanelAnimate: changed ? false : getState().sidePanelAnimate,
    });
    if (openedBeforeBind) writeCollapsed(projectId, false);
  }

  /**
   * Drop the project binding without writing storage. The next session's first
   * bind can then honor a Show-panel click that happened while the summary was
   * still loading, instead of recording that click on the previous project.
   */
  function unbindSidePanelProject(): void {
    // Already unbound: keep whatever the user did while the next project loaded.
    // Collapsing here would hide a Show-panel click from `openedBeforeBind`.
    if (getState().sidePanelProjectId == null) return;
    if (!rememberPerProject) {
      setState({ sidePanelProjectId: null });
      return;
    }
    setState({
      sidePanelProjectId: null,
      collapsed: true,
      sidePanelAnimate: false,
    });
  }

  /** Let the floating drawer fill the window, or put it back in its column. */
  function toggleSidePanelExpanded(): void {
    const expanded = !getState().expanded;
    setState(expanded ? { expanded, panelList: false } : { expanded });
  }

  /** Put a full-width drawer back in its column; nothing when it is not full width. */
  function leaveFocusedSidePanel(): void {
    if (getState().expanded) setState({ expanded: false });
  }

  /** Open the drawer on its panel's list of rows (a phone shows lists first). */
  function openSidePanelList(): void {
    setState({ drawerContent: "panel", panelList: true });
    applyCollapsed(false);
  }

  /** Open the drawer when it is closed, close it when it is open. */
  function toggleSidePanelCollapsed(): void {
    applyCollapsed(!getState().collapsed);
  }

  /** Open the drawer on the given content; the route says which panel. */
  function openDrawer(drawerContent: DrawerContent = "panel"): void {
    if (getState().drawerContent !== drawerContent) setState({ drawerContent });
    applyCollapsed(false);
  }

  /** Close the drawer, floating or docked. Pinning is kept for the next open. */
  function closeDrawer(): void {
    if (getState().expanded) setState({ expanded: false });
    applyCollapsed(true);
  }

  /** ⌘\: dock the drawer beside the chat, or float it again. Opens it when closed. */
  function toggleDrawerPinned(): void {
    const state = getState();
    if (state.collapsed) {
      setState({ pinned: true, expanded: false });
      applyCollapsed(false);
      return;
    }
    setState({ pinned: !state.pinned, expanded: false });
  }

  /** Swap a narrow panel between its list of rows and the row it has open. */
  function showSidePanelList(panelList: boolean): void {
    if (getState().panelList !== panelList) setState({ panelList });
  }

  function toggleSidePanelList(): void {
    setState({ panelList: !getState().panelList });
  }

  /**
   * Open the drawer when the chat points at one of its rows. The argument is
   * kept for callers from the two-column era; every width now opens the same
   * drawer (a bottom sheet on a phone).
   */
  function revealSidePanel(_asDialog = false): void {
    // The chat has already picked the row, so a narrow panel opens on the detail.
    setState({ panelList: false, drawerContent: "panel" });
    applyCollapsed(false);
  }

  function selectThread(
    selectedThread: string | null,
    selectedThreadEpisode: string | null = null,
  ): void {
    if (import.meta.env.DEV) {
      console.debug("[nac:threads] select", {
        name: selectedThread,
        episode: selectedThreadEpisode,
      });
    }
    setState({ selectedThread, selectedThreadEpisode });
    if (selectedThread) showSidePanelList(false);
  }

  /**
   * Point the Insights detail at an entry. Leaves the narrow list alone: a
   * group row both opens its children there and selects itself.
   */
  function selectInsight(selectedInsight: InsightSelection | null): void {
    setState((state) =>
      selectedInsight == null
        ? { selectedInsight }
        : { selectedInsight, insightFocusNonce: state.insightFocusNonce + 1 },
    );
  }

  /** Open or close one Insights group's child rows; flips it when `expanded` is omitted. */
  function toggleInsightGroup(groupId: string, expanded?: boolean): void {
    setState((state) => {
      const open = state.expandedInsightGroups.has(groupId);
      if (expanded === open) return null;
      const next = new Set(state.expandedInsightGroups);
      if (open) next.delete(groupId);
      else next.add(groupId);
      return { expandedInsightGroups: next };
    });
  }

  function selectInsightsFilter(insightsFilter: InsightsFilter): void {
    if (getState().insightsFilter !== insightsFilter) setState({ insightsFilter });
  }

  function insightsContext(): InsightsReturnContext {
    const state = getState();
    return {
      insightSelectionEpoch: state.insightSelectionEpoch,
      insightFocusNonce: state.insightFocusNonce,
      selectedInsight: state.selectedInsight,
      selectedThread: state.selectedThread,
      selectedThreadEpisode: state.selectedThreadEpisode,
      expandedInsightGroups: state.expandedInsightGroups,
      insightsFilter: state.insightsFilter,
      panelList: state.panelList,
    };
  }

  /** Capture only on an intentional jump, never on refetch or a stream delta. */
  function rememberInsightsReturn(
    parentSessionId: string,
    shown: InsightSelection | null,
    thread?: { name: string; episode: string | null },
  ): void {
    const context = {
      ...insightsContext(),
      selectedInsight: shown,
      ...(thread ? { selectedThread: thread.name, selectedThreadEpisode: thread.episode } : {}),
    };
    setState((state) => ({
      insightsReturns: new Map(state.insightsReturns).set(parentSessionId, context),
    }));
  }

  function restoreInsightsReturn(parentSessionId: string): boolean {
    const context = getState().insightsReturns.get(parentSessionId);
    if (!context) return false;
    const remaining = new Map(getState().insightsReturns);
    remaining.delete(parentSessionId);
    setState({ ...context, insightsReturns: remaining });
    return true;
  }

  function rememberInsightListPosition(
    sessionId: string,
    top: number,
    anchor: { key: string; offset: number } | null = null,
    source?: { focusNonce: number; sourceEpoch: number },
  ): void {
    setState((state) => ({
      insightListPositions: new Map(state.insightListPositions).set(sessionId, {
        top,
        focusNonce: source?.focusNonce ?? state.insightFocusNonce,
        sourceEpoch: source?.sourceEpoch ?? state.insightSelectionEpoch,
        anchor,
      }),
    }));
  }

  /** Save the panel before Open leaves for the child's own Insights/Files. */
  function rememberSubagentPage(parentSessionId: string, childSessionId: string): void {
    const { expanded, collapsed, drawerContent } = getState();
    setState((state) => ({
      subagentPageReturns: new Map(state.subagentPageReturns).set(childSessionId, {
        parentSessionId,
        context: insightsContext(),
        expanded,
        collapsed,
        drawerContent,
      }),
    }));
  }

  /**
   * Only the exact child→parent round trip may restore a saved parent panel.
   * Any other move to a new session closes a floating drawer: the next chat
   * opens quiet. A docked drawer is a layout the user chose, so it stays.
   */
  function activateSessionSelection(sessionId: string | null): void {
    const state = getState();
    if (state.activeSessionId === sessionId) return;
    const back = state.activeSessionId
      ? state.subagentPageReturns.get(state.activeSessionId)
      : null;
    const arriving = state.activeSessionId != null;
    resetSessionSelection();
    setState({ activeSessionId: sessionId });
    if (back && back.parentSessionId === sessionId) {
      setState({
        ...back.context,
        expanded: back.expanded,
        collapsed: back.collapsed,
        drawerContent: back.drawerContent,
      });
    } else if (arriving && !state.pinned && !state.collapsed) {
      setState({ collapsed: true, expanded: false, drawerContent: "panel" });
    }
  }

  function selectSubagent(parentSessionId: string, key: string): void {
    if (getState().selectedSubagents.get(parentSessionId) === key) return;
    setState((state) => ({
      selectedSubagents: new Map(state.selectedSubagents).set(parentSessionId, key),
    }));
  }

  /** Point the panels at a captured revision, or back at the working tree. */
  function selectRevision(selectedRevision: number | null): void {
    setState({ selectedRevision });
  }

  function selectFile(selectedFile: string | null): void {
    setState({ selectedFile });
    if (selectedFile) showSidePanelList(false);
  }

  /** Flip one folder away from whatever the tree opens by default. */
  function toggleFolder(path: string): void {
    setState((state) => {
      const next = new Set(state.toggledFolders);
      if (!next.delete(path)) next.add(path);
      return { toggledFolders: next };
    });
  }

  function selectFileListing(fileListing: FileListing): void {
    setState({ fileListing });
  }

  function setSidePanelAnimate(sidePanelAnimate: boolean): void {
    if (getState().sidePanelAnimate !== sidePanelAnimate) setState({ sidePanelAnimate });
  }

  /**
   * Wipe the session-scoped pointers that belong to the inspector we just left.
   * Threads, Insights entries, revisions, files and folders belong
   * to one session, so carrying them into another would point the panels at
   * something that is not theirs. A leftover selectedThread in particular was
   * injected into the next session's thread list as a ghost row that vanished
   * the moment you clicked a real one.
   */
  function resetSessionSelection(): void {
    if (import.meta.env.DEV) {
      const prev = getState();
      console.debug("[nac:threads] resetSessionSelection", {
        selectedThread: prev.selectedThread,
      });
    }
    setState({
      insightSelectionEpoch: ++nextInsightSelectionEpoch,
      selectedThread: null,
      selectedThreadEpisode: null,
      selectedInsight: null,
      insightFocusNonce: 0,
      expandedInsightGroups: new Set(),
      insightsFilter: "all",
      selectedRevision: null,
      selectedFile: null,
      toggledFolders: new Set(),
      panelList: false,
    });
  }

  if (import.meta.env.DEV) {
    Object.assign(globalThis, { __nacSelectThread: selectThread });
  }

  const useSidePanelCollapsed = () => useStore((s) => s.collapsed);
  const useSidePanelAnimate = () => useStore((s) => s.sidePanelAnimate);
  const useSidePanelExpanded = () => useStore((s) => s.expanded);
  const useDrawerPinned = () => useStore((s) => s.pinned);
  const useDrawerContent = () => useStore((s) => s.drawerContent);
  const useSidePanelList = () => useStore((s) => s.panelList);
  const useSelectedThread = () => useStore((s) => s.selectedThread);
  const useSelectedThreadEpisode = () => useStore((s) => s.selectedThreadEpisode);
  const useSelectedInsight = () => useStore((s) => s.selectedInsight);
  const useInsightFocusNonce = () => useStore((s) => s.insightFocusNonce);
  const useExpandedInsightGroups = () => useStore((s) => s.expandedInsightGroups);
  const useInsightsFilter = () => useStore((s) => s.insightsFilter);
  const useSelectedSubagent = (parentSessionId: string) =>
    useStore((s) => s.selectedSubagents.get(parentSessionId) ?? null);
  const useSelectedRevision = () => useStore((s) => s.selectedRevision);
  const useSelectedFile = () => useStore((s) => s.selectedFile);
  const useToggledFolders = () => useStore((s) => s.toggledFolders);
  const useFileListing = () => useStore((s) => s.fileListing);
  return {
    release: () => {
      sessionLayoutStore.setState(initial_sessionLayoutStore);
    },
    sessionLayoutStore,
    bindSidePanelProject,
    unbindSidePanelProject,
    toggleSidePanelExpanded,
    leaveFocusedSidePanel,
    openSidePanelList,
    toggleSidePanelCollapsed,
    openDrawer,
    closeDrawer,
    toggleDrawerPinned,
    showSidePanelList,
    toggleSidePanelList,
    revealSidePanel,
    selectThread,
    selectInsight,
    toggleInsightGroup,
    selectInsightsFilter,
    selectSubagent,
    selectRevision,
    selectFile,
    toggleFolder,
    selectFileListing,
    setSidePanelAnimate,
    resetSessionSelection,
    activateSessionSelection,
    rememberInsightsReturn,
    restoreInsightsReturn,
    rememberInsightListPosition,
    rememberSubagentPage,
    useInsightsReturn: (sessionId: string) => useStore((s) => s.insightsReturns.has(sessionId)),
    useSidePanelCollapsed,
    useSidePanelAnimate,
    useSidePanelExpanded,
    useDrawerPinned,
    useDrawerContent,
    useSidePanelList,
    useSelectedThread,
    useSelectedThreadEpisode,
    useSelectedInsight,
    useInsightFocusNonce,
    useExpandedInsightGroups,
    useInsightsFilter,
    useSelectedSubagent,
    useSelectedRevision,
    useSelectedFile,
    useToggledFolders,
    useFileListing,
  };
}

export const {
  release,
  sessionLayoutStore,
  bindSidePanelProject,
  unbindSidePanelProject,
  toggleSidePanelExpanded,
  leaveFocusedSidePanel,
  openSidePanelList,
  toggleSidePanelCollapsed,
  openDrawer,
  closeDrawer,
  toggleDrawerPinned,
  showSidePanelList,
  toggleSidePanelList,
  revealSidePanel,
  selectThread,
  selectInsight,
  toggleInsightGroup,
  selectInsightsFilter,
  selectSubagent,
  selectRevision,
  selectFile,
  toggleFolder,
  selectFileListing,
  setSidePanelAnimate,
  resetSessionSelection,
  activateSessionSelection,
  rememberInsightsReturn,
  restoreInsightsReturn,
  rememberInsightListPosition,
  rememberSubagentPage,
  useInsightsReturn,
  useSidePanelCollapsed,
  useSidePanelAnimate,
  useSidePanelExpanded,
  useDrawerPinned,
  useDrawerContent,
  useSidePanelList,
  useSelectedThread,
  useSelectedThreadEpisode,
  useSelectedInsight,
  useInsightFocusNonce,
  useExpandedInsightGroups,
  useInsightsFilter,
  useSelectedSubagent,
  useSelectedRevision,
  useSelectedFile,
  useToggledFolders,
  useFileListing,
} = createSessionLayoutStore(standalonePreferenceStorage);
