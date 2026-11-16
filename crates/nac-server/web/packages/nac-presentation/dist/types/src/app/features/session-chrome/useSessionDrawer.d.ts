import { type SessionPanel } from "../../lib/routes";
import type { DrawerContent } from "../../store/sessionLayoutStore";
export interface SessionDrawerControls {
    open: boolean;
    pinned: boolean;
    expanded: boolean;
    content: DrawerContent;
    /** The panel the route has open (what a "panel" drawer shows). */
    panel: SessionPanel;
    /** Whether the drawer is open on exactly this panel (or on the goal). */
    showing: (target: SessionPanel | "goal") => boolean;
    /** A pill press: open on the target, or close when it is already showing. */
    toggle: (target: SessionPanel | "goal") => void;
    /** Open on a panel without toggling (a list row, the ⋯ menu). */
    openPanel: (panel: SessionPanel) => void;
    close: () => void;
    togglePinned: () => void;
    toggleExpanded: () => void;
}
/**
 * The one way the session chrome opens its drawer. The route's `:panel`
 * picks what a panel drawer shows and the layout store says whether it is
 * open, docked or full width, so a link, a pill, the transcript and a
 * desktop command all land on the same state.
 */
export declare function useSessionDrawer(sessionId: string, panel: SessionPanel): SessionDrawerControls;
