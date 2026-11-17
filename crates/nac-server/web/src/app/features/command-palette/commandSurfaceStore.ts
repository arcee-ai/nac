import { createStore } from "@/app/lib/store";

export type CommandSurface = "palette" | "shortcuts" | null;

/** Commands and sidebar ownership never cross a presentation lifetime. */
export function createCommandSurfaceStore() {
  const state = createStore<{ surface: CommandSurface; sidebarAvailable: boolean }>(
    { surface: null, sidebarAvailable: false },
    "command-surfaces",
  );
  const sidebarHandlers = new Set<() => void>();
  let closed = false;
  const emit = (surface: CommandSurface) => {
    if (!closed) state.setState({ surface });
  };
  return {
    openCommandPalette: () => emit("palette"),
    openShortcutSheet: () => emit("shortcuts"),
    closeCommandSurfaces: () => emit(null),
    useCommandSurface: () => state.useStore((value) => value.surface),
    useSidebarToggleAvailable: () => state.useStore((value) => value.sidebarAvailable),
    registerSidebarToggle(handler: () => void) {
      if (closed) return () => {};
      sidebarHandlers.add(handler);
      state.setState({ sidebarAvailable: true });
      return () => {
        sidebarHandlers.delete(handler);
        state.setState({ sidebarAvailable: sidebarHandlers.size > 0 });
      };
    },
    requestSidebarToggle() {
      const handler = [...sidebarHandlers].at(-1);
      if (closed || !handler) return false;
      handler();
      return true;
    },
    release() {
      closed = true;
      sidebarHandlers.clear();
      state.setState({ surface: null, sidebarAvailable: false });
    },
  };
}

export const standaloneCommandSurfaceStore = createCommandSurfaceStore();
