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
import { SessionFilters } from "@/app/components/sessions/SessionFilters";
import { useProjects, useSessions, useStoreInfo } from "@/app/services/queries";
import { setQuery as setProjectQuery, useFilterQuery } from "@/app/store/sessionFiltersStore";

import { NewSessionPopover } from "./NewSessionPopover";
import { SidebarProjectList } from "./SidebarProjectList";
import type { SidebarCommands } from "./useSidebarCommands.tsx";

/** Expanded navigation: projects, sessions, and the header's old destinations. */
export function LeftSidebarPanel({
  isOpen,
  onToggle,
  toggleKeys,
  commands,
  variant,
}: {
  isOpen: boolean;
  onToggle: () => void;
  toggleKeys: string[];
  commands: SidebarCommands;
  /** All Projects searches and filters the card grid instead of listing sessions. */
  variant: "session" | "projects";
}) {
  const projectsPage = variant === "projects";
  const [query, setQuery] = useState("");
  const projectQuery = useFilterQuery();
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
            <Icon iconName={IconName.SidebarChevronLeft} />
          </Button>
        </Tooltip>
      </div>

      <div className="flex flex-col gap-3 px-2 py-3 border-b border-muted shrink-0">
        <div className="px-1">
          <Input
            inputSize={InputSize.Medium}
            leading={InputLeading.Icon}
            leadingIconName={IconName.Search}
            placeholder={projectsPage ? "Search Projects" : "Search Sessions"}
            value={projectsPage ? projectQuery : query}
            aria-label={projectsPage ? "Search projects" : "Search sessions"}
            onChange={(event) =>
              projectsPage ? setProjectQuery(event.target.value) : setQuery(event.target.value)
            }
          />
        </div>
        <div className="flex flex-col gap-0.5">
          {projectsPage ? (
            <TabButton onClick={commands.newProject}>
              <Icon iconName={IconName.Add} />
              <span className="text-left flex-grow">{commands.createLabel}</span>
            </TabButton>
          ) : (
            <>
              <NewSessionPopover
                projectId={commands.projectId}
                onUnavailable={commands.newSession}
                className="w-full"
              >
                {(openMenu) => (
                  <TabButton onClick={openMenu}>
                    <Icon iconName={IconName.Add} />
                    <span className="text-left flex-grow">New Session</span>
                    <Icon iconName={IconName.Right} />
                  </TabButton>
                )}
              </NewSessionPopover>
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
            </>
          )}
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

      {projectsPage ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 [&>*]:shrink-0">
          <SessionFilters sessions={sessions} showSearch={false} sidebar />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SidebarProjectList
            projects={projects}
            sessions={sessions}
            query={query}
            activeSessionId={commands.sessionId}
            activeProjectId={commands.projectId}
          />
        </div>
      )}

      <div className="shrink-0 border-t border-muted">
        <div className="px-2 py-1">
          <TabButton onClick={commands.openConfigurations}>
            <Icon iconName={IconName.Gear} />
            <span className="text-left flex-grow">Configurations</span>
          </TabButton>
          {commands.openManaged ? (
            <TabButton onClick={commands.openManaged}>
              <Icon iconName={IconName.Server} />
              <span className="text-left flex-grow">Managed host</span>
            </TabButton>
          ) : null}
        </div>
        <Separator />
        <div className="flex items-center gap-2 h-10 pl-4 pr-2">
          <span className="label-micro text-basic-primary shrink-0">Store:</span>
          <span
            className="code code-micro text-basic-tertiary flex-1 min-w-0 truncate"
            title={storePath}
          >
            {storePath || "store path pending"}
          </span>
          <CopyButton
            value={storePath}
            size={ButtonSize.Small}
            variant={ButtonVariant.Tertiary}
            title="Copy the store path"
            disabled={!storePath}
            position={TooltipPosition.TopLeft}
            className="scale-90"
          />
        </div>
      </div>
    </div>
  );
}
