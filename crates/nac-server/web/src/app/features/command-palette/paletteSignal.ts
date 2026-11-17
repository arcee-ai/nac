import { useEffect, useRef } from "react";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { standaloneCommandSurfaceStore } from "./commandSurfaceStore";

/** Compatibility controls for standalone fixtures. Production resolves its runtime. */
export const { openCommandPalette, openShortcutSheet, closeCommandSurfaces } =
  standaloneCommandSurfaceStore;

export function useCommandSurfaceControls() {
  return useNativeRuntime().stores.commandSurfaceStore;
}

export function useSidebarToggleRequests(handler: (() => void) | null): void {
  const { registerSidebarToggle } = useCommandSurfaceControls();
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const enabled = handler !== null;
  useEffect(() => {
    if (!enabled) return undefined;
    return registerSidebarToggle(() => latest.current?.());
  }, [enabled, registerSidebarToggle]);
}
