import type React from "react";

import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";
import SessionAvatar from "../session-avatar";

export enum ProjectButtonVariant {
  Project = "project",
  /** A session that belongs to no project; it gets a chat glyph, not a project. */
  Orphan = "orphan",
}

interface ProjectButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Seeds the identicon: a project id, or the session id for an orphan. */
  entityId: string;
  name: string;
  variant?: ProjectButtonVariant;
  active?: boolean;
  running?: boolean;
  /** Session count and similar, shown right of the name. */
  trailing?: React.ReactNode;
  /** Taller touch target and larger type for the mobile modal. */
  isMobile?: boolean;
  actions?: React.ReactNode;
}

/** One project as a list row, shared by the project popover and the mobile modal. */
const ProjectButton: React.FC<ProjectButtonProps> & {
  Variant: typeof ProjectButtonVariant;
} = ({
  entityId,
  name,
  variant = ProjectButtonVariant.Project,
  active = false,
  running = false,
  trailing,
  isMobile = false,
  actions,
  className = "",
  type = "button",
  ...props
}) => (
  <div
    className={cn(
      "group flex items-center min-w-0 rounded-[4px] hover:bg-btn-ghost-hovered",
      isMobile ? "h-12 gap-3 px-3" : "h-9 gap-2 px-2",
      active && "bg-btn-ghost-highlighted",
      className,
    )}
  >
    <button
      type={type}
      className={cn(
        "flex flex-1 items-center min-w-0 text-left cursor-pointer",
        isMobile ? "gap-3" : "gap-2",
      )}
      {...props}
    >
      {variant === ProjectButtonVariant.Orphan ? (
        <Icon
          iconName={IconName.Chat}
          size={isMobile ? 24 : 20}
          className={cn("shrink-0 text-basic-muted", running && "pulse-dim")}
        />
      ) : (
        <SessionAvatar
          id={entityId}
          size={isMobile ? 24 : 20}
          isRunning={running}
          className="rounded-[2px]"
        />
      )}
      <span
        className={cn(
          "flex-1 truncate",
          isMobile ? "text-medium" : "label-small",
          running ? "text-shimmer-basic" : "text-basic-primary",
        )}
      >
        {name}
      </span>
      {trailing ? <span className="shrink-0 label-micro text-basic-muted">{trailing}</span> : null}
    </button>
    {actions ? (
      <div
        className={cn(
          "flex items-center gap-1 shrink-0",
          // A touch device has no hover to reveal them with.
          !isMobile &&
            "invisible opacity-0 transition-opacity duration-150 ease-out group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100",
        )}
      >
        {actions}
      </div>
    ) : null}
  </div>
);

ProjectButton.Variant = ProjectButtonVariant;

export default ProjectButton;
