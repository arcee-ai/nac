import { createStore } from "@/app/lib/store";

interface SidebarLayoutState {
  /** Pixels the session sidebar reserves. Zero when that sidebar is not mounted. */
  offset: number;
}

const sidebarLayoutStore = createStore<SidebarLayoutState>({ offset: 0 }, "sidebar-layout");

export function setSidebarOffset(offset: number): void {
  sidebarLayoutStore.setState({ offset });
}

export function useSidebarOffset(): number {
  return sidebarLayoutStore.useStore((state) => state.offset);
}
