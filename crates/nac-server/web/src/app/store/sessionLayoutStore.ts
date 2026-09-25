// How the session screen splits between the side box and the chat, and which
// row the side box points at. Kept outside the URL because both are viewing
// preferences, not locations.

import { createStore } from "@/app/lib/store";

interface SessionLayoutState {
  /** Side box slid off to its 52px icon rail. Defaults to collapsed. */
  collapsed: boolean;
  /**
   * Whether the next collapsed change should tween. A launch from the composer
   * opens a collapsed panel in place, so the chat column does not replay its
   * layout for half a second.
   */
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
  /** Revision the panels are looking at, or null for the live working tree. */
  selectedRevision: number | null;
  /** File the Files panel is showing. */
  selectedFile: string | null;
  /**
   * Subagents tab opened on a blank launch, from the parent composer's spawn
   * menu or from New Agent / New Orchestrator in the list.
   */
  subagentLaunch: "agent" | "orchestrator" | null;
  /** Bumps every time a blank subagent launch is requested, so the composer can take focus again. */
  subagentLaunchRequest: number;
  /** Folders flipped away from their default open state, by path. */
  toggledFolders: ReadonlySet<string>;
  /**
   * Whether the Changes panel lists the whole project as a tree or only what
   * git reports as changed.
   */
  fileListing: FileListing;
}

export type FileListing = "tree" | "changed";

export const sessionLayoutStore = createStore<SessionLayoutState>({
  collapsed: true,
  sidePanelAnimate: true,
  sidePanelProjectId: null,
  expanded: false,
  panelList: false,
  selectedThread: null,
  selectedThreadEpisode: null,
  selectedThreadRunning: false,
  selectedWorkset: null,
  selectedRevision: null,
  selectedFile: null,
  toggledFolders: new Set(),
  fileListing: "tree",
  subagentLaunch: null,
  subagentLaunchRequest: 0,
});

const { getState, setState, useStore } = sessionLayoutStore;

const COLLAPSED_STORAGE_PREFIX = "nac.rightSidebar.collapsed.";

function collapsedStorageKey(projectId: string): string {
  return `${COLLAPSED_STORAGE_PREFIX}${projectId || "none"}`;
}

function readCollapsed(projectId: string): boolean {
  try {
    const stored = localStorage.getItem(collapsedStorageKey(projectId));
    if (stored === "0") return false;
    if (stored === "1") return true;
  } catch {
    // A private-mode store that throws is the same as no preference.
  }
  return true;
}

function writeCollapsed(projectId: string, collapsed: boolean): void {
  try {
    localStorage.setItem(collapsedStorageKey(projectId), collapsed ? "1" : "0");
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
export function bindSidePanelProject(projectId: string): void {
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
 * Show the side box as a dialog over the session, or put it back in the row.
 * It always comes up on the row it has open rather than on a list of rows.
 */
export function toggleSidePanelExpanded(): void {
  const expanded = !getState().expanded;
  setState(expanded ? { expanded, panelList: false } : { expanded });
}

/** Slide the side box down to its icon rail, or bring the panel back. */
export function toggleSidePanelCollapsed(): void {
  applyCollapsed(!getState().collapsed);
}

/** Swap a narrow panel between its list of rows and the row it has open. */
export function showSidePanelList(panelList: boolean): void {
  if (getState().panelList !== panelList) setState({ panelList });
}

export function toggleSidePanelList(): void {
  setState({ panelList: !getState().panelList });
}

/**
 * Bring the side box back on screen when the chat points at one of its rows.
 * On a phone there is no row to slide back into, so it comes up as the dialog.
 */
export function revealSidePanel(asDialog = false): void {
  // The chat has already picked the row, so a narrow panel opens on the detail.
  setState({ panelList: false });
  if (asDialog) {
    if (!getState().expanded) setState({ expanded: true });
    return;
  }
  applyCollapsed(false);
}

export function selectThread(
  selectedThread: string | null,
  selectedThreadEpisode: string | null = null,
): void {
  if (import.meta.env.DEV) {
    console.debug("[nac:threads] select", { name: selectedThread, episode: selectedThreadEpisode });
  }
  setState({ selectedThread, selectedThreadEpisode });
  if (selectedThread) showSidePanelList(false);
}

/** Drive the phone dialog title shimmer from the Threads detail pane. */
export function setSelectedThreadRunning(selectedThreadRunning: boolean): void {
  if (getState().selectedThreadRunning !== selectedThreadRunning) {
    setState({ selectedThreadRunning });
  }
}

export function selectWorkset(selectedWorkset: string | null): void {
  setState({ selectedWorkset });
  if (selectedWorkset) showSidePanelList(false);
}

/** Point the panels at a captured revision, or back at the working tree. */
export function selectRevision(selectedRevision: number | null): void {
  setState({ selectedRevision });
}

export function selectFile(selectedFile: string | null): void {
  setState({ selectedFile });
  if (selectedFile) showSidePanelList(false);
}

/** Flip one folder away from whatever the tree opens by default. */
export function toggleFolder(path: string): void {
  setState((state) => {
    const next = new Set(state.toggledFolders);
    if (!next.delete(path)) next.add(path);
    return { toggledFolders: next };
  });
}

export function selectFileListing(fileListing: FileListing): void {
  setState({ fileListing });
}

/** Open the Subagents tab on a blank agent or orchestrator launch. */
export function openSubagentLaunch(subagentLaunch: "agent" | "orchestrator"): void {
  setState((state) => ({
    subagentLaunch,
    panelList: false,
    subagentLaunchRequest: state.subagentLaunchRequest + 1,
    collapsed: false,
    // The chat is laid out against the column width. Tweening that from the
    // rail to half the screen reflows the whole transcript, which reads as the
    // session resetting. The panel is already full size off to the side, so it
    // can appear without that tween.
    sidePanelAnimate: state.collapsed ? false : state.sidePanelAnimate,
  }));
  rememberCollapsed(false);
}

export function setSidePanelAnimate(sidePanelAnimate: boolean): void {
  if (getState().sidePanelAnimate !== sidePanelAnimate) setState({ sidePanelAnimate });
}

export function clearSubagentLaunch(): void {
  if (getState().subagentLaunch != null) setState({ subagentLaunch: null });
}

/**
 * Wipe the session-scoped pointers that belong to the inspector we just left.
 * Threads, worksets, revisions, files and folders belong to one session, so
 * carrying them into another would point the panels at something that is not
 * theirs. A leftover selectedThread in particular was injected into the next
 * session's thread list as a ghost row that vanished the moment you clicked a
 * real one.
 */
export function resetSessionSelection(): void {
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
    subagentLaunch: null,
  });
}

if (import.meta.env.DEV) {
  Object.assign(globalThis, { __nacSelectThread: selectThread });
}

export const useSidePanelCollapsed = () => useStore((s) => s.collapsed);
export const useSidePanelAnimate = () => useStore((s) => s.sidePanelAnimate);
export const useSidePanelExpanded = () => useStore((s) => s.expanded);
export const useSidePanelList = () => useStore((s) => s.panelList);
export const useSelectedThread = () => useStore((s) => s.selectedThread);
export const useSelectedThreadEpisode = () => useStore((s) => s.selectedThreadEpisode);
export const useSelectedThreadRunning = () => useStore((s) => s.selectedThreadRunning);
export const useSelectedWorkset = () => useStore((s) => s.selectedWorkset);
export const useSelectedRevision = () => useStore((s) => s.selectedRevision);
export const useSelectedFile = () => useStore((s) => s.selectedFile);
export const useToggledFolders = () => useStore((s) => s.toggledFolders);
export const useFileListing = () => useStore((s) => s.fileListing);
export const useSubagentLaunch = () => useStore((s) => s.subagentLaunch);
export const useSubagentLaunchRequest = () => useStore((s) => s.subagentLaunchRequest);
