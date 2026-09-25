import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ConfigurationsModal } from "@/app/components/modals/ConfigurationsModal";
import { McpServersModal } from "@/app/components/modals/MCPServersModal/McpServersModal";
import { SshConfigsModal } from "@/app/components/modals/SshConfigsModal";
import { projectIdFromPath, routes, sessionIdFromPath } from "@/app/lib/routes";
import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useMcpServers, useSessions, useSshConfigs } from "@/app/services/queries";

/**
 * The sidebar's destinations: the same dialogs the header already opens, plus
 * a new session in the project on screen (or a new project when none is).
 */
export function useSidebarCommands() {
  const [configuring, setConfiguring] = useState(false);
  const [ssh, setSsh] = useState(false);
  const [mcp, setMcp] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const actions = useProjectActions();
  const managed = useManagedHost();
  const { data: sessions = [] } = useSessions();
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
      return;
    }
    // A session route's project id arrives with the list. Opening New Project
    // before that lands sends the click to the wrong dialog.
    if (sessionId && !sessionKnown) return;
    actions.create();
  };

  const newProject = () => {
    if (managed.isManaged) managed.addRepository();
    else actions.create();
  };

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
    openMcp: () => setMcp(true),
    openSsh: () => setSsh(true),
    openConfigurations: () => setConfiguring(true),
    openManaged: managed.isManaged ? managed.openSettings : null,
    modals: (
      <>
        <ConfigurationsModal open={configuring} onClose={() => setConfiguring(false)} />
        <SshConfigsModal open={ssh} onClose={() => setSsh(false)} />
        <McpServersModal open={mcp} onClose={() => setMcp(false)} />
      </>
    ),
  };
}

export type SidebarCommands = ReturnType<typeof useSidebarCommands>;
