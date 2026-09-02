import type React from "react";

import { cn } from "../../lib/cn";
import Icon from "../icon";
import OriginSessionBadge, { originKindFromOrigin } from "../origin-session-badge";
import { SessionOrigin, SessionType, sessionTypeIconName } from "../session-type-avatar";

interface ChatSessionButtonProps extends Omit<
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
  /** Taller touch target and always-visible actions for the mobile modal. */
  isMobile?: boolean;
  /** Pin / rename / delete. Desktop reveals them on hover, focus and press. */
  actions?: React.ReactNode;
}

/**
 * One session as a list row (Figma ChatSessionButton), used by the chat
 * popover and the mobile modal. Type is a 20px glyph; origin sits after the
 * title as OriginSessionBadge. Running shimmers the title and the type icon.
 * Desktop actions
 * are out of flow until hover so the title can use the full row.
 */
const ChatSessionButton: React.FC<ChatSessionButtonProps> = ({
  title,
  active = false,
  running = false,
  sessionType = SessionType.Agent,
  origin = SessionOrigin.User,
  badgeLabel,
  isMobile = false,
  actions,
  className = "",
  type = "button",
  disabled = false,
  "aria-label": ariaLabel,
  ...props
}) => {
  const originKind = originKindFromOrigin(origin);
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
        "group relative flex min-w-0 items-center rounded-[4px]",
        "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-[var(--blue-500)]",
        isMobile ? "h-12 gap-3 py-2 pr-3 pl-[10px]" : "h-9 gap-1 py-1 pr-2 pl-2",
        disabled
          ? "bg-btn-ghost"
          : active
            ? "bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered active:bg-btn-ghost-highlighted-pressed"
            : "bg-btn-ghost hover:bg-btn-ghost-hovered active:bg-btn-ghost-pressed",
        className,
      )}
    >
      <button
        type={type}
        disabled={disabled}
        title={badgeLabel ? `${title} · ${badgeLabel}` : title}
        aria-label={ariaLabel ?? (badgeLabel ? `${title}, ${badgeLabel}` : title)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center text-left focus-visible:outline-none",
          isMobile ? "gap-3" : "gap-1",
        )}
        {...props}
      >
        <Icon
          iconName={sessionTypeIconName(sessionType)}
          size={16}
          className="shrink-0"
          color={running ? undefined : "var(--color-fill-basic-secondary)"}
          shimmer={running}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            isMobile ? "label-medium" : "label-small",
            titleClass,
          )}
        >
          {title}
        </span>
        {originKind ? (
          <OriginSessionBadge kind={originKind} className={disabled ? "opacity-50" : undefined} />
        ) : null}
      </button>
      {actions && !disabled ? (
        <div
          className={cn(
            "flex shrink-0 items-center",
            isMobile
              ? "gap-3"
              : "hidden gap-1.5 group-hover:flex group-has-[:focus-visible]:flex group-active:flex",
          )}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
};

export default ChatSessionButton;
