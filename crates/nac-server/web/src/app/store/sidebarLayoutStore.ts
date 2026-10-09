import { createStore, standalonePreferenceStorage } from "@/app/lib/store";

interface SidebarLayoutState {
  /** Pixels the session sidebar reserves. Zero when that sidebar is not mounted. */
  offset: number;
}
/** One presentation lifetime; hosted preferences are ephemeral. */
export function createSidebarLayoutStore(storage?: Pick<Storage, "getItem" | "setItem">) {
  const sidebarLayoutStore = createStore<SidebarLayoutState>({ offset: 0 }, "sidebar-layout");
  const initial_sidebarLayoutStore = sidebarLayoutStore.getState();

  function setSidebarOffset(offset: number): void {
    sidebarLayoutStore.setState({ offset });
  }

  function useSidebarOffset(): number {
    return sidebarLayoutStore.useStore((state) => state.offset);
  }
  let open: boolean | null = null;
  function storedOpen(): boolean | null {
    try {
      const value = storage?.getItem("nac.sidebar.open");
      if (value === "0") return false;
      if (value === "1") return true;
    } catch {
      /* Preferences are optional. */
    }
    return open;
  }
  function storeOpen(value: boolean) {
    open = value;
    try {
      storage?.setItem("nac.sidebar.open", value ? "1" : "0");
    } catch {
      /* Optional. */
    }
  }
  return {
    release: () => {
      sidebarLayoutStore.setState(initial_sidebarLayoutStore);
      open = null;
    },
    storedOpen,
    storeOpen,
    setSidebarOffset,
    useSidebarOffset,
  };
}

export const { release, storedOpen, storeOpen, setSidebarOffset, useSidebarOffset } =
  createSidebarLayoutStore(standalonePreferenceStorage);
