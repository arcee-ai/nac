import { createStore } from "../lib/store.js";

export const TABS = ["chat", "events", "threads", "worksets", "workspace"];

// UI/selection state: which session is selected, the active inspector tab, and
// cross-cutting layout flags (mirrors the old app.js globals).
export const selectionStore = createStore({
  selectedId: null,
  activeTab: "chat",
  inspectorFullscreen: false,
  mobileDetailOpen: false,
  paneRatio: 0.38, // board vs inspector split
});

const { setState, useStore } = selectionStore;

export function selectSession(id) {
  setState({ selectedId: id, mobileDetailOpen: true });
}
export function clearSelection() {
  setState({ selectedId: null, mobileDetailOpen: false });
}
export function setActiveTab(tab) {
  if (TABS.includes(tab)) setState({ activeTab: tab });
}
export function setInspectorFullscreen(on) {
  setState({ inspectorFullscreen: !!on });
}
export function toggleInspectorFullscreen() {
  setState((s) => ({ inspectorFullscreen: !s.inspectorFullscreen }));
}
export function setMobileDetailOpen(on) {
  setState({ mobileDetailOpen: !!on });
}
export function setPaneRatio(ratio) {
  const clamped = Math.min(0.75, Math.max(0.2, ratio));
  setState({ paneRatio: clamped });
}

// ---- selectors / hooks ----
export const useSelectedId = () => useStore((s) => s.selectedId);
export const useActiveTab = () => useStore((s) => s.activeTab);
export const useInspectorFullscreen = () => useStore((s) => s.inspectorFullscreen);
export const useMobileDetailOpen = () => useStore((s) => s.mobileDetailOpen);
export const usePaneRatio = () => useStore((s) => s.paneRatio);
