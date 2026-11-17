import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { routes, type SessionPanel } from "@/app/lib/routes";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import type { DrawerContent } from "@/app/store/sessionLayoutStore";

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
export function useSessionDrawer(sessionId: string, panel: SessionPanel): SessionDrawerControls {
  const {
    useSidePanelCollapsed,
    useSidePanelExpanded,
    useDrawerPinned,
    useDrawerContent,
    openDrawer,
    closeDrawer,
    toggleDrawerPinned,
    toggleSidePanelExpanded,
    showSidePanelList,
  } = useNativeRuntime().stores.sessionLayoutStore;
  const navigate = useNavigate();
  const open = !useSidePanelCollapsed();
  const expanded = useSidePanelExpanded();
  const pinned = useDrawerPinned();
  const content = useDrawerContent();

  const showing = useCallback(
    (target: SessionPanel | "goal") =>
      open && (target === "goal" ? content === "goal" : content === "panel" && panel === target),
    [content, open, panel],
  );

  const openPanel = useCallback(
    (next: SessionPanel) => {
      // A panel opened from the chrome starts on its list of rows on a phone.
      showSidePanelList(true);
      openDrawer("panel");
      if (next !== panel) navigate(routes.session(sessionId, next));
    },
    [navigate, openDrawer, panel, sessionId, showSidePanelList],
  );

  const show = useCallback(
    (target: SessionPanel | "goal") => {
      if (target === "goal") openDrawer("goal");
      else openPanel(target);
    },
    [openDrawer, openPanel],
  );

  const toggle = useCallback(
    (target: SessionPanel | "goal") => {
      if (showing(target)) closeDrawer();
      else show(target);
    },
    [closeDrawer, show, showing],
  );

  return {
    open,
    pinned,
    expanded,
    content,
    panel,
    showing,
    toggle,
    openPanel,
    show,
    close: closeDrawer,
    togglePinned: toggleDrawerPinned,
    toggleExpanded: toggleSidePanelExpanded,
  };
}
