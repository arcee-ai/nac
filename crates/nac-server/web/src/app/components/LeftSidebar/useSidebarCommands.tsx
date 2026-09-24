import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ConfigurationsModal } from "@/app/components/modals/ConfigurationsModal";
import { McpServersModal } from "@/app/components/modals/MCPServersModal/McpServersModal";
import { SshConfigsModal } from "@/app/components/modals/SshConfigsModal";
import { projectIdFromPath, routes, sessionIdFromPath } from "@/app/lib/routes";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useMcpServers, useSessions, useSshConfigs } from "@/app/services/queries";

/**
 * The sidebar's destinations: the same dialogs the header already opens, plus
 * a new chat in the project on screen (or a new project when none is).
 */
export function useSidebarCommands() {
  const [configuring, setConfiguring] = useState(false);
  const [ssh, setSsh] = useState(false);
  const [mcp, setMcp] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const actions = useProjectActions();
  const { data: sessions = [] } = useSessions();
  const { data: mcpServers } = useMcpServers();
  const { data: sshConfigs } = useSshConfigs();

  const sessionId = sessionIdFromPath(pathname);
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
    actions.create();
  };

  return {
    projectId,
    sessionId,
    activeMcp,
    sshCount,
    mcpLabel: activeMcp ? `MCP servers, ${activeMcp} active` : "MCP servers",
    newSession,
    newProject: () => actions.create(),
    openProjects: () => navigate(routes.list()),
    openMcp: () => setMcp(true),
    openSsh: () => setSsh(true),
    openConfigurations: () => setConfiguring(true),
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
