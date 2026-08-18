import type React from "react";

import { cn } from "../../lib/cn";
import SessionAvatar from "../session-avatar";

interface ChatSessionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Seeds the identicon and identifies the row. */
  sessionId: string;
  title: string;
  active?: boolean;
  running?: boolean;
  /** Pin, rename and delete controls, revealed on hover and focus. */
  actions?: React.ReactNode;
}

/**
 * One session as a list row, used by the chat popover and the mobile modal.
 *
 * The actions live outside the button so they stay clickable, and they hold
 * their space at all times so a hover does not re-truncate the title beside
 * them.
 */
const ChatSessionButton: React.FC<ChatSessionButtonProps> = ({
  sessionId,
  title,
  active = false,
  running = false,
  actions,
  className = "",
  type = "button",
  ...props
}) => (
  <div
    className={cn(
      "group flex items-center gap-2 h-9 px-2 min-w-0 rounded-[4px] hover:bg-btn-ghost-hovered",
      active && "bg-btn-ghost-highlighted",
      className,
    )}
  >
    <button
      type={type}
      className="flex flex-1 items-center gap-2 min-w-0 text-left cursor-pointer"
      {...props}
    >
      <SessionAvatar id={sessionId} size={20} isRunning={running} className="rounded-[2px]" />
      <span
        className={cn(
          "label-small truncate",
          running ? "text-shimmer-basic" : "text-basic-primary",
        )}
      >
        {title}
      </span>
    </button>
    {actions ? (
      <div className="flex items-center gap-1 shrink-0 invisible opacity-0 transition-opacity duration-150 ease-out group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        {actions}
      </div>
    ) : null}
  </div>
);

export default ChatSessionButton;
