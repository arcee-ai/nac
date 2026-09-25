import type React from "react";

import { cn } from "../../lib/cn";
import ChatSessionLeadingMark from "../chat-session-fork-mark";
import Icon, { IconName } from "../icon";

interface ChatSessionButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "title"
> {
  title: string;
  active?: boolean;
  /** Shimmers the title while the session is running. The mode icon stays. */
  running?: boolean;
  /** Session mode glyph. A direct agent is a plane. */
  icon?: IconName;
  /** Display title of the chat this session was forked from. */
  forkedFromTitle?: string | null;
  /** Compact identity shown after the title, such as the session behavior. */
  badge?: string;
  /** Full accessible meaning of the compact badge. */
  badgeLabel?: string;
  /** Authoritative server activity is newer than the browser's viewed marker. */
  unread?: boolean;
  /** Taller touch target and always-visible actions for the mobile modal. */
  isMobile?: boolean;
  /** Rename and delete controls, revealed on hover and on keyboard focus. */
  actions?: React.ReactNode;
}

/**
 * One session as a list row, used by the chat popover and the mobile modal.
 *
 * The row leads with the session-mode icon. A fork keeps the scheme glyph
 * after the title, including while the chat is running.
 *
 * The actions live outside the button so they stay clickable. On desktop they
 * leave the layout until the row is hovered or focused from the keyboard, so
 * the title keeps the full row until then.
 */
const ChatSessionButton: React.FC<ChatSessionButtonProps> = ({
  title,
  active = false,
  running = false,
  icon = IconName.Plane,
  forkedFromTitle,
  badge,
  badgeLabel,
  unread = false,
  isMobile = false,
  actions,
  className = "",
  type = "button",
  "aria-label": ariaLabel,
  ...props
}) => {
  const toneClass = active
    ? "text-btn-secondary-pressed"
    : "text-btn-secondary group-hover:text-btn-secondary-hovered";
  const labelClass = running ? "text-shimmer-basic" : toneClass;

  return (
    <div
      className={cn(
        "group flex items-center min-w-0 rounded-[4px]",
        isMobile ? "h-12 gap-3 px-3 py-2" : "h-9 gap-1.5 px-2 py-1",
        active
          ? "bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered"
          : "hover:bg-btn-ghost-hovered",
        className,
      )}
    >
      <button
        type={type}
        title={badgeLabel ? `${title} · ${badgeLabel}` : title}
        aria-label={ariaLabel ?? (badgeLabel ? `${title}, ${badgeLabel}` : title)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-1 items-center min-w-0 rounded-[3px] text-left",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary",
          isMobile ? "gap-3" : "gap-1.5",
        )}
        {...props}
      >
        <Icon
          iconName={icon}
          size={20}
          aria-hidden
          data-session-behavior-icon={icon}
          className={cn("shrink-0", toneClass)}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            isMobile ? "text-medium" : "label-small",
            labelClass,
          )}
        >
          {title}
        </span>
        <ChatSessionLeadingMark forkedFromTitle={forkedFromTitle} className={toneClass} />
        {badge ? (
          <span
            title={badgeLabel}
            className="tag-label max-w-[76px] shrink-0 truncate rounded bg-elevation-level-3 px-1 text-basic-tertiary"
          >
            {badge}
          </span>
        ) : null}
        {unread ? (
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-accent-primary"
            title="Updated since last viewed"
          >
            <span className="sr-only">Unread</span>
          </span>
        ) : null}
      </button>
      {actions ? (
        <div
          className={cn(
            "flex items-center gap-1 shrink-0",
            isMobile ? null : "hidden group-hover:flex group-has-[:focus-visible]:flex",
          )}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
};

export default ChatSessionButton;
