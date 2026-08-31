import type React from "react";

import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";
import ShimmerLoader from "../loader/ShimmerLoader";
import SessionTypeAvatar, {
  SessionOrigin,
  SessionType,
} from "../session-type-avatar";
import Tooltip from "../tooltip";

interface ChatSessionTabProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "title"
> {
  title: string;
  active?: boolean;
  /** Shimmering title and Active (running) avatar overlay. */
  running?: boolean;
  sessionType?: `${SessionType}`;
  origin?: `${SessionOrigin}`;
  /** Full accessible meaning of the session type, e.g. "Agent". */
  badgeLabel?: string;
  /**
   * Avatar hover copy under the full title: type, plus fork / conversion /
   * created-by-agent when that applies. Same pattern as the pre-revamp fork mark.
   */
  avatarDescription?: string;
  /** Takes the tab off the strip. The chat itself is untouched. */
  onDismiss?: () => void;
}

/** Tab-shaped stand-in while the project's chats have not arrived yet. */
export function ChatSessionTabSkeleton() {
  return (
    <div
      className="chat-session-tab flex h-[44px] w-[160px] max-w-[160px] shrink-0 items-center px-2 pt-[2px] pb-1"
      aria-hidden
    >
      <ShimmerLoader rows={1} className="w-full gap-0" rowClassName="h-3" />
    </div>
  );
}

/**
 * One session in the tab strip above a project's transcript (Figma SessionTab).
 * Fixed 160×44 so the strip's rhythm survives titles of any length. The type
 * mark carries identity; origin is the badge on that mark. The underline on
 * the active tab is the selected state. Running is a shimmer on the title and
 * on the avatar, not a selected highlight.
 *
 * Hover, keyboard focus and press reveal the close control and give it room
 * by widening the right padding rather than reserving it.
 */
const ChatSessionTab: React.FC<ChatSessionTabProps> = ({
  title,
  active = false,
  running = false,
  sessionType = SessionType.Agent,
  origin = SessionOrigin.User,
  badgeLabel,
  avatarDescription,
  onDismiss,
  className = "",
  type = "button",
  disabled = false,
  "aria-label": ariaLabel,
  ...props
}) => {
  const titleClass = running
    ? "text-shimmer-basic"
    : disabled
      ? "text-btn-secondary-disabled"
      : active
        ? "text-btn-secondary-pressed"
        : "text-btn-secondary group-hover:text-btn-secondary-hovered group-active:text-btn-secondary-pressed";

  return (
    <div
      className={cn(
        "chat-session-tab group relative flex h-[44px] w-[160px] max-w-[160px] shrink-0 items-center rounded-tl-[4px] rounded-tr-[4px]",
        "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-[var(--blue-500)]",
        disabled
          ? "bg-btn-ghost"
          : active
            ? "chat-session-tab-active bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered active:bg-btn-ghost-highlighted-pressed"
            : "bg-btn-ghost hover:bg-btn-ghost-hovered active:bg-btn-ghost-pressed",
        className,
      )}
    >
      <button
        type={type}
        disabled={disabled}
        aria-label={
          ariaLabel ?? (badgeLabel ? `${title}, ${badgeLabel}` : title)
        }
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-full min-w-0 w-full items-center gap-2 pt-[2px] pb-1 pl-2 focus-visible:outline-none",
          onDismiss
            ? "pr-4 group-hover:pr-10 group-has-[:focus-visible]:pr-10 group-active:pr-10"
            : "pr-4",
        )}
        {...props}
      >
        <Tooltip
          title={title}
          description={avatarDescription ?? badgeLabel}
          position={Tooltip.Position.BottomCenter}
          sticky
          className="shrink-0"
        >
          <SessionTypeAvatar
            sessionType={sessionType}
            origin={origin}
            running={running}
          />
        </Tooltip>
        <span
          className={cn(
            "label-small min-w-0 flex-1 truncate text-left",
            titleClass,
          )}
        >
          {title}
        </span>
      </button>
      {onDismiss ? (
        <Button
          variant={ButtonVariant.Ghost}
          size={ButtonSize.Small}
          content={ButtonContent.Icon}
          disabled={disabled}
          aria-label={`Close ${title}`}
          title="Close tab"
          onClick={(event) => {
            event.stopPropagation();
            onDismiss();
          }}
          className="absolute top-[9px] right-2 shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-has-[:focus-visible]:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-active:opacity-100 group-active:pointer-events-auto"
        >
          <Icon iconName={IconName.Close} size={16} />
        </Button>
      ) : null}
    </div>
  );
};

export default ChatSessionTab;
