import { useProductNavigationOwner } from "@/app/features/product-context/context";
import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { projectIdFromPath, routes, sessionIdFromPath } from "@/app/lib/routes";
import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useMcpServers, useSessions, useSshConfigs } from "@/app/services/queries";

/**
 * The one New session action that the sidebar, the shortcut, the palette and
 * the native menu share: Home's composer for the project on screen, focused.
 * It never creates a session or a project. Returns false while the screen's
 * project cannot be known yet.
 */
export function useNewSession() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const actions = useProjectActions();
  // Route identity survives presentation filtering; navigation lists still
  // use useVisibleSessions. This command always opens the central chat flow.
  const { data: sessions = [] } = useSessions();

  const sessionId = sessionIdFromPath(pathname);
  const sessionKnown =
    sessionId != null && sessions.some((entry) => entry.summary.session_id === sessionId);
  const projectId =
    projectIdFromPath(pathname) ??
    sessions.find((entry) => entry.summary.session_id === sessionId)?.summary.project_id ??
    null;

  const { newChat } = actions;
  const newSession = useCallback(() => {
    // A session route's project id arrives with the list. Choosing a
    // destination before that lands sends the gesture to the wrong place.
    if (sessionId && !sessionKnown) return false;
    if (projectId) {
      void newChat(projectId);
      return true;
    }
    const focusComposer = { state: { focusComposer: Date.now() } };
    // Already Home: keep its project and draft, and bring the composer back.
    if (pathname === routes.list()) {
      navigate({ pathname, search }, { ...focusComposer, replace: true });
    } else {
      navigate(routes.newSession(), focusComposer);
    }
    return true;
  }, [sessionId, sessionKnown, projectId, newChat, pathname, search, navigate]);

  return { projectId, sessionId, newSession };
}

/** The desktop command contract and the sidebar's destinations. */
export function useSidebarCommands() {
  const navigation = useProductNavigationOwner();
  const navigate = useNavigate();
  const actions = useProjectActions();
  const managed = useManagedHost();
  const { projectId, sessionId, newSession } = useNewSession();
  const { data: mcpServers } = useMcpServers();
  const { data: sshConfigs } = useSshConfigs();

  const activeMcp = mcpServers?.servers.filter((server) => server.enabled).length ?? 0;
  const sshCount = sshConfigs?.configurations.length ?? 0;

  function newProject() {
    if (managed.isManaged) managed.addRepository();
    else actions.create();
  }

  return {
    projectId,
    sessionId,
    activeMcp,
    sshCount,
    mcpLabel: activeMcp ? `MCP servers, ${activeMcp} active` : "MCP servers",
    newSession,
    newProject,
    createLabel: managed.isManaged ? "Add repository" : "New Project",
    openProjects: () => navigate(routes.list()),
    openMcp: navigation.openMcp,
    openSsh: navigation.openSsh,
    openConfigurations: navigation.openConfigurations,
    inspectProduct: navigation.inspect,
    openManaged: managed.openSettings,
  };
}

export type SidebarCommands = ReturnType<typeof useSidebarCommands>;
