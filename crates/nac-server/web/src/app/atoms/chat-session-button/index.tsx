import type React from "react";

import { cn } from "../../lib/cn";
import ChatSessionLeadingMark from "../chat-session-fork-mark";

interface ChatSessionButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "title"
> {
  title: string;
  active?: boolean;
  /** Swaps the label for a shimmering one and shows a spinner. */
  running?: boolean;
  /** Display title of the chat this session was forked from. */
  forkedFromTitle?: string | null;
  /** Taller touch target and always-visible actions for the mobile modal. */
  isMobile?: boolean;
  /** Rename and delete controls, revealed on hover and on keyboard focus. */
  actions?: React.ReactNode;
}

/**
 * One session as a list row, used by the chat popover and the mobile modal.
 *
 * The row is the title, with a fork glyph in front when this chat was cloned
 * from another. A running session replaces that glyph with the same loader the
 * unforked rows use.
 *
 * The actions live outside the button so they stay clickable, and they hold
 * their space at all times so a hover does not re-truncate the title beside
 * them.
 */
const ChatSessionButton: React.FC<ChatSessionButtonProps> = ({
  title,
  active = false,
  running = false,
  forkedFromTitle,
  isMobile = false,
  actions,
  className = "",
  type = "button",
  ...props
}) => {
  const labelClass = running
    ? "text-shimmer-basic"
    : active
      ? "text-btn-secondary-pressed"
      : "text-btn-secondary group-hover:text-btn-secondary-hovered";

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
        title={title}
        aria-current={active ? "page" : undefined}
        className={cn("flex flex-1 items-center min-w-0 text-left", isMobile ? "gap-3" : "gap-1.5")}
        {...props}
      >
        <ChatSessionLeadingMark
          forkedFromTitle={forkedFromTitle}
          running={running}
          className={running ? undefined : labelClass}
        />
        <span className={cn("truncate", isMobile ? "text-medium" : "label-small", labelClass)}>
          {title}
        </span>
      </button>
      {actions ? (
        <div
          className={cn(
            "flex items-center gap-1 shrink-0",
            isMobile
              ? null
              : "invisible opacity-0 transition-opacity duration-150 ease-out group-hover:visible group-hover:opacity-100 group-has-[:focus-visible]:visible group-has-[:focus-visible]:opacity-100",
          )}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
};

export default ChatSessionButton;
