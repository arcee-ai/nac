import type React from "react";

import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";
import ShimmerLoader from "../loader/ShimmerLoader";
import OriginSessionBadge, {
  originKindFromOrigin,
} from "../origin-session-badge";
import {
  SessionOrigin,
  SessionType,
  sessionTypeIconName,
} from "../session-type-avatar";
import Tooltip from "../tooltip";

interface ChatSessionTabProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "title"
> {
  title: string;
  active?: boolean;
  /** Shimmering title and type icon. */
  running?: boolean;
  sessionType?: `${SessionType}`;
  origin?: `${SessionOrigin}`;
  /** Full accessible meaning of the session type, e.g. "Agent". */
  badgeLabel?: string;
  /**
   * Icon hover copy under the full title: type, plus fork / conversion /
   * created-by-agent when that applies.
   */
  avatarDescription?: string;
  /** Takes the tab off the strip. The chat itself is untouched. */
  onDismiss?: () => void;
}

/** Tab-shaped stand-in while the project's chats have not arrived yet. */
export function ChatSessionTabSkeleton() {
  return (
    <div
      className="chat-session-tab flex h-9 w-[160px] max-w-[160px] shrink-0 items-center px-2 pt-[2px] pb-1"
      aria-hidden
    >
      <ShimmerLoader rows={1} className="w-full gap-0" rowClassName="h-3" />
    </div>
  );
}

/**
 * One session in the tab strip above a project's transcript (Figma SessionTab).
 * Caps at 160×36. Type is an 18px glyph; origin is OriginSessionBadge after the
 * title, replaced by close on hover/focus/press. Running shimmers the title
 * and the type icon. Width stays that of the rest layout: the title
 * truncates instead of the tab growing toward max-width.
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
  const originKind = originKindFromOrigin(origin);
  const showClose = Boolean(onDismiss) && !disabled;
  const titleClass = running ? "text-shimmer-basic" : "text-basic-primary";

  const identity = (
    <>
      <Tooltip
        title={title}
        description={avatarDescription ?? badgeLabel}
        position={Tooltip.Position.BottomCenter}
        sticky
        className="shrink-0"
      >
        <Icon
          iconName={sessionTypeIconName(sessionType)}
          size={16}
          className="shrink-0"
          color={running ? undefined : "var(--color-fill-basic-primary)"}
          shimmer={running}
        />
      </Tooltip>
      <span
        className={cn(
          "label-micro min-w-0 flex-1 truncate text-left",
          titleClass,
        )}
      >
        {title}
      </span>
    </>
  );

  return (
    <div
      className={cn(
        "chat-session-tab group relative inline-flex h-[44px] max-w-[160px] min-w-0 shrink-0 items-center overflow-hidden rounded-tl-[4px] rounded-tr-[4px]",
        "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-[var(--blue-500)]",
        disabled
          ? "bg-btn-ghost"
          : active
            ? "chat-session-tab-active bg-btn-ghost-highlighted-hovered hover:bg-btn-ghost-highlighted-hovered active:bg-btn-ghost-highlighted-pressed"
            : "bg-btn-ghost hover:bg-btn-ghost-hovered active:bg-btn-ghost-pressed",
        className,
      )}
    >
      {showClose ? (
        <div
          className="invisible pointer-events-none flex h-full min-w-0 items-center gap-1 overflow-hidden pt-[2px] pb-1 pl-2 pr-4"
          aria-hidden
        >
          <span className="size-[18px] shrink-0" />
          <span className="label-micro whitespace-nowrap">{title}</span>
          {originKind ? <span className="size-4 shrink-0" /> : null}
        </div>
      ) : null}
      <button
        type={type}
        disabled={disabled}
        aria-label={
          ariaLabel ?? (badgeLabel ? `${title}, ${badgeLabel}` : title)
        }
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-full min-w-0 items-center gap-1 pt-[2px] pb-1 pl-2 focus-visible:outline-none",
          showClose
            ? "absolute inset-0 w-full pr-4 group-hover:pr-10 group-has-[:focus-visible]:pr-10 group-active:pr-10"
            : "pr-4",
        )}
        {...props}
      >
        {identity}
        {originKind ? (
          <OriginSessionBadge
            kind={originKind}
            className={cn(
              disabled && "opacity-50",
              showClose &&
                "group-hover:hidden group-has-[:focus-visible]:hidden group-active:hidden",
            )}
          />
        ) : null}
      </button>
      {showClose ? (
        <Button
          variant={ButtonVariant.Ghost}
          size={ButtonSize.Small}
          content={ButtonContent.Icon}
          disabled={disabled}
          aria-label={`Close ${title}`}
          title="Close tab"
          onClick={(event) => {
            event.stopPropagation();
            onDismiss?.();
          }}
          className="absolute top-[9px] right-2 z-10 shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-has-[:focus-visible]:opacity-100 group-has-[:focus-visible]:pointer-events-auto group-active:opacity-100 group-active:pointer-events-auto"
        >
          <Icon iconName={IconName.Close} size={16} />
        </Button>
      ) : null}
    </div>
  );
};

export default ChatSessionTab;
