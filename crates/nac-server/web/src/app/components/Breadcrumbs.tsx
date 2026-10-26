import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  ChatSessionOrphanAvatar,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
  PopoverSize,
  SessionAvatar,
  Tooltip,
} from "@/app/atoms";
import { ProjectPopover } from "@/app/components/projects/ProjectPopover";
import { cn } from "@/app/lib/cn";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { isActiveRun } from "@/app/lib/format";
import { findProject, primarySessions } from "@/app/lib/projects";
import { projectIdFromPath, routes, sessionIdFromPath } from "@/app/lib/routes";
import { NEW_PROJECT_KEYS } from "@/app/lib/shortcuts";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useProjects, useVisibleSessions } from "@/app/services/queries";

/**
 * The trail is project-first: `All Projects > [identicon] Project ⌄ ⊕`.
 *
 * Inside a chat the trail names the chat's project rather than the chat itself,
 * because the tab strip below already says which chat is open. A chat that
 * belongs to no project names itself instead, so the trail never goes blank.
 */
export function Breadcrumbs() {
  const { pathname } = useLocation();
  const sessionId = sessionIdFromPath(pathname);
  const routeProjectId = projectIdFromPath(pathname);
  const navigate = useNavigate();
  const actions = useProjectActions();
  const sessionTitle = useSessionTitle();
  const { data: projectList } = useProjects();
  const { data: sessions = [] } = useVisibleSessions();
  const [open, setOpen] = useState(false);

  const currentEntry = sessionId
    ? sessions.find((entry) => entry.summary.session_id === sessionId)
    : undefined;
  const projectId = routeProjectId ?? currentEntry?.summary.project_id ?? null;
  const project = findProject(projectList?.projects ?? [], projectId);
  const inTrail = Boolean(projectId || sessionId);
  // An orphan has a chat but no project, so the trail falls back to its title
  // and the neutral chat tile.
  const label = project?.name ?? sessionTitle(currentEntry?.summary) ?? sessionId ?? "";
  const avatarId = project?.project_id ?? sessionId ?? "";
  // The project chip pulses when any chat in that project is running, not
  // only the one whose tab is open. An unassigned chat can only pulse for itself.
  const running = projectId
    ? primarySessions(sessions).some(
        (entry) => entry.summary.project_id === projectId && isActiveRun(entry.active_run),
      )
    : isActiveRun(currentEntry?.active_run);

  return (
    <nav className="flex items-center min-w-0 gap-1" aria-label="Breadcrumb">
      <Button
        variant={ButtonVariant.Ghost}
        size={ButtonSize.Medium}
        content={ButtonContent.Text}
        onClick={() => navigate(routes.list())}
        aria-current={inTrail ? undefined : "page"}
      >
        All Projects
      </Button>

      {inTrail ? (
        <>
          <Icon iconName={IconName.Right} className="text-basic-muted shrink-0" />
          <Popover
            open={open}
            onClose={() => setOpen(false)}
            placement={PopoverPlacement.BottomRight}
            size={PopoverSize.Medium}
            className="min-w-0"
            content={
              <ProjectPopover activeId={projectId ?? sessionId} onClose={() => setOpen(false)} />
            }
          >
            <Button
              variant={ButtonVariant.Ghost}
              size={ButtonSize.Medium}
              content={ButtonContent.Text}
              // The atom's own padding is unlayered CSS, so a plain `px-2`
              // never reaches it.
              className="!px-2 max-w-[320px]"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label="Switch project"
            >
              {project ? (
                <SessionAvatar
                  id={avatarId}
                  size={24}
                  isRunning={running}
                  className="rounded-[2px]"
                />
              ) : (
                <ChatSessionOrphanAvatar size={24} isRunning={running} />
              )}
              <span className={cn("truncate max-w-[120px]", running && "text-shimmer-basic")}>
                {label}
              </span>
              <Icon
                iconName={IconName.Down}
                className={cn("transition-transform", open ? "rotate-180" : undefined)}
              />
            </Button>
          </Popover>
          <Tooltip
            title="New project"
            // Inside a project the chord starts a chat instead, so promising
            // it here would be a lie.
            keyboardShortcuts={project ? undefined : NEW_PROJECT_KEYS}
            position={Tooltip.Position.BottomCenter}
          >
            <Button
              variant={ButtonVariant.Ghost}
              size={ButtonSize.Small}
              content={ButtonContent.Icon}
              aria-label="New project"
              onClick={actions.create}
            >
              <Icon iconName={IconName.AddCircle} />
            </Button>
          </Tooltip>
        </>
      ) : null}
    </nav>
  );
}
