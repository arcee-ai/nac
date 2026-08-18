import type React from "react";

import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";
import Loader, { LoaderSize, LoaderVariant } from "../loader";

interface ChatSessionTabProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  title: string;
  active?: boolean;
  /** Swaps the label for a shimmering one and shows a spinner. */
  running?: boolean;
  /** Omit to make the tab uncloseable; the last tab of a project is. */
  onClose?: () => void;
}

/**
 * One session in the tab strip above a project's transcript.
 *
 * The close button keeps its slot at all times and only becomes visible on
 * hover or focus, so moving the pointer along the strip does not make the
 * titles beside it re-truncate tab by tab.
 */
const ChatSessionTab: React.FC<ChatSessionTabProps> = ({
  title,
  active = false,
  running = false,
  onClose,
  className = "",
  type = "button",
  ...props
}) => (
  <div
    className={cn(
      "chat-session-tab group flex items-center gap-2 h-10 w-32 shrink-0 px-2",
      active ? "chat-session-tab-active bg-elevation-level-1" : "hover:bg-btn-ghost-hovered",
      className,
    )}
  >
    <button
      type={type}
      className="flex flex-1 items-center gap-1.5 min-w-0 text-left cursor-pointer"
      title={title}
      {...props}
    >
      {running ? (
        <Loader size={LoaderSize.XSmall} variant={LoaderVariant.Neutral} className="shrink-0" />
      ) : null}
      <span
        className={cn(
          "label-small truncate",
          running ? "text-shimmer-basic" : active ? "text-basic-primary" : "text-basic-secondary",
        )}
      >
        {title}
      </span>
    </button>
    {onClose ? (
      <button
        type="button"
        aria-label={`Close ${title}`}
        title="Close chat"
        onClick={onClose}
        className="shrink-0 rounded-[2px] p-0.5 text-basic-muted cursor-pointer hover:bg-btn-ghost-hovered hover:text-basic-primary invisible opacity-0 transition-opacity duration-150 ease-out group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <Icon iconName={IconName.Close} size={14} />
      </button>
    ) : null}
  </div>
);

export default ChatSessionTab;
