import type React from "react";

import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import ChatSessionLeadingMark from "../chat-session-fork-mark";
import Icon, { IconName } from "../icon";

interface ChatSessionTabProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  title: string;
  active?: boolean;
  /** Swaps the label for a shimmering one and shows a spinner. */
  running?: boolean;
  /** Display title of the chat this session was forked from. */
  forkedFromTitle?: string | null;
  /** Takes the tab off the strip. The chat itself is untouched. */
  onDismiss?: () => void;
}

/**
 * One session in the tab strip above a project's transcript. The tab is a fixed
 * width so the strip's rhythm survives titles of any length, and the underline
 * on the active one is the only thing marking it as selected. A fork shows the
 * scheme glyph in front until the chat is running, when the loader takes that
 * slot.
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
  forkedFromTitle,
  onDismiss,
  className = "",
  type = "button",
  ...props
}) => {
  const labelClass = running
    ? "text-shimmer-basic group-hover:w-[calc(100%-36px)] group-hover:max-w-[calc(100%-36px)]"
    : forkedFromTitle
      ? "text-btn-secondary group-hover:text-btn-secondary-hovered group-hover:w-[calc(100%-32px)] group-hover:max-w-[calc(100%-32px)]"
      : active
        ? "text-btn-secondary-pressed group-hover:w-[calc(100%-16px)] group-hover:max-w-[calc(100%-16px)]"
        : "text-btn-secondary group-hover:text-btn-secondary-hovered group-hover:w-[calc(100%-16px)] group-hover:max-w-[calc(100%-16px)]";

  return (
    <div
      className={cn(
        "chat-session-tab group flex shrink-0 items-center justify-start gap-1 relative",
        active
          ? "chat-session-tab-active bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered"
          : "hover:bg-btn-ghost-hovered",
        className,
      )}
    >
      <button
        type={type}
        aria-label={title}
        aria-current={active ? "page" : undefined}
        className="flex flex-1 min-w-0 items-center justify-start gap-1 px-2 py-1 h-10 w-full max-w-32 min-w-10"
        {...props}
      >
        <ChatSessionLeadingMark
          forkedFromTitle={forkedFromTitle}
          running={running}
          className={
            running
              ? undefined
              : active
                ? "text-btn-secondary-pressed"
                : "text-btn-secondary group-hover:text-btn-secondary-hovered"
          }
        />
        <span className={cn("label-micro w-full min-w-0 truncate text-left", labelClass)}>
          {title}
        </span>
      </button>
      {onDismiss ? (
        <Button
          variant={ButtonVariant.Tertiary}
          size={ButtonSize.Small}
          content={ButtonContent.Icon}
          aria-label={`Close ${title}`}
          onClick={onDismiss}
          // Hidden rather than transparent, so the title gets the room back
          // whenever the pointer is elsewhere. Keyboard focus reveals it too, but
          // only the visible kind: clicking a tab leaves its title button focused,
          // and plain `:focus` would strand the button on screen long after the
          // pointer moved away.
          //
          // `.btn`'s own `display` is unlayered CSS, so a plain `hidden` never
          // reaches it.
          className="shrink-0 !hidden group-hover:!inline-flex group-has-[:focus-visible]:!inline-flex absolute right-0 top-1/2 -translate-y-1/2"
        >
          <Icon iconName={IconName.Close} />
        </Button>
      ) : null}
    </div>
  );
};

export default ChatSessionTab;
