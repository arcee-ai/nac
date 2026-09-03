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
import { MobileProjectSessionModal } from "@/app/components/modals/MobileProjectSessionModal";
import { ProjectPopover } from "@/app/components/projects/ProjectPopover";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { useSessionTitle } from "@/app/hooks/useSessionTitle";
import { isActiveRun, parseStoreTime } from "@/app/lib/format";
import { findProject, primarySessions } from "@/app/lib/projects";
import { projectIdFromPath, routes, sessionIdFromPath } from "@/app/lib/routes";
import { NEW_PROJECT_KEYS } from "@/app/lib/shortcuts";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import { useProjects, useSessions } from "@/app/services/queries";

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
  const isMobile = useIsMobile();
  const sessionTitle = useSessionTitle();
  const { data: projectList } = useProjects();
  const { data: sessions = [] } = useSessions();
  const [open, setOpen] = useState(false);

  const currentEntry = sessionId
    ? sessions.find((entry) => entry.summary.session_id === sessionId)
    : undefined;
  const projectId = routeProjectId ?? currentEntry?.summary.project_id ?? null;
  const project = findProject(projectList?.projects ?? [], projectId);
  // Only the phone's sheet lists them; the desktop popover fetches its own.
  const projectSessions = projectId
    ? primarySessions(sessions)
        .filter((entry) => entry.summary.project_id === projectId)
        .sort((a, b) => parseStoreTime(b.summary.updated_at) - parseStoreTime(a.summary.updated_at))
    : [];

  const inTrail = Boolean(projectId || sessionId);
  // An orphan has a chat but no project, so the trail falls back to its title
  // and the neutral chat tile.
  const label = project?.name ?? sessionTitle(currentEntry?.summary) ?? sessionId ?? "";
  // A phone names the chat and puts its project underneath, because the tab
  // strip that says which chat is open on a wider screen is not there to say
  // it. An unassigned chat keeps the second line, in the danger color, so the
  // missing project is still visible.
  const chatTitle = currentEntry ? sessionTitle(currentEntry.summary) : null;
  const avatarId = project?.project_id ?? sessionId ?? "";
  // The project chip pulses when any chat in that project is running, not
  // only the one whose tab is open. An unassigned chat can only pulse for itself.
  const running = projectId
    ? projectSessions.some((entry) => isActiveRun(entry.active_run))
    : isActiveRun(currentEntry?.active_run);

  // A phone has no room for the trail: inside a project only the project shows,
  // and the button that opens it doubles as the way back to the list.
  const showRoot = !isMobile || !inTrail;

  return (
    <nav
      className={cn("flex items-center min-w-0 gap-1", isMobile && inTrail && "flex-1")}
      aria-label="Breadcrumb"
    >
      {showRoot ? (
        isMobile ? (
          // The phone drops the button chrome and steps the label up to 16px.
          // `.btn-medium` would pin it back to 14px, so this cannot be a Button.
          <button
            type="button"
            className="label-medium text-btn-secondary rounded-[8px] truncate"
            onClick={() => navigate(routes.list())}
            aria-current={inTrail ? undefined : "page"}
          >
            All Projects
          </button>
        ) : (
          <Button
            variant={ButtonVariant.Ghost}
            size={ButtonSize.Medium}
            content={ButtonContent.Text}
            onClick={() => navigate(routes.list())}
            aria-current={inTrail ? undefined : "page"}
          >
            All Projects
          </Button>
        )
      ) : null}

      {inTrail ? (
        <>
          {showRoot ? (
            <Icon iconName={IconName.Right} className="text-basic-muted shrink-0" />
          ) : null}
          {isMobile ? (
            <>
              {/* The design gives the phone a slot holding the two names and a
                  chevron — no avatar, and type the button atom's own font size
                  would override. */}
              <button
                type="button"
                className="flex flex-1 min-w-0 items-center gap-2 rounded-[8px] text-btn-secondary"
                onClick={() => setOpen(true)}
                aria-expanded={open}
                aria-label="Switch chat or project"
              >
                <span className="flex flex-col flex-1 min-w-0 text-left">
                  <span
                    className={cn(
                      "label-medium truncate !leading-[20px]",
                      running ? "text-shimmer-basic" : "text-basic-primary",
                    )}
                  >
                    {chatTitle ?? label}
                  </span>
                  {chatTitle ? (
                    <span
                      className={cn(
                        "text-micro truncate",
                        project ? "text-basic-muted" : "text-danger-primary",
                      )}
                    >
                      {project?.name ?? "Not assigned"}
                    </span>
                  ) : null}
                </span>
                <Icon iconName={IconName.Right} size={24} className="shrink-0" />
              </button>
              <MobileProjectSessionModal
                open={open}
                onClose={() => setOpen(false)}
                projectId={projectId}
                sessions={projectSessions}
                activeSessionId={sessionId}
                summary={currentEntry?.summary ?? null}
              />
            </>
          ) : (
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
          )}
          {/* The phone header is already at its limit, and the list one tap
              away carries the same button. */}
          {isMobile ? null : (
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
          )}
        </>
      ) : null}
    </nav>
  );
}
