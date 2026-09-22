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
  /** Compact identity shown below the title, such as the session behavior. */
  badge?: string;
  /** Full accessible meaning of the compact badge. */
  badgeLabel?: string;
  /** Takes the tab off the strip. The chat itself is untouched. */
  onDismiss?: () => void;
}

/** Tab-shaped stand-in while the project's chats have not arrived yet. */
export function ChatSessionTabSkeleton() {
  return (
    <div
      className="chat-session-tab flex h-12 w-32 max-w-32 min-w-10 shrink-0 items-center px-2 py-1"
      aria-hidden
    >
      <ShimmerLoader rows={1} className="w-full gap-0" rowClassName="h-3" />
    </div>
  );
}

/**
 * One session in the tab strip above a project's transcript. The tab is a fixed
 * width so the strip's rhythm survives titles of any length. Its first line is
 * reserved for the title and running/fork identity; its second line carries the
 * compact behavior identity without taking width from the title. The underline
 * on the active tab is the only thing marking it as selected.
 *
 * Pointing at a tab reveals its close control on the title line. That line adds
 * the control's clearance only while the control is visible, so it cannot cover
 * the title and untouched tabs still show as much of their name as they can.
 * Renaming lives in the chat list, where there is room to say what the button
 * does.
 */
const ChatSessionTab: React.FC<ChatSessionTabProps> = ({
  title,
  active = false,
  running = false,
  forkedFromTitle,
  badge,
  badgeLabel,
  onDismiss,
  className = "",
  type = "button",
  "aria-label": ariaLabel,
  ...props
}) => {
  const labelClass = running
    ? "text-shimmer-basic"
    : forkedFromTitle
      ? "text-btn-secondary group-hover:text-btn-secondary-hovered"
      : active
        ? "text-btn-secondary-pressed"
        : "text-btn-secondary group-hover:text-btn-secondary-hovered";

  const accessibleTitle = badgeLabel ? `${title}, ${badgeLabel}` : title;
  const discoverableTitle = badgeLabel ? `${title} · ${badgeLabel}` : title;

  return (
    <div
      className={cn(
        "chat-session-tab group relative flex h-12 w-32 max-w-32 min-w-10 shrink-0 items-stretch justify-start",
        active
          ? "chat-session-tab-active bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered"
          : "hover:bg-btn-ghost-hovered",
        className,
      )}
    >
      <button
        type={type}
        title={discoverableTitle}
        aria-label={ariaLabel ?? accessibleTitle}
        aria-current={active ? "page" : undefined}
        className="flex h-12 w-full min-w-0 flex-1 flex-col items-stretch justify-center px-2 py-1 text-left"
        {...props}
      >
        <span className="flex min-w-0 items-center gap-1 transition-[padding] group-hover:pr-4 group-has-[:focus-visible]:pr-4">
          <ChatSessionLeadingMark
            forkedFromTitle={forkedFromTitle}
            running={running}
            className={running ? undefined : labelClass}
          />
          <span
            title={title}
            className={cn("label-micro min-w-0 flex-1 truncate text-left", labelClass)}
          >
            {title}
          </span>
        </span>
        {badge ? (
          <span
            title={badgeLabel}
            className="tag-label max-w-full self-start truncate rounded bg-elevation-level-3 px-1 text-basic-tertiary"
          >
            {badge}
          </span>
        ) : null}
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
          className="absolute right-0 top-0.5 shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-has-[:focus-visible]:opacity-100 group-has-[:focus-visible]:pointer-events-auto"
        >
          <Icon iconName={IconName.Close} />
        </Button>
      ) : null}
    </div>
  );
};

export default ChatSessionTab;
