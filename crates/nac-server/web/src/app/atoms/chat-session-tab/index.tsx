import type React from "react";

import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";
import Loader, { LoaderSize, LoaderVariant } from "../loader";

interface ChatSessionTabProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  title: string;
  active?: boolean;
  /** Swaps the label for a shimmering one and shows a spinner. */
  running?: boolean;
  /** Takes the tab off the strip. The chat itself is untouched. */
  onDismiss?: () => void;
}

/**
 * One session in the tab strip above a project's transcript. The tab is a fixed
 * width so the strip's rhythm survives titles of any length, and the underline
 * on the active one is the only thing marking it.
 *
 * Pointing at a tab reveals its close control, which takes its room from the
 * title rather than being held in reserve — a strip of tabs is read at a glance,
 * so the untouched ones show as much of their name as they can. Renaming lives
 * in the chat list, where there is room to say what the button does.
 */
const ChatSessionTab: React.FC<ChatSessionTabProps> = ({
  title,
  active = false,
  running = false,
  onDismiss,
  className = "",
  type = "button",
  ...props
}) => (
  <div
    className={cn(
      "chat-session-tab group flex h-10 w-32 shrink-0 items-center justify-center gap-1 px-2 py-1",
      active
        ? "chat-session-tab-active bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered"
        : "hover:bg-btn-ghost-hovered",
      className,
    )}
  >
    <button
      type={type}
      title={title}
      aria-current={active ? "page" : undefined}
      className="flex flex-1 min-w-0 items-center justify-center gap-1"
      {...props}
    >
      {running ? (
        <Loader size={LoaderSize.Micro} variant={LoaderVariant.Neutral} className="shrink-0" />
      ) : null}
      <span
        className={cn(
          "label-small flex-1 min-w-0 truncate text-center",
          running
            ? "text-shimmer-basic"
            : active
              ? "text-btn-secondary-pressed"
              : "text-btn-secondary",
        )}
      >
        {title}
      </span>
    </button>
    {onDismiss ? (
      <TabAction
        iconName={IconName.Close}
        label={`Close ${title}`}
        tooltip="Close tab"
        onClick={onDismiss}
      />
    ) : null}
  </div>
);

/**
 * Hidden rather than transparent, so the title gets the room back whenever the
 * pointer is elsewhere.
 *
 * Keyboard focus reveals it too, but only the visible kind: clicking a tab
 * leaves its title button focused, and plain `:focus` would strand the controls
 * on screen long after the pointer moved away.
 */
function TabAction({
  iconName,
  label,
  tooltip,
  onClick,
}: {
  iconName: IconName;
  label: string;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={tooltip}
      aria-label={label}
      onClick={onClick}
      className="hidden shrink-0 p-1 rounded-[4px] text-basic-muted hover:text-basic-primary hover:bg-btn-ghost-hovered group-hover:block group-has-[:focus-visible]:block"
    >
      <Icon iconName={iconName} size={16} />
    </button>
  );
}

export default ChatSessionTab;
