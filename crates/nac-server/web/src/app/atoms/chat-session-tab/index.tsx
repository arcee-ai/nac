import type React from "react";

import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import ChatSessionLeadingMark from "../chat-session-fork-mark";
import Icon, { IconName } from "../icon";
import ShimmerLoader from "../loader/ShimmerLoader";
import Tooltip from "../tooltip";

interface ChatSessionTabProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  title: string;
  active?: boolean;
  /** Swaps the label for a shimmering one and shows a spinner. */
  running?: boolean;
  /** Display title of the chat this session was forked from. */
  forkedFromTitle?: string | null;
  /** Compact identity shown immediately before the title. */
  behaviorIcon?: IconName;
  /** Full accessible and hover/focus meaning of the behavior icon. */
  behaviorLabel?: string;
  /** Takes the tab off the strip. The chat itself is untouched. */
  onDismiss?: () => void;
}

/** Tab-shaped stand-in while the project's chats have not arrived yet. */
export function ChatSessionTabSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={cn(
        "chat-session-tab flex h-10 w-32 max-w-full min-w-10 shrink-0 items-center px-2 py-1",
        className,
      )}
      aria-hidden
    >
      <ShimmerLoader rows={1} className="w-full gap-0" rowClassName="h-3" />
    </div>
  );
}

/**
 * One session in the tab strip above a project's transcript. Its owner decides
 * the available width so the atom can serve fixed previews and a flexible
 * project strip alike. The underline on the active one is the only thing
 * marking it as selected. A fork shows the scheme glyph in front until the chat
 * is running, when the loader takes that slot.
 *
 * Pointing at or focusing a tab reveals its close control. The tab reserves that
 * room only while the control is visible, so it cannot cover the behavior icon
 * or title and untouched tabs still show as much of their name as possible.
 * Renaming lives in the chat list, where there is room to say what the button
 * does.
 */
const ChatSessionTab: React.FC<ChatSessionTabProps> = ({
  title,
  active = false,
  running = false,
  forkedFromTitle,
  behaviorIcon,
  behaviorLabel,
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

  const tabButton = (
    <button
      type={type}
      title={title}
      aria-label={ariaLabel ?? (behaviorLabel ? `${title}, ${behaviorLabel}` : title)}
      aria-current={active ? "page" : undefined}
      className="flex h-10 w-full min-w-0 flex-1 items-center justify-start gap-1 py-1 pl-2 pr-2 group-hover:pr-8 group-has-[:focus-visible]:pr-8"
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
      {behaviorIcon ? (
        <Icon
          iconName={behaviorIcon}
          size={16}
          aria-hidden
          data-session-behavior-icon={behaviorIcon}
          className={cn("shrink-0", labelClass)}
        />
      ) : null}
      <span
        data-session-tab-title
        className={cn("label-micro w-full min-w-0 flex-1 truncate text-left", labelClass)}
      >
        {title}
      </span>
    </button>
  );

  return (
    <div
      className={cn(
        "chat-session-tab group relative flex w-32 max-w-full shrink-0 items-center justify-start gap-1",
        active
          ? "chat-session-tab-active bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered"
          : "hover:bg-btn-ghost-hovered",
        className,
      )}
    >
      {behaviorLabel ? (
        <Tooltip
          title={behaviorLabel}
          position={Tooltip.Position.BottomLeft}
          sticky
          className="min-w-0 flex-1"
        >
          {tabButton}
        </Tooltip>
      ) : (
        tabButton
      )}
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
          className="absolute right-1 top-1/2 -translate-y-1/2 shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-has-[:focus-visible]:opacity-100 group-has-[:focus-visible]:pointer-events-auto"
        >
          <Icon iconName={IconName.Close} />
        </Button>
      ) : null}
    </div>
  );
};

export default ChatSessionTab;
