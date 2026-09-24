import { useState } from "react";

import {
  Badge,
  BadgeColor,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  CopyButton,
  Icon,
  IconName,
  Input,
  InputLeading,
  InputSize,
  Logo,
  Separator,
  TabButton,
  Tooltip,
} from "@/app/atoms";
import { TooltipPosition } from "@/app/atoms/tooltip";
import { useProjects, useSessions, useStoreInfo } from "@/app/services/queries";

import { SidebarProjectList } from "./SidebarProjectList";
import type { SidebarCommands } from "./useSidebarCommands.tsx";

/** Expanded navigation: projects, sessions, and the header's old destinations. */
export function LeftSidebarPanel({
  isOpen,
  onToggle,
  toggleKeys,
  commands,
}: {
  isOpen: boolean;
  onToggle: () => void;
  toggleKeys: string[];
  commands: SidebarCommands;
}) {
  const [query, setQuery] = useState("");
  const { data: sessions = [] } = useSessions();
  const { data: projectList } = useProjects();
  const { data: storeInfo } = useStoreInfo();
  const storePath = storeInfo?.store_path ?? "";
  const projects = projectList?.projects ?? [];

  return (
    <div
      className="flex h-full flex-col bg-elevation-level-2 border-r border-muted"
      style={{ boxShadow: "var(--left-sidebar-open)" }}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-muted shrink-0">
        <Logo height={28} className="text-basic-primary" />
        <Tooltip
          title="Hide sidebar"
          keyboardShortcuts={toggleKeys}
          position={TooltipPosition.CenterLeft}
          sticky
          disabled={!isOpen}
        >
          <Button
            variant={ButtonVariant.Ghost}
            content={ButtonContent.Icon}
            aria-label="Hide sidebar"
            onClick={onToggle}
          >
            <Icon iconName={IconName.CloseSidebar} />
          </Button>
        </Tooltip>
      </div>

      <div className="flex flex-col gap-3 px-2 py-3 border-b border-muted shrink-0">
        <div className="flex items-center gap-2">
          <TabButton className="flex-1 !w-auto" onClick={commands.openProjects}>
            <Icon iconName={IconName.ArrowLeft} />
            <span className="text-left flex-grow truncate">All projects</span>
          </TabButton>
          <Button
            variant={ButtonVariant.Ghost}
            content={ButtonContent.Icon}
            aria-label="New project"
            onClick={commands.newProject}
          >
            <Icon iconName={IconName.AddCircle} />
          </Button>
        </div>
        <div className="px-1">
          <Input
            inputSize={InputSize.Medium}
            leading={InputLeading.Icon}
            leadingIconName={IconName.Search}
            placeholder="Search Sessions"
            value={query}
            aria-label="Search sessions"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <TabButton onClick={commands.newSession}>
            <Icon iconName={IconName.Add} />
            <span className="text-left flex-grow">New Session</span>
            <Icon iconName={IconName.ArrowRight} />
          </TabButton>
          <TabButton onClick={commands.openMcp} aria-label={commands.mcpLabel}>
            <Icon iconName={IconName.Toolbox} />
            <span className="text-left flex-grow">MCP</span>
            {commands.activeMcp > 0 ? (
              <Badge text={`${commands.activeMcp} ACTIVE`} color={BadgeColor.Blue} />
            ) : null}
          </TabButton>
          <TabButton onClick={commands.openSsh}>
            <Icon iconName={IconName.Globe} />
            <span className="text-left flex-grow">SSH</span>
            {commands.sshCount > 0 ? (
              <span className="label-small text-basic-secondary tabular-nums">
                {commands.sshCount}
              </span>
            ) : null}
          </TabButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <SidebarProjectList
          projects={projects}
          sessions={sessions}
          query={query}
          activeSessionId={commands.sessionId}
          activeProjectId={commands.projectId}
        />
      </div>

      <div className="shrink-0 border-t border-muted">
        <div className="px-2 py-1">
          <TabButton onClick={commands.openConfigurations}>
            <Icon iconName={IconName.Gear} />
            <span className="text-left flex-grow">Configurations</span>
          </TabButton>
        </div>
        <Separator />
        <div className="flex items-center gap-2 h-8 pl-4 pr-2">
          <span className="label-small text-basic-primary shrink-0">Store:</span>
          <span
            className="code code-small text-info-primary flex-1 min-w-0 truncate"
            title={storePath}
          >
            {storePath || "store path pending"}
          </span>
          <CopyButton
            value={storePath}
            size={ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            title="Copy the store path"
            disabled={!storePath}
          />
        </div>
      </div>
    </div>
  );
}
