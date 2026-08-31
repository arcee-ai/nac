// How the session screen splits between the side box and the chat, and which
// row the side box points at. Kept outside the URL because both are viewing
// preferences, not locations.

import { createStore } from "@/app/lib/store";

interface SessionLayoutState {
  /** Side box slid out of the row so the chat has the screen to itself. */
  collapsed: boolean;
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
  /** Agent thoughts/tools group the chat last pointed the Thoughts panel at. */
  selectedAgentSegment: string | null;
  /** Workset the chat last pointed the Worksets panel at. */
  selectedWorkset: string | null;
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

export const sessionLayoutStore = createStore<SessionLayoutState>({
  collapsed: false,
  expanded: false,
  panelList: false,
  selectedThread: null,
  selectedThreadEpisode: null,
  selectedThreadRunning: false,
  selectedAgentSegment: null,
  selectedWorkset: null,
  selectedRevision: null,
  selectedFile: null,
  toggledFolders: new Set(),
  fileListing: "tree",
});

const { getState, setState, useStore } = sessionLayoutStore;

/**
 * Show the side box as a dialog over the session, or put it back in the row.
 * It always comes up on the row it has open rather than on a list of rows.
 */
export function toggleSidePanelExpanded(): void {
  const expanded = !getState().expanded;
  setState(expanded ? { expanded, panelList: false } : { expanded });
}

/** Hide the side box so the chat gets the full width, or bring it back. */
export function toggleSidePanelCollapsed(): void {
  setState({ collapsed: !getState().collapsed });
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
  if (getState().collapsed) setState({ collapsed: false });
}

export function selectThread(
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
export function setSelectedThreadRunning(selectedThreadRunning: boolean): void {
  if (getState().selectedThreadRunning !== selectedThreadRunning) {
    setState({ selectedThreadRunning });
  }
}

export function selectAgentSegment(selectedAgentSegment: string | null): void {
  setState({ selectedAgentSegment });
  if (selectedAgentSegment) showSidePanelList(false);
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
    selectedAgentSegment: null,
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

export const useSidePanelCollapsed = () => useStore((s) => s.collapsed);
export const useSidePanelExpanded = () => useStore((s) => s.expanded);
export const useSidePanelList = () => useStore((s) => s.panelList);
export const useSelectedThread = () => useStore((s) => s.selectedThread);
export const useSelectedThreadEpisode = () =>
  useStore((s) => s.selectedThreadEpisode);
export const useSelectedThreadRunning = () =>
  useStore((s) => s.selectedThreadRunning);
export const useSelectedAgentSegment = () =>
  useStore((s) => s.selectedAgentSegment);
export const useSelectedWorkset = () => useStore((s) => s.selectedWorkset);
export const useSelectedRevision = () => useStore((s) => s.selectedRevision);
export const useSelectedFile = () => useStore((s) => s.selectedFile);
export const useToggledFolders = () => useStore((s) => s.toggledFolders);
export const useFileListing = () => useStore((s) => s.fileListing);
