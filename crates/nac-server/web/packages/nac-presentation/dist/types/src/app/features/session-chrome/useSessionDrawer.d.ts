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
    /** Open on the target, or close when it is already showing. */
    toggle: (target: SessionPanel | "goal") => void;
    /** Open on a panel without toggling (a list row, a drawer tab). */
    openPanel: (panel: SessionPanel) => void;
    /** Open on a panel or the goal without toggling (the Session menu's rows). */
    show: (target: SessionPanel | "goal") => void;
    close: () => void;
    togglePinned: () => void;
    toggleExpanded: () => void;
}
/**
 * The one way the session chrome opens its drawer. The route's `:panel`
 * picks what a panel drawer shows and the layout store says whether it is
 * open, docked or full width, so a link, the Session menu, the transcript and a
 * desktop command all land on the same state.
 */
export declare function useSessionDrawer(sessionId: string, panel: SessionPanel): SessionDrawerControls;
