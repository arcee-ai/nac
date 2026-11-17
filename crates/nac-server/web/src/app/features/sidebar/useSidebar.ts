import { useCallback } from "react";

import { useMediaQuery } from "@/app/hooks/useMediaQuery";
import { TOGGLE_SIDEBAR_KEYS } from "@/app/lib/shortcuts";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";

/** ⌘B (Ctrl+B elsewhere) shows and hides the sidebar. */
export const SIDEBAR_TOGGLE_KEYS = TOGGLE_SIDEBAR_KEYS;
export const SIDEBAR_WIDTH = 256;

/**
 * - `wide`: ≥1024px. Open by default; the choice persists.
 * - `narrow`: 768–1023px. Closed by default, never persisted, and closes again
 *   when the page changes.
 * - `none`: phones. No persistent sidebar; Home is the list.
 *
 * Both sidebar modes render the same in-flow 256px column.
 */
export type SidebarMode = "wide" | "narrow" | "none";

export function useSidebarMode(): SidebarMode {
  const wide = useMediaQuery("(min-width: 1024px)");
  const phone = useMediaQuery("(max-width: 767.98px)");
  return phone ? "none" : wide ? "wide" : "narrow";
}

/**
 * The sidebar's open state for the current width, plus its toggles. This is
 * the contract for any header that needs a "Show sidebar" control; see also
 * `<SidebarToggle />`.
 */
export function useSidebar() {
  const store = useNativeRuntime().stores.sidebarLayoutStore;
  const mode = useSidebarMode();
  const columnOpen = store.useColumnOpen();
  const narrowOpen = store.useOverlayOpen();
  const open = mode === "wide" ? (columnOpen ?? true) : mode === "narrow" ? narrowOpen : false;
  const { setColumnOpen, setOverlayOpen } = store;
  const setOpen = useCallback(
    (next: boolean) => {
      if (mode === "wide") setColumnOpen(next);
      else if (mode === "narrow") setOverlayOpen(next);
    },
    [mode, setColumnOpen, setOverlayOpen],
  );
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  return { mode, open, setOpen, toggle };
}

/** Also exported here for callers that already import it from this module. */
export { SidebarToggle } from "./SidebarToggle";
