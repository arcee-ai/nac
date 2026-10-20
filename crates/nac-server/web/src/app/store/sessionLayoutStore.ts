// How the session screen splits between the side box and the chat, and which
// row the side box points at. Kept outside the URL because both are viewing
// preferences, not locations.

import { createStore, standalonePreferenceStorage } from "@/app/lib/store";

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
  /** Side box lifted out of the row into a full-screen dialog. */
  expanded: boolean;
  /**
   * Whether a narrow panel is showing its list of rows. There is no room for
   * the list beside the detail at that width, so the panel opens on the row it
   * has selected and the list comes over it — as a dialog of its own on a
   * phone, in place of the detail on a tablet. Wide layouts ignore this.
   */
  panelList: boolean;
  /** Thread the chat last pointed the Threads panel at. */
  selectedThread: string | null;
  /**
   * Which of that thread's chat cards did the pointing, or null when the pick
   * came from the panel's own list. A re-dispatched thread has one card per
   * episode, and only the card clicked belongs highlighted.
   */
  selectedThreadEpisode: string | null;
  /**
   * Whether the Threads detail pane considers the open thread running. The
   * phone dialog header reads this so its title shimmer matches the panel.
   */
  selectedThreadRunning: boolean;
  /** Workset the chat last pointed the Worksets panel at. */
  selectedWorkset: string | null;
  /**
   * Subagent row each parent's Subagents panel has open, by parent session.
   * Kept per parent rather than reset with the session, so returning from a
   * subagent's transcript reopens the row that was open.
   */
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
export function createSessionLayoutStore(storage?: Pick<Storage, "getItem" | "setItem">) {
  const sessionLayoutStore = createStore<SessionLayoutState>({
    collapsed: true,
    sidePanelAnimate: true,
    sidePanelProjectId: null,
    expanded: false,
    panelList: false,
    selectedThread: null,
    selectedThreadEpisode: null,
    selectedThreadRunning: false,
    selectedWorkset: null,
    selectedSubagents: new Map(),
    selectedRevision: null,
    selectedFile: null,
    toggledFolders: new Set(),
    fileListing: "tree",
  });
  const initial_sessionLayoutStore = sessionLayoutStore.getState();

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
    setState({
      sidePanelProjectId: null,
      collapsed: true,
      sidePanelAnimate: false,
    });
  }

  /**
   * Show the side box as a dialog over the session, or put it back in the row.
   * It always comes up on the row it has open rather than on a list of rows.
   */
  function toggleSidePanelExpanded(): void {
    const expanded = !getState().expanded;
    setState(expanded ? { expanded, panelList: false } : { expanded });
  }

  /** Slide the side box down to its icon rail, or bring the panel back. */
  function toggleSidePanelCollapsed(): void {
    applyCollapsed(!getState().collapsed);
  }

  /** Swap a narrow panel between its list of rows and the row it has open. */
  function showSidePanelList(panelList: boolean): void {
    if (getState().panelList !== panelList) setState({ panelList });
  }

  function toggleSidePanelList(): void {
    setState({ panelList: !getState().panelList });
  }

  /**
   * Bring the side box back on screen when the chat points at one of its rows.
   * On a phone there is no row to slide back into, so it comes up as the dialog.
   */
  function revealSidePanel(asDialog = false): void {
    // The chat has already picked the row, so a narrow panel opens on the detail.
    setState({ panelList: false });
    if (asDialog) {
      if (!getState().expanded) setState({ expanded: true });
      return;
    }
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

  /** Drive the phone dialog title shimmer from the Threads detail pane. */
  function setSelectedThreadRunning(selectedThreadRunning: boolean): void {
    if (getState().selectedThreadRunning !== selectedThreadRunning) {
      setState({ selectedThreadRunning });
    }
  }

  function selectWorkset(selectedWorkset: string | null): void {
    setState({ selectedWorkset });
    if (selectedWorkset) showSidePanelList(false);
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
   * Threads, worksets, revisions, files and folders belong to one session, so
   * carrying them into another would point the panels at something that is not
   * theirs. A leftover selectedThread in particular was injected into the next
   * session's thread list as a ghost row that vanished the moment you clicked a
   * real one.
   */
  function resetSessionSelection(): void {
    if (import.meta.env.DEV) {
      const prev = getState();
      console.debug("[nac:threads] resetSessionSelection", {
        selectedThread: prev.selectedThread,
        selectedWorkset: prev.selectedWorkset,
      });
    }
    setState({
      selectedThread: null,
      selectedThreadEpisode: null,
      selectedWorkset: null,
      selectedRevision: null,
      selectedFile: null,
      toggledFolders: new Set(),
      panelList: false,
      selectedThreadRunning: false,
    });
  }

  if (import.meta.env.DEV) {
    Object.assign(globalThis, { __nacSelectThread: selectThread });
  }

  const useSidePanelCollapsed = () => useStore((s) => s.collapsed);
  const useSidePanelAnimate = () => useStore((s) => s.sidePanelAnimate);
  const useSidePanelExpanded = () => useStore((s) => s.expanded);
  const useSidePanelList = () => useStore((s) => s.panelList);
  const useSelectedThread = () => useStore((s) => s.selectedThread);
  const useSelectedThreadEpisode = () => useStore((s) => s.selectedThreadEpisode);
  const useSelectedThreadRunning = () => useStore((s) => s.selectedThreadRunning);
  const useSelectedWorkset = () => useStore((s) => s.selectedWorkset);
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
    toggleSidePanelCollapsed,
    showSidePanelList,
    toggleSidePanelList,
    revealSidePanel,
    selectThread,
    setSelectedThreadRunning,
    selectWorkset,
    selectSubagent,
    selectRevision,
    selectFile,
    toggleFolder,
    selectFileListing,
    setSidePanelAnimate,
    resetSessionSelection,
    useSidePanelCollapsed,
    useSidePanelAnimate,
    useSidePanelExpanded,
    useSidePanelList,
    useSelectedThread,
    useSelectedThreadEpisode,
    useSelectedThreadRunning,
    useSelectedWorkset,
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
  toggleSidePanelCollapsed,
  showSidePanelList,
  toggleSidePanelList,
  revealSidePanel,
  selectThread,
  setSelectedThreadRunning,
  selectWorkset,
  selectSubagent,
  selectRevision,
  selectFile,
  toggleFolder,
  selectFileListing,
  setSidePanelAnimate,
  resetSessionSelection,
  useSidePanelCollapsed,
  useSidePanelAnimate,
  useSidePanelExpanded,
  useSidePanelList,
  useSelectedThread,
  useSelectedThreadEpisode,
  useSelectedThreadRunning,
  useSelectedWorkset,
  useSelectedSubagent,
  useSelectedRevision,
  useSelectedFile,
  useToggledFolders,
  useFileListing,
} = createSessionLayoutStore(standalonePreferenceStorage);
