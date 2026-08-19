import type React from "react";

import { cn } from "../../lib/cn";
import ChatSessionOrphanAvatar from "../chat-session-orphan-avatar";
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
  /** Session count and similar, held at the row's end. */
  trailing?: React.ReactNode;
  /** Taller touch target and larger type for the mobile modal. */
  isMobile?: boolean;
  actions?: React.ReactNode;
}

/**
 * One project as a list row, shared by the project popover and the mobile modal.
 *
 * The row's end holds the session count until the pointer arrives, and the
 * controls then take that same place. Trading one for the other keeps the count
 * at the edge where it can be read down the column, which reserving room for
 * both would not.
 */
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
      isMobile ? "h-12 gap-3 px-3 py-2" : "h-9 gap-1.5 px-2 py-1",
      active && "bg-btn-ghost-highlighted",
      className,
    )}
  >
    <button
      type={type}
      className={cn("flex flex-1 items-center min-w-0 text-left", isMobile ? "gap-3" : "gap-1.5")}
      {...props}
    >
      {variant === ProjectButtonVariant.Orphan ? (
        <ChatSessionOrphanAvatar size={24} isRunning={running} />
      ) : (
        <SessionAvatar id={entityId} size={24} isRunning={running} className="rounded-[2px]" />
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
    </button>
    {trailing ? (
      <span
        className={cn(
          "shrink-0 label-micro text-basic-muted",
          // A touch device has no hover, so nothing ever takes the count's place
          // and both are shown at once.
          actions && !isMobile && "group-hover:hidden group-has-[:focus-visible]:hidden",
        )}
      >
        {trailing}
      </span>
    ) : null}
    {actions ? (
      <div
        className={cn(
          "items-center shrink-0",
          isMobile ? "flex gap-3" : "hidden gap-1.5 group-hover:flex group-has-[:focus-visible]:flex",
        )}
      >
        {actions}
      </div>
    ) : null}
  </div>
);

ProjectButton.Variant = ProjectButtonVariant;

export default ProjectButton;
