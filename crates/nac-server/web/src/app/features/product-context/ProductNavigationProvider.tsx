import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ConfigurationsModal } from "@/app/components/modals/ConfigurationsModal";
import { McpServersModal } from "@/app/components/modals/MCPServersModal/McpServersModal";
import { SshConfigsModal } from "@/app/components/modals/SshConfigsModal";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { routes, sessionIdFromPath, type SessionPanel } from "@/app/lib/routes";
import { sessionPanelPolicy } from "@/app/lib/sessionBehavior";
import { useSessionSnapshot, useSessionSummary } from "@/app/services/queries";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { sessionAvailable } from "@/app/features/ui-policy/policy";
import { ProductNavigationContext } from "./context";
import { ProductContextModal } from "./ProductContextModal";

/** One presentation owner for existing dialogs and the bounded navigation adapter. */
export function ProductNavigationProvider({ children }: { children: ReactNode }) {
  const runtime = useNativeRuntime();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const sessionId = sessionIdFromPath(pathname);
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
  const [dialog, setDialog] = useState<"mcp" | "configurations" | "ssh" | "context" | null>(null);
  const owner = useMemo(
    () => ({
      openMcp: () => setDialog("mcp"),
      openConfigurations: () => setDialog("configurations"),
      openSsh: () => setDialog("ssh"),
      inspect: () => setDialog("context"),
    }),
    [],
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
              owner.openConfigurations();
              return true;
            case "ssh-configurations":
              owner.openSsh();
              return true;
            case "projects":
              setDialog(null);
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
          // Route remains in the already rendered session. Opening its presentation
          // does not attach another session or launch a terminal.
          setDialog(null);
          runtime.stores.sessionLayoutStore.openSidePanelList();
          navigate(routes.session(sessionId, panel));
          return true;
        },
      }),
    [runtime, sessionId, sessionVisible, panelPolicy, mobile, owner, navigate, pathname],
  );

  const close = () => setDialog(null);
  return (
    <ProductNavigationContext.Provider value={owner}>
      {children}
      <ConfigurationsModal open={dialog === "configurations"} onClose={close} />
      <McpServersModal open={dialog === "mcp"} onClose={close} />
      <SshConfigsModal open={dialog === "ssh"} onClose={close} />
      {dialog === "context" ? (
        <ProductContextModal open sessionId={sessionId} onClose={close} />
      ) : null}
    </ProductNavigationContext.Provider>
  );
}
