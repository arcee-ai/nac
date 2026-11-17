/** ⌘B (Ctrl+B elsewhere) shows and hides the sidebar. */
export declare const SIDEBAR_TOGGLE_KEYS: string[];
export declare const SIDEBAR_WIDTH = 256;
/**
 * - `wide`: ≥1024px. Open by default; the choice persists.
 * - `narrow`: 768–1023px. Closed by default, never persisted, and closes again
 *   when the page changes.
 * - `none`: phones. No persistent sidebar; Home is the list.
 *
 * Both sidebar modes render the same in-flow 256px column.
 */
export type SidebarMode = "wide" | "narrow" | "none";
export declare function useSidebarMode(): SidebarMode;
/**
 * The sidebar's open state for the current width, plus its toggles. This is
 * the contract for any header that needs a "Show sidebar" control; see also
 * `<SidebarToggle />`.
 */
export declare function useSidebar(): {
    mode: SidebarMode;
    open: boolean;
    setOpen: (next: boolean) => void;
    toggle: () => void;
};
/** Also exported here for callers that already import it from this module. */
export { SidebarToggle } from "./SidebarToggle";
