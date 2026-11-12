import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  CopyButton,
  Icon,
  IconName,
  KeyboardShortcut,
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

/** Expanded navigation: the three primary rows, the project tree, and the settings footer. */
export function LeftSidebarPanel({
  isOpen,
  onToggle,
  onSearch,
  toggleKeys,
  searchKeys,
  commands,
  variant,
}: {
  isOpen: boolean;
  onToggle: () => void;
  onSearch: () => void;
  toggleKeys: string[];
  searchKeys: string[];
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
    <div className="flex h-full flex-col bg-elevation-level-0-5 border-r border-tertiary">
      <div className="flex h-14 items-center justify-end px-2 shrink-0">
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

      <div className="flex flex-col gap-1 px-2 pb-2 shrink-0">
        {projectsPage ? (
          <TabButton className="border border-tertiary" onClick={commands.newProject}>
            <Icon iconName={IconName.Add} />
            <span className="text-left flex-grow truncate">{commands.createLabel}</span>
          </TabButton>
        ) : (
          <NewSessionPopover projectId={commands.projectId} onUnavailable={commands.newSession}>
            {(openMenu) => (
              <TabButton className="border border-tertiary" onClick={openMenu}>
                <Icon iconName={IconName.Add} />
                <span className="text-left flex-grow truncate">New Session</span>
              </TabButton>
            )}
          </NewSessionPopover>
        )}
        <TabButton
          aria-label={searchLabel}
          onClick={onSearch}
          trailing={<KeyboardShortcut keys={searchKeys} />}
        >
          <Icon iconName={IconName.Search} />
          <span className="text-left flex-grow">Search</span>
        </TabButton>
        <TabButton active={projectsPage} onClick={commands.openProjects}>
          <Icon iconName={IconName.Grid} />
          <span className="text-left flex-grow truncate">All projects</span>
        </TabButton>
      </div>

      {projectsPage ? (
        <div className="flex-1 min-h-0 overflow-y-auto py-2 [&>*]:shrink-0">
          <SessionFilters sessions={sessions} />
        </div>
      ) : (
        <nav className="flex-1 min-h-0 overflow-y-auto" aria-label="Projects">
          <div className="flex items-center pt-3 pr-2.5 pb-1 pl-[18px]">
            <h2 className="flex-1 text-[11px] font-medium tracking-wide uppercase text-basic-tertiary">
              Projects
            </h2>
            <Tooltip title="Create a new project" position={TooltipPosition.CenterRight} sticky>
              <Button
                variant={ButtonVariant.Ghost}
                size={ButtonSize.Small}
                content={ButtonContent.Icon}
                aria-label="New project"
                onClick={commands.newProject}
              >
                <Icon iconName={IconName.Add} />
              </Button>
            </Tooltip>
          </div>
          <SidebarProjectList
            projects={projects}
            sessions={sessions}
            query=""
            activeSessionId={commands.sessionId}
            activeProjectId={commands.projectId}
          />
        </nav>
      )}

      <div className="flex items-center gap-2 px-[18px] pt-2 shrink-0">
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
      <div className="flex items-center gap-0.5 py-2 pr-2.5 pl-[18px] shrink-0">
        <Logo height={14} className="mr-auto text-basic-primary" />
        <FooterButton
          label={commands.mcpLabel}
          icon={IconName.Toolbox}
          onClick={commands.openMcp}
        />
        <FooterButton label="SSH" icon={IconName.Globe} onClick={commands.openSsh} />
        <FooterButton
          label="Managed host"
          icon={IconName.Controls}
          onClick={commands.openManaged}
        />
        <FooterButton
          label="NAC capabilities"
          icon={IconName.Info}
          onClick={commands.inspectProduct}
        />
        <FooterButton
          label="Configurations"
          icon={IconName.Gear}
          onClick={commands.openConfigurations}
        />
      </div>
    </div>
  );
}

function FooterButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
}) {
  return (
    <Tooltip title={label} position={TooltipPosition.TopCenter} sticky>
      <Button
        variant={ButtonVariant.Ghost}
        size={ButtonSize.Small}
        content={ButtonContent.Icon}
        aria-label={label}
        onClick={onClick}
      >
        <Icon iconName={icon} />
      </Button>
    </Tooltip>
  );
}
