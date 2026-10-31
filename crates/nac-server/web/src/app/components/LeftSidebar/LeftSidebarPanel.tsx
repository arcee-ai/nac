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
  Logo,
  TabButton,
  Tooltip,
} from "@/app/atoms";
import { TooltipPosition } from "@/app/atoms/tooltip";
import { SessionFilters } from "@/app/components/sessions/SessionFilters";
import { useProjects, useVisibleSessions, useStoreInfo } from "@/app/services/queries";

import { NewSessionPopover } from "./NewSessionPopover";
import { SidebarProjectList } from "./SidebarProjectList";
import type { SidebarCommands } from "./useSidebarCommands.tsx";

/** Expanded navigation: projects, sessions, and the header's old destinations. */
export function LeftSidebarPanel({
  isOpen,
  onToggle,
  onSearch,
  toggleKeys,
  commands,
  variant,
}: {
  isOpen: boolean;
  onToggle: () => void;
  onSearch: () => void;
  toggleKeys: string[];
  commands: SidebarCommands;
  /** All Projects filters the card grid instead of listing sessions. */
  variant: "session" | "projects";
}) {
  const projectsPage = variant === "projects";
  const searchLabel = projectsPage ? "Search projects" : "Search chats";
  const { data: sessions = [] } = useVisibleSessions();
  const { data: projectList } = useProjects();
  const { data: storeInfo } = useStoreInfo();
  const storePath = storeInfo?.store_path ?? "";
  const projects = projectList?.projects ?? [];

  return (
    <div
      className="flex h-full flex-col bg-elevation-ground border-r border-tertiary"
      style={{ boxShadow: "var(--left-sidebar-open)" }}
    >
      <div className="flex items-center justify-between pl-4 pr-2 py-2 border-b border-muted shrink-0">
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
            <Icon iconName={IconName.LeftSidebar} />
          </Button>
        </Tooltip>
      </div>

      <div className="flex flex-col gap-0.5 p-2 border-b border-muted shrink-0">
        <div className="flex items-center gap-2">
          {projectsPage ? (
            <TabButton className="flex-1 !w-auto" onClick={commands.newProject}>
              <Icon iconName={IconName.Add} />
              <span className="text-left flex-grow truncate">{commands.createLabel}</span>
            </TabButton>
          ) : (
            <NewSessionPopover
              projectId={commands.projectId}
              onUnavailable={commands.newSession}
              className="flex-1 min-w-0"
            >
              {(openMenu) => (
                <TabButton onClick={openMenu}>
                  <Icon iconName={IconName.Add} />
                  <span className="text-left flex-grow truncate">New Session</span>
                </TabButton>
              )}
            </NewSessionPopover>
          )}
          <Tooltip title={searchLabel} position={TooltipPosition.CenterRight} sticky>
            <Button
              variant={ButtonVariant.Ghost}
              content={ButtonContent.Icon}
              aria-label={searchLabel}
              onClick={onSearch}
            >
              <Icon iconName={IconName.Search} />
            </Button>
          </Tooltip>
        </div>
        {projectsPage ? null : (
          <div className="flex items-center gap-2">
            <TabButton className="flex-1 !w-auto" onClick={commands.openProjects}>
              <Icon iconName={IconName.Folders} />
              <span className="text-left flex-grow truncate">All projects</span>
            </TabButton>
            <Tooltip title="Create a new project" position={TooltipPosition.CenterRight} sticky>
              <Button
                variant={ButtonVariant.Ghost}
                content={ButtonContent.Icon}
                aria-label="New project"
                onClick={commands.newProject}
              >
                <Icon iconName={IconName.AddCircle} />
              </Button>
            </Tooltip>
          </div>
        )}
        <TabButton onClick={commands.openMcp} aria-label={commands.mcpLabel}>
          <Icon iconName={IconName.Toolbox} />
          <span className="text-left flex-grow">MCP</span>
          {commands.activeMcp > 0 ? (
            <Badge
              text={`${commands.activeMcp} ACTIVE`}
              color={BadgeColor.Blue}
              background={false}
            />
          ) : null}
        </TabButton>
        <TabButton onClick={commands.openSsh}>
          <Icon iconName={IconName.Globe} />
          <span className="text-left flex-grow">SSH</span>
          {commands.sshCount > 0 ? (
            <Badge text={String(commands.sshCount)} color={BadgeColor.Gray} background={false} />
          ) : null}
        </TabButton>
        <TabButton onClick={commands.openConfigurations}>
          <Icon iconName={IconName.Gear} />
          <span className="text-left flex-grow">Configurations</span>
        </TabButton>
        <TabButton onClick={commands.openManaged}>
          <Icon iconName={IconName.Controls} />
          <span className="text-left flex-grow">Managed host</span>
        </TabButton>
      </div>

      {projectsPage ? (
        <div className="flex-1 min-h-0 overflow-y-auto py-2 [&>*]:shrink-0">
          <SessionFilters sessions={sessions} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SidebarProjectList
            projects={projects}
            sessions={sessions}
            query=""
            activeSessionId={commands.sessionId}
            activeProjectId={commands.projectId}
          />
        </div>
      )}

      <div className="flex items-center gap-2 px-4 py-2 border-t border-muted shrink-0">
        <span className="label-micro text-basic-muted shrink-0">Store:</span>
        <span
          className="code code-small font-medium text-basic-muted flex-1 min-w-0 truncate"
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
          position={TooltipPosition.TopLeft}
          className="opacity-50"
        />
      </div>
    </div>
  );
}
