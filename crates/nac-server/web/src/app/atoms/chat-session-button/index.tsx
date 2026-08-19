import type React from "react";

import { cn } from "../../lib/cn";
import Loader, { LoaderSize, LoaderVariant } from "../loader";

interface ChatSessionButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "title"
> {
  title: string;
  active?: boolean;
  /** Swaps the label for a shimmering one and shows a spinner. */
  running?: boolean;
  /** Taller touch target and always-visible actions for the mobile modal. */
  isMobile?: boolean;
  /** Rename and delete controls, revealed on hover and on keyboard focus. */
  actions?: React.ReactNode;
}

/**
 * One session as a list row, used by the chat popover and the mobile modal.
 *
 * The row is the title and nothing else — the strip's tabs and this list are
 * read as one set of names, so neither carries a mark of its own.
 *
 * The actions live outside the button so they stay clickable, and they hold
 * their space at all times so a hover does not re-truncate the title beside
 * them.
 */
const ChatSessionButton: React.FC<ChatSessionButtonProps> = ({
  title,
  active = false,
  running = false,
  isMobile = false,
  actions,
  className = "",
  type = "button",
  ...props
}) => (
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
      {running ? (
        <Loader size={LoaderSize.Micro} variant={LoaderVariant.Neutral} className="shrink-0" />
      ) : null}
      <span
        className={cn(
          "truncate",
          isMobile ? "text-medium" : "label-small",
          running
            ? "text-shimmer-basic"
            : active
              ? "text-btn-secondary-pressed"
              : "text-btn-secondary group-hover:text-btn-secondary-hovered",
        )}
      >
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

export default ChatSessionButton;
