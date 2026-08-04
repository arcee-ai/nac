// How the session screen splits between the side box and the chat, and which
// row the side box points at. Kept outside the URL because both are viewing
// preferences, not locations.

import { createStore } from "@/app/lib/store";

interface SessionLayoutState {
  /** Side box slid out of the row so the chat has the screen to itself. */
  collapsed: boolean;
  /** Side box lifted out of the row into a full-screen dialog. */
  expanded: boolean;
  /** Thread the chat last pointed the Threads panel at. */
  selectedThread: string | null;
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
  selectedThread: null,
  selectedWorkset: null,
  selectedRevision: null,
  selectedFile: null,
  toggledFolders: new Set(),
  fileListing: "tree",
});

const { getState, setState, useStore } = sessionLayoutStore;

/** Show the side box as a dialog over the session, or put it back in the row. */
export function toggleSidePanelExpanded(): void {
  setState({ expanded: !getState().expanded });
}

/** Hide the side box so the chat gets the full width, or bring it back. */
export function toggleSidePanelCollapsed(): void {
  setState({ collapsed: !getState().collapsed });
}

/** Bring the side box back on screen when the chat points at one of its rows. */
export function revealSidePanel(): void {
  if (getState().collapsed) setState({ collapsed: false });
}

export function selectThread(selectedThread: string | null): void {
  setState({ selectedThread });
}

export function selectWorkset(selectedWorkset: string | null): void {
  setState({ selectedWorkset });
}

/** Point the panels at a captured revision, or back at the working tree. */
export function selectRevision(selectedRevision: number | null): void {
  setState({ selectedRevision });
}

export function selectFile(selectedFile: string | null): void {
  setState({ selectedFile });
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
 * Revisions, files and folders belong to one session, so carrying them into
 * another would point the panels at something that is not theirs.
 */
export function resetSessionSelection(): void {
  setState({
    selectedRevision: null,
    selectedFile: null,
    toggledFolders: new Set(),
  });
}

export const useSidePanelCollapsed = () => useStore((s) => s.collapsed);
export const useSidePanelExpanded = () => useStore((s) => s.expanded);
export const useSelectedThread = () => useStore((s) => s.selectedThread);
export const useSelectedWorkset = () => useStore((s) => s.selectedWorkset);
export const useSelectedRevision = () => useStore((s) => s.selectedRevision);
export const useSelectedFile = () => useStore((s) => s.selectedFile);
export const useToggledFolders = () => useStore((s) => s.toggledFolders);
export const useFileListing = () => useStore((s) => s.fileListing);
