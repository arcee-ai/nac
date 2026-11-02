import type React from "react";

import { cn } from "../../lib/cn";
import type { SessionBehavior } from "../../types/api";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import ChatSessionLeadingMark from "../chat-session-fork-mark";
import Icon, { IconName } from "../icon";
import ShimmerLoader from "../loader/ShimmerLoader";
import SessionBehaviorIcon, { SessionBehaviorIconSize } from "../session-behavior-icon";
import { useSessionNameDisclosure } from "../session-name-disclosure";

interface ChatSessionTabProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  title: string;
  active?: boolean;
  /** Swaps the label for a shimmering one and shows a spinner. */
  running?: boolean;
  /** Display title of the chat this session was forked from. */
  forkedFromTitle?: string | null;
  /** Session type, drawn immediately before the title. */
  behavior?: SessionBehavior | null;
  /** Figma `isNacEnable`: whether the behavior glyph is drawn at all. */
  showBehaviorIcon?: boolean;
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
  behavior,
  showBehaviorIcon = false,
  behaviorLabel,
  onDismiss,
  className = "",
  type = "button",
  "aria-label": ariaLabel,
  ...props
}) => {
  const disclosure = useSessionNameDisclosure(title, behaviorLabel);
  const labelClass = running
    ? "text-shimmer-basic"
    : forkedFromTitle
      ? "text-btn-secondary group-hover:text-btn-secondary-hovered"
      : active
        ? "text-btn-secondary-pressed"
        : "text-btn-secondary group-hover:text-btn-secondary-hovered";
  // Not the shimmer: it paints text through a transparent color, which leaves an SVG blank.
  const glyphClass =
    active && !forkedFromTitle
      ? "text-fill-btn-secondary-pressed"
      : "text-fill-btn-secondary group-hover:text-fill-btn-secondary-hovered";

  const tabButton = (
    <button
      type={type}
      aria-label={ariaLabel ?? (behaviorLabel ? `${title}, ${behaviorLabel}` : title)}
      aria-current={active ? "page" : undefined}
      className="session-name-tab-trigger flex h-10 w-full min-w-0 flex-1 items-center justify-start gap-1 py-1 pl-2 pr-2 group-hover:pr-14 group-has-[:focus-visible]:pr-14"
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
      {showBehaviorIcon ? (
        <SessionBehaviorIcon
          behavior={behavior}
          size={SessionBehaviorIconSize.Small}
          className={glyphClass}
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
      {disclosure.hint(tabButton)}
      <div className="session-name-tab-actions absolute right-1 top-1/2 -translate-y-1/2 flex items-center opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-has-[:focus-visible]:opacity-100 group-has-[:focus-visible]:pointer-events-auto">
        {disclosure.action}
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
            className="shrink-0"
          >
            <Icon iconName={IconName.Close} />
          </Button>
        ) : null}
      </div>
      {disclosure.overlay}
    </div>
  );
};

export default ChatSessionTab;
