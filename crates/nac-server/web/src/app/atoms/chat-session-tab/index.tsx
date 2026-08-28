import type React from "react";

import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import ChatSessionLeadingMark from "../chat-session-fork-mark";
import Icon, { IconName } from "../icon";
import ShimmerLoader from "../loader/ShimmerLoader";

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

/** Tab-shaped stand-in while the project's chats have not arrived yet. */
export function ChatSessionTabSkeleton() {
  return (
    <div
      className="chat-session-tab flex h-10 w-32 max-w-32 min-w-10 shrink-0 items-center px-2 py-1"
      aria-hidden
    >
      <ShimmerLoader rows={1} className="w-full gap-0" rowClassName="h-3" />
    </div>
  );
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
          title="Close tab"
          onClick={(event) => {
            event.stopPropagation();
            onDismiss();
          }}
          // Stay in layout (`display` is `.btn`'s) and fade in on hover. Toggling
          // `hidden` never wins against unlayered `.btn { display: inline-flex }`.
          className="absolute right-0 top-1/2 -translate-y-1/2 shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-has-[:focus-visible]:opacity-100 group-has-[:focus-visible]:pointer-events-auto"
        >
          <Icon iconName={IconName.Close} />
        </Button>
      ) : null}
    </div>
  );
};

export default ChatSessionTab;
