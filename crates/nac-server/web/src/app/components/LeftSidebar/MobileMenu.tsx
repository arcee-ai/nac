import { useState } from "react";
import { useLocation } from "react-router-dom";

import {
  Badge,
  BadgeColor,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Modal,
  Separator,
  TabButton,
  TabButtonSize,
} from "@/app/atoms";
import { SessionFilters } from "@/app/components/sessions/SessionFilters";
import { useManagedHost } from "@/app/features/managed/controller/useManagedHost";
import { routes } from "@/app/lib/routes";
import { useProjects, useVisibleSessions } from "@/app/services/queries";

import { MobileSearchModal } from "./MobileSearchModal";
import { NewSessionPopover } from "./NewSessionPopover";
import { SidebarProjectList } from "./SidebarProjectList";
import { useSidebarCommands } from "./useSidebarCommands.tsx";

/**
 * The phone's navigation, in place of the desktop sidebar: its destinations
 * over the project tree, or over the card filters on All Projects.
 */
export function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation();
  const commands = useSidebarCommands();
  const managed = useManagedHost();
  const [searching, setSearching] = useState(false);
  const { data: sessions = [] } = useVisibleSessions();
  const { data: projectList } = useProjects();
  const projectsPage = pathname === routes.list();

  const closeAnd = (run: () => void) => () => {
    onClose();
    run();
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Menu"
        bodyClassName="p-0 pb-[184px] [&>*]:shrink-0"
      >
        <nav aria-label="Menu" className="flex flex-col gap-1 border-b border-muted px-2 py-3">
          <NewSessionPopover
            projectId={commands.projectId}
            onUnavailable={closeAnd(commands.newSession)}
            className="w-full"
          >
            {(openMenu) => (
              <TabButton size={TabButtonSize.Large} onClick={openMenu}>
                <Icon iconName={IconName.Add} />
                <span className="flex-grow text-left">New Session</span>
                <Icon iconName={IconName.Right} />
              </TabButton>
            )}
          </NewSessionPopover>
          <TabButton size={TabButtonSize.Large} onClick={() => setSearching(true)}>
            <Icon iconName={IconName.Search} />
            <span className="flex-grow text-left">
              {projectsPage ? "Search Projects" : "Search Chats"}
            </span>
            <Icon iconName={IconName.Right} />
          </TabButton>
          <div className="flex items-center gap-2">
            <TabButton
              size={TabButtonSize.Large}
              className="!w-auto flex-1"
              onClick={closeAnd(commands.openProjects)}
            >
              <Icon iconName={IconName.Folders} />
              <span className="flex-grow truncate text-left">All projects</span>
            </TabButton>
            <Button
              variant={ButtonVariant.Ghost}
              size={ButtonSize.Large}
              content={ButtonContent.Icon}
              aria-label={managed.isManaged ? "Add repository" : "New project"}
              onClick={closeAnd(commands.newProject)}
            >
              <Icon iconName={IconName.Add} />
            </Button>
          </div>
          <TabButton
            size={TabButtonSize.Large}
            aria-label={commands.mcpLabel}
            onClick={closeAnd(commands.openMcp)}
          >
            <Icon iconName={IconName.Toolbox} />
            <span className="flex-grow text-left">MCP</span>
            {commands.activeMcp > 0 ? (
              <Badge
                text={`${commands.activeMcp} ACTIVE`}
                color={BadgeColor.Blue}
                background={false}
              />
            ) : null}
          </TabButton>
          <TabButton size={TabButtonSize.Large} onClick={closeAnd(commands.openSsh)}>
            <Icon iconName={IconName.Globe} />
            <span className="flex-grow text-left">SSH</span>
            {commands.sshCount > 0 ? (
              <Badge text={String(commands.sshCount)} color={BadgeColor.Gray} background={false} />
            ) : null}
          </TabButton>
          <Separator />
          <TabButton size={TabButtonSize.Large} onClick={closeAnd(commands.openConfigurations)}>
            <Icon iconName={IconName.Gear} />
            <span className="flex-grow text-left">Configurations</span>
            <Icon iconName={IconName.Right} />
          </TabButton>
          <TabButton size={TabButtonSize.Large} onClick={closeAnd(commands.openManaged)}>
            <Icon iconName={IconName.Controls} />
            <span className="flex-grow text-left">Manage Host</span>
            <Icon iconName={IconName.Right} />
          </TabButton>
        </nav>
        {projectsPage ? (
          <div className="px-2 py-4">
            <SessionFilters sessions={sessions} inset />
          </div>
        ) : (
          <SidebarProjectList
            projects={projectList?.projects ?? []}
            sessions={sessions}
            query=""
            activeSessionId={commands.sessionId}
            activeProjectId={commands.projectId}
            mobile
          />
        )}
      </Modal>
      <MobileSearchModal
        open={searching}
        onClose={() => setSearching(false)}
        kind={projectsPage ? "projects" : "chats"}
        activeSessionId={commands.sessionId}
        activeProjectId={commands.projectId}
      />
      {commands.modals}
    </>
  );
}
