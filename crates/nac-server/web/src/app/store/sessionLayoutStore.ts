// How the session screen splits between the side box and the chat. Kept outside
// the URL because it is a viewing preference, not a location.

import { createStore } from "@/app/lib/store";

export type SidePanelLayout = "split" | "expanded" | "collapsed";

interface SessionLayoutState {
  layout: SidePanelLayout;
}

export const sessionLayoutStore = createStore<SessionLayoutState>({
  layout: "split",
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

export const useSidePanelLayout = () => useStore((s) => s.layout);
