import type React from "react";

import { cn } from "../../lib/cn";
import type { SessionBehavior, SessionLineage } from "../../types/api";
import ChatSessionLeadingMark from "../chat-session-fork-mark";
import ModelLoader, { ModelLoaderSize } from "../model-loader";
import SessionBehaviorIcon, { SessionBehaviorIconSize } from "../session-behavior-icon";

interface ChatSessionButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "title"
> {
  title: string;
  active?: boolean;
  /** Swaps the leading slot for the model loader and shimmers the title. */
  running?: boolean;
  /** Session type, drawn in the leading slot. */
  behavior?: SessionBehavior | null;
  /** A delegated session's relationship, which decides over its behavior. */
  lineage?: SessionLineage["kind"] | null;
  /** Figma `isNacEnable`: whether the behavior glyph is drawn at all. */
  showBehaviorIcon?: boolean;
  /** Full accessible and hover meaning of the behavior icon. */
  behaviorLabel?: string;
  /** Display title of the chat this session was forked from. */
  forkedFromTitle?: string | null;
  /** Compact text after the title, such as a status or a project. */
  badge?: string;
  /** Full accessible meaning of the compact badge. */
  badgeLabel?: string;
  /** Authoritative server activity is newer than the browser's viewed marker. */
  unread?: boolean;
  /** Taller touch target and always-visible actions for the mobile modal. */
  isMobile?: boolean;
  /** Pin, rename and delete controls, revealed on hover and on keyboard focus. */
  actions?: React.ReactNode;
}

/** Unlike the title, Figma leaves the glyph at rest on the selected row. */
const GLYPH_TONE =
  "[&_path]:fill-btn-secondary group-hover:[&_path]:fill-btn-secondary-hovered group-has-[>button:active]:[&_path]:fill-btn-secondary-pressed group-has-[>button:disabled]:[&_path]:fill-btn-secondary-disabled";

/**
 * One session as a list row.
 *
 * The leading slot holds the behavior glyph, or the model loader while the
 * session runs; the loader shows even where the glyph is hidden, and without
 * either the title starts at the padding. A fork adds the scheme mark after
 * the title.
 *
 * Press, focus and disabled styles key off the row button rather than the row,
 * so pressing or focusing an action neither presses the row nor rings it. The
 * actions live outside the button so they stay clickable. On desktop they
 * leave the layout until the row is hovered or focused from the keyboard, so
 * the title keeps the full row until then. They are visually hidden rather
 * than removed: focus leaves the row before it reaches the first action, and
 * a removed action could not take it.
 */
const ChatSessionButton: React.FC<ChatSessionButtonProps> = ({
  title,
  active = false,
  running = false,
  behavior,
  lineage,
  showBehaviorIcon = false,
  behaviorLabel,
  forkedFromTitle,
  badge,
  badgeLabel,
  unread = false,
  isMobile = false,
  actions,
  className = "",
  type = "button",
  "aria-label": ariaLabel,
  ...props
}) => {
  const nameParts = [title, behaviorLabel, badgeLabel].filter(Boolean);

  return (
    <div
      className={cn(
        "group flex items-center min-w-0 rounded-[4px]",
        "-outline-offset-2 outline-[var(--color-border-focus-outline)] has-[>button:focus-visible]:outline-2",
        isMobile ? "h-12 gap-3 py-2 pl-2.5 pr-3" : "h-9 gap-1.5 px-2 py-1",
        active
          ? "bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered has-[>button:active]:bg-btn-ghost-highlighted-pressed has-[>button:disabled]:bg-btn-ghost-highlighted-disabled"
          : "hover:bg-btn-ghost-hovered has-[>button:active]:bg-btn-ghost-pressed has-[>button:disabled]:bg-btn-ghost-disabled",
        className,
      )}
    >
      <button
        type={type}
        title={nameParts.join(" · ")}
        aria-label={ariaLabel ?? nameParts.join(", ")}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-1 items-center min-w-0 text-left outline-none",
          active
            ? "text-btn-secondary-pressed"
            : "text-btn-secondary group-hover:text-btn-secondary-hovered active:text-btn-secondary-pressed",
          "disabled:cursor-not-allowed disabled:text-btn-secondary-disabled",
          isMobile ? "gap-3" : "gap-1.5",
        )}
        {...props}
      >
        {running ? (
          <ModelLoader size={isMobile ? ModelLoaderSize.Large : ModelLoaderSize.Medium} />
        ) : showBehaviorIcon ? (
          <SessionBehaviorIcon
            behavior={behavior}
            lineage={lineage}
            size={isMobile ? SessionBehaviorIconSize.Large : SessionBehaviorIconSize.Medium}
            className={GLYPH_TONE}
          />
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            isMobile ? "label-medium" : "label-small",
            running && "text-shimmer-basic",
          )}
        >
          {title}
        </span>
        <ChatSessionLeadingMark
          forkedFromTitle={forkedFromTitle}
          className="[&_path]:fill-btn-secondary-disabled"
        />
        {badge ? (
          <span
            title={badgeLabel}
            className="tag-label max-w-[76px] shrink-0 truncate rounded bg-elevation-level-3 px-1 text-basic-tertiary"
          >
            {badge}
          </span>
        ) : null}
        {unread ? (
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-accent-primary"
            title="Updated since last viewed"
          >
            <span className="sr-only">Unread</span>
          </span>
        ) : null}
      </button>
      {actions ? (
        <div
          className={cn(
            "flex items-center gap-1 shrink-0",
            isMobile
              ? null
              : "sr-only group-hover:not-sr-only group-has-[:focus-visible]:not-sr-only focus-within:not-sr-only group-has-[>button:disabled]:hidden",
          )}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
};

export default ChatSessionButton;
