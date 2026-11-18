import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
  PopoverSize,
  StatusDot,
  Tooltip,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { routes } from "@/app/lib/routes";
import type { SessionStatus } from "@/app/lib/sessionStatus";
import { useProjectActions } from "@/app/providers/ProjectActionsProvider";
import type { ProjectRecord } from "@/app/types/api";

import { Menu, MenuItem, MenuSeparator } from "./MenuItem";

const REVEAL =
  "opacity-0 group-hover/group:opacity-100 group-focus-within/group:opacity-100 [@media(hover:none)]:opacity-100";

/**
 * A project's row in the sidebar: fold toggle with the name, then a quiet
 * "new session here" and an options menu (pin, rename, interval tasks, delete).
 */
export function ProjectGroupHeader({
  project,
  count,
  expanded,
  status,
  touch = false,
  onToggle,
  onNavigate,
}: {
  project: ProjectRecord;
  count: number;
  expanded: boolean;
  /** Rolled-up status, shown only while the group is folded. */
  status: SessionStatus;
  touch?: boolean;
  onToggle: () => void;
  /** Runs before any navigation this header starts (closes the phone menu). */
  onNavigate?: () => void;
}) {
  const actions = useProjectActions();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const then = (run: () => void) => () => {
    setMenuOpen(false);
    run();
  };
  return (
    <div
      className={cn(
        "group/group relative flex min-w-0 items-center gap-0.5 rounded-md pr-1",
        touch ? "min-h-11" : "h-8",
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${project.name}, ${count} ${count === 1 ? "session" : "sessions"}`}
        title={project.cwd}
        onClick={onToggle}
        className={cn(
          "group/name flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pl-2.5 text-left outline-none",
          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--f-focus)]",
        )}
      >
        <Icon
          iconName={expanded ? IconName.FolderOpen : IconName.Folder}
          size={16}
          className="shrink-0 text-basic-tertiary group-hover/name:text-basic-primary"
        />
        <span
          className={cn(
            "min-w-0 truncate text-basic-secondary group-hover/name:text-basic-primary",
            touch ? "type-body-chrome !text-md" : "type-body-chrome",
          )}
        >
          {project.name}
        </span>
        {project.pinned ? (
          <Icon iconName={IconName.Pin} size={12} className="shrink-0 text-basic-muted" />
        ) : null}
        {!expanded && count > 0 ? (
          <>
            <StatusDot status={status} hideIdle />
            <span className="type-meta tabular text-basic-muted">{count}</span>
          </>
        ) : null}
      </button>
      <div className={cn("flex shrink-0 items-center gap-0.5", !menuOpen && REVEAL)}>
        <Tooltip title="New session in project" sticky>
          <Button
            variant={ButtonVariant.Ghost}
            size={touch ? ButtonSize.Medium : ButtonSize.Small}
            content={ButtonContent.Icon}
            aria-label={`New session in ${project.name}`}
            className={cn(touch && "!size-11")}
            onClick={() => {
              onNavigate?.();
              void actions.newChat(project.project_id);
            }}
          >
            <Icon iconName={IconName.Add} />
          </Button>
        </Tooltip>
        <Popover
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          sticky
          placement={PopoverPlacement.BottomRight}
          size={PopoverSize.Small}
          content={
            <Menu label={`${project.name} options`}>
              <MenuItem
                icon={IconName.Add}
                label="New session"
                onSelect={then(() => {
                  onNavigate?.();
                  void actions.newChat(project.project_id);
                })}
              />
              <MenuItem
                icon={project.pinned ? IconName.Unpin : IconName.Pin}
                label={project.pinned ? "Unpin project" : "Pin project"}
                onSelect={then(() => void actions.togglePin(project))}
              />
              <MenuItem
                icon={IconName.Edit}
                label="Rename project"
                onSelect={then(() => actions.rename(project))}
              />
              <MenuItem
                icon={IconName.Clock}
                label="Interval tasks"
                onSelect={then(() => {
                  onNavigate?.();
                  navigate(routes.taskSchedules(project.project_id));
                })}
              />
              <MenuSeparator />
              <MenuItem
                icon={IconName.Trash}
                label="Delete project"
                destructive
                onSelect={then(() => actions.remove(project))}
              />
            </Menu>
          }
        >
          <Tooltip title="Project options" sticky disabled={menuOpen}>
            <Button
              variant={ButtonVariant.Ghost}
              size={touch ? ButtonSize.Medium : ButtonSize.Small}
              content={ButtonContent.Icon}
              aria-label={`${project.name} options`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={cn(touch && "!size-11")}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon iconName={IconName.MenuHorizontal} />
            </Button>
          </Tooltip>
        </Popover>
      </div>
    </div>
  );
}
