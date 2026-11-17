import { useProductNavigationOwner } from "@/app/features/product-context/context";
import { useLocation, useNavigate } from "react-router-dom";

import { projectIdFromPath, routes, sessionIdFromPath } from "@/app/lib/routes";
import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useMcpServers, useProjects, useSessions, useSshConfigs } from "@/app/services/queries";

/**
 * The desktop command contract (and the sidebar's "New session"): settings
 * destinations plus a new session in the project on screen, or Home's
 * composer when no project is on screen. With no projects at all, Home has
 * no composer, so the gesture starts New Project instead.
 */
export function useSidebarCommands() {
  const navigation = useProductNavigationOwner();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const actions = useProjectActions();
  const managed = useManagedHost();
  // Route identity survives presentation filtering; navigation lists still
  // use useVisibleSessions. This command always opens the central chat flow.
  const { data: sessions = [] } = useSessions();
  const projects = useProjects().data?.projects;
  const { data: mcpServers } = useMcpServers();
  const { data: sshConfigs } = useSshConfigs();

  const sessionId = sessionIdFromPath(pathname);
  const sessionKnown =
    sessionId != null && sessions.some((entry) => entry.summary.session_id === sessionId);
  const projectId =
    projectIdFromPath(pathname) ??
    sessions.find((entry) => entry.summary.session_id === sessionId)?.summary.project_id ??
    null;
  const activeMcp = mcpServers?.servers.filter((server) => server.enabled).length ?? 0;
  const sshCount = sshConfigs?.configurations.length ?? 0;

  const newSession = () => {
    if (projectId) {
      void actions.newChat(projectId);
      return true;
    }
    // A session route's project id arrives with the list. Choosing a
    // destination before that lands sends the gesture to the wrong place.
    if (sessionId && !sessionKnown) return false;
    // Until the project list lands, Home's empty state cannot be ruled out.
    if (projects === undefined) return false;
    if (projects.length === 0) {
      newProject();
      return true;
    }
    // Home's composer is the one new-session flow; it picks the project.
    navigate(routes.newSession(), { state: { focusComposer: Date.now() } });
    return true;
  };

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
