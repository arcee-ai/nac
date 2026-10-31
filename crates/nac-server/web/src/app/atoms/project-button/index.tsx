import type React from "react";

import { cn } from "../../lib/cn";
import ChatSessionOrphanAvatar from "../chat-session-orphan-avatar";
import { useSessionNameDisclosure } from "../session-name-disclosure";
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
  /** Taller touch target and larger type for the phone menu. */
  isMobile?: boolean;
  actions?: React.ReactNode;
}

/**
 * One project as a list row, shared by the project popover and the phone menu.
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
}) => {
  const disclosure = useSessionNameDisclosure(name);
  const orphan = variant === ProjectButtonVariant.Orphan;
  return (
    <div
      className={cn(
        "group flex items-center min-w-0 rounded-interaction",
        "-outline-offset-2 outline-[var(--color-border-focus-outline)] has-[>button:focus-visible]:outline-2",
        isMobile ? "h-12 gap-3 px-3 py-2" : "h-9 gap-1.5 px-2 py-1",
        active
          ? "bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered has-[>button:active]:bg-btn-ghost-highlighted-pressed has-[>button:disabled]:bg-btn-ghost-highlighted-disabled"
          : "hover:bg-btn-ghost-hovered has-[>button:active]:bg-btn-ghost-pressed has-[>button:disabled]:bg-btn-ghost-disabled",
        className,
      )}
    >
      {disclosure.hint(
        <button
          type={type}
          className={cn(
            "flex flex-1 items-center min-w-0 text-left outline-none",
            active
              ? "text-btn-secondary-pressed"
              : "text-btn-secondary group-hover:text-btn-secondary-hovered active:text-btn-secondary-pressed",
            "disabled:cursor-not-allowed disabled:text-btn-secondary-disabled",
            isMobile ? "gap-3" : "gap-1.5",
          )}
          aria-label={name}
          {...props}
        >
          {variant === ProjectButtonVariant.Orphan ? (
            <ChatSessionOrphanAvatar size={24} isRunning={running} />
          ) : (
            <SessionAvatar id={entityId} size={20} isRunning={running} className="rounded-[2px]" />
          )}
          <span
            className={cn(
              "flex-1 truncate",
              isMobile ? "label-medium" : "label-small",
              running && "text-shimmer-primary",
            )}
          >
            {name}
          </span>
        </button>,
        !orphan,
      )}
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
      {actions || orphan ? (
        <div
          className={cn(
            "items-center shrink-0",
            isMobile
              ? "flex gap-3"
              : "flex gap-1.5 sr-only group-hover:not-sr-only group-has-[:focus-visible]:not-sr-only focus-within:not-sr-only",
          )}
        >
          {orphan ? disclosure.action : null}
          {actions}
        </div>
      ) : null}
      {orphan ? disclosure.overlay : null}
    </div>
  );
};

ProjectButton.Variant = ProjectButtonVariant;

export default ProjectButton;
