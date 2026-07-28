import { createStore } from "../lib/store.js";

export const TABS = ["chat", "events", "threads", "worksets", "workspace"];

// UI/selection state: which session is selected and the active inspector tab.
// Which screen is showing lives in routeStore.
export const selectionStore = createStore({
  selectedId: null,
  activeTab: "chat",
});

const { setState, useStore } = selectionStore;

export function selectSession(id) {
  setState({ selectedId: id });
}
export function clearSelection() {
  setState({ selectedId: null });
}
export function setActiveTab(tab) {
  if (TABS.includes(tab)) setState({ activeTab: tab });
}

// ---- selectors / hooks ----
export const useSelectedId = () => useStore((s) => s.selectedId);
export const useActiveTab = () => useStore((s) => s.activeTab);
