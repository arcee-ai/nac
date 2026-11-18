import { useLayoutEffect, useMemo, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { routes, sessionIdFromPath, type SessionPanel } from "@/app/lib/routes";
import { sessionPanelPolicy } from "@/app/lib/sessionBehavior";
import { useSessionSnapshot, useSessionSummary } from "@/app/services/queries";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { sessionAvailable } from "@/app/features/ui-policy/policy";
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
  const uiPolicy = useUiPolicy();
  const mobile = useIsMobile();
  // Bind the adapter to meaningful visibility/panel changes. Passive snapshot
  // refreshes must not replace an otherwise current navigation consumer.
  const sessionVisible =
    !!sessionId &&
    !!snapshot &&
    !!entry &&
    sessionAvailable(uiPolicy, entry.summary.behavior, entry.lineage);
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

  useLayoutEffect(
    () =>
      runtime.productNavigation?.connect({
        currentSession: () => sessionId,
        openNotificationSessionTarget: (targetSession) => {
          // Explicit native response; SessionPage remains the ordinary shared
          // owner for canonical snapshot/interactive subscription/recovery.
          navigate(routes.session(targetSession));
        },
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
