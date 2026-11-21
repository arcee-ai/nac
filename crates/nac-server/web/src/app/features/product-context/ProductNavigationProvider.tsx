import { useLayoutEffect, useMemo, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { routes, sessionIdFromPath, type SessionPanel } from "@/app/lib/routes";
import { sessionPanelPolicy } from "@/app/lib/sessionBehavior";
import { useSessionSnapshot, useSessionSummary } from "@/app/services/queries";
import {
  capabilitiesHref,
  productSessionFromLocation,
} from "@/app/features/settings/settingsRoute";
import { ProductNavigationContext, type ProductNavigationOwner } from "./context";

/**
 * One owner for settings destinations and the bounded native navigation
 * adapter. Settings destinations are pages (`/settings/:section`); session
 * panels stay inside the session already on screen.
 */
export function ProductNavigationProvider({ children }: { children: ReactNode }) {
  const runtime = useNativeRuntime();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  // Settings › Capabilities keeps describing the session it was opened from.
  const sessionId = productSessionFromLocation(pathname, search, sessionIdFromPath(pathname));
  const { data: entry } = useSessionSummary(sessionId);
  // Passive cache consumption: context/navigation cannot attach or recover a session.
  const { data: snapshot } = useSessionSnapshot(sessionId, { enabled: false });
  const mobile = useIsMobile();
  // Bind the adapter to meaningful visibility/panel changes. Passive snapshot
  // refreshes must not replace an otherwise current navigation consumer.
  const sessionVisible = !!sessionId && !!snapshot && !!entry;
  const panelPolicy = sessionPanelPolicy(entry?.summary.behavior, snapshot?.lineage?.kind);
  const owner = useMemo<ProductNavigationOwner>(
    () => ({
      openMcp: () => navigate(routes.settings("mcp")),
      openSsh: () => navigate(routes.settings("ssh")),
      inspect: () => navigate(capabilitiesHref(sessionId)),
      openSettings: (section = "general") => navigate(routes.settings(section)),
    }),
    [navigate, sessionId],
  );

  // These query parameters select product objects or an exact decision, so
  // changing one retires the source view. Unrelated query decoration does not.
  const parameters = new URLSearchParams(search);
  const notificationSelection = JSON.stringify([
    pathname === "/" ? parameters.get("project") : null,
    ...[
      "permission_request",
      "question_request",
      "review_request",
      "heartbeat",
      "occurrence",
      "schedule",
    ].map((name) => parameters.get(name)),
  ]);
  useLayoutEffect(
    () =>
      runtime.productNavigation?.connectNotification({
        currentSession: () => sessionId,
        openNotificationSessionTarget: (targetSession) => navigate(routes.session(targetSession)),
      }),
    [runtime, sessionId, navigate, pathname, notificationSelection],
  );

  useLayoutEffect(
    () =>
      runtime.productNavigation?.connect({
        currentSession: () => sessionId,
        open: (resolution) => {
          const target = resolution.target.destination;
          switch (target) {
            case "mcp-settings":
              owner.openMcp();
              return true;
            case "configurations":
            case "model-authentication":
              owner.openSettings("accounts");
              return true;
            case "ssh-configurations":
              owner.openSsh();
              return true;
            case "projects":
              navigate(routes.list());
              return true;
          }
          if (!sessionVisible || !sessionId || resolution.session_id !== sessionId) return false;
          const panels: Partial<Record<typeof target, SessionPanel>> = {
            "session-subagents": "delegated",
            "session-files": "files",
            "session-terminal": "terminal",
            "session-history": "history",
          };
          const panel = panels[target];
          if (
            !panel ||
            !(mobile ? panelPolicy.mobilePanels : panelPolicy.widePanels).includes(panel)
          )
            return false;
          // Route remains in (or returns to) the session it describes. Opening
          // its presentation does not attach another session or launch a terminal.
          runtime.stores.sessionLayoutStore.openSidePanelList();
          navigate(routes.session(sessionId, panel));
          return true;
        },
      }),
    [runtime, sessionId, sessionVisible, panelPolicy, mobile, owner, navigate, pathname],
  );

  return (
    <ProductNavigationContext.Provider value={owner}>{children}</ProductNavigationContext.Provider>
  );
}
