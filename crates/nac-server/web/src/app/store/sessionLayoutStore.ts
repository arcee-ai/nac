// How the session screen splits between the side box and the chat, and which
// row the side box points at. Kept outside the URL because both are viewing
// preferences, not locations.

import { createStore } from "@/app/lib/store";

export type SidePanelLayout = "split" | "expanded" | "collapsed";

interface SessionLayoutState {
  layout: SidePanelLayout;
  /** Thread the chat last pointed the Threads panel at. */
  selectedThread: string | null;
  /** Workset the chat last pointed the Worksets panel at. */
  selectedWorkset: string | null;
  /** Revision the panels are looking at, or null for the live working tree. */
  selectedRevision: number | null;
}

export const sessionLayoutStore = createStore<SessionLayoutState>({
  layout: "split",
  selectedThread: null,
  selectedWorkset: null,
  selectedRevision: null,
});

const { getState, setState, useStore } = sessionLayoutStore;

/** Expand the side box over the chat, or go back to the even split. */
export function toggleSidePanelExpanded(): void {
  setState({ layout: getState().layout === "expanded" ? "split" : "expanded" });
}

/** Hide the side box so the chat gets the full width, or bring it back. */
export function toggleSidePanelCollapsed(): void {
  setState({ layout: getState().layout === "collapsed" ? "split" : "collapsed" });
}

/** Bring the side box back on screen when the chat points at one of its rows. */
export function revealSidePanel(): void {
  if (getState().layout === "collapsed") setState({ layout: "split" });
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

export const useSidePanelLayout = () => useStore((s) => s.layout);
export const useSelectedThread = () => useStore((s) => s.selectedThread);
export const useSelectedWorkset = () => useStore((s) => s.selectedWorkset);
export const useSelectedRevision = () => useStore((s) => s.selectedRevision);
