import { useRef, useState } from "react";

import { Icon, IconName, StatusDot } from "@/app/atoms";
import { useSessionNameDisclosure } from "@/app/atoms/session-name-disclosure";
import { cn } from "@/app/lib/cn";
import type { SessionStatus } from "@/app/lib/sessionStatus";

import { compactAge, longAge } from "./relativeTime";
import { SessionRowMenu } from "./SessionRowMenu";

/** Indent per nesting level, so subagents sit under their parent's title. */
const INDENT = 14;

/**
 * Fine pointers: the age and the "⋯" trigger share one slot at the row's end.
 * Hover or keyboard focus on the row swaps the age for the trigger, which stays
 * focusable while transparent so Tab reaches it. Without hover (touch), the
 * narrow sidebar gives the age's place to an always-shown 44px trigger; the
 * full-width phone menu (`touch`) has room for both.
 */
const SLOT = "grid items-center justify-items-end [&>*]:[grid-area:1/1]";
const AGE_SWAP =
  "group-hover/row:opacity-0 group-has-[:focus-visible]/row:opacity-0 [@media(hover:none)]:hidden";
const TRIGGER_REVEAL =
  "opacity-0 group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100 [@media(hover:none)]:opacity-100";
const FADE = "transition-opacity duration-150 ease-out motion-reduce:transition-none";

export interface SessionRowProps {
  title: string;
  /** Accessible name of the row button (title, plus the behavior when shown). */
  label: string;
  status: SessionStatus;
  updatedAt: string;
  now: number;
  active: boolean;
  depth?: number;
  pinned?: boolean;
  /** Direct children; zero hides the subagent toggle. */
  childCount?: number;
  expanded?: boolean;
  onToggleChildren?: () => void;
  /** Phone menu rows: 44px targets and an always-visible "⋯". */
  touch?: boolean;
  onOpen: () => void;
  onPin?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onAssign?: () => void;
}

/**
 * One 32px session row: status dot, title, tabular age. Its actions live in one
 * "⋯" menu that takes the age's place on hover or keyboard focus, and stays
 * visible on touch. The title button stretches over the whole row; the
 * controls sit above it.
 */
export function SessionRow({
  title,
  label,
  status,
  updatedAt,
  now,
  active,
  depth = 0,
  pinned = false,
  childCount = 0,
  expanded = false,
  onToggleChildren,
  touch = false,
  onOpen,
  onPin,
  onRename,
  onDelete,
  onAssign,
}: SessionRowProps) {
  const age = compactAge(updatedAt, now);
  const [menuOpen, setMenuOpen] = useState(false);
  // Long titles truncate; the full name stays one hover step (desktop hint)
  // or one menu item away. The hint only speaks for a title that is actually
  // cut off: each hover or focus starts as "maybe truncated" and measures.
  const disclosure = useSessionNameDisclosure(title);
  const titleRef = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(true);
  const measure = () => {
    const node = titleRef.current;
    setTruncated(!!node && node.scrollWidth > node.clientWidth);
  };
  const forget = () => setTruncated(true);
  return (
    <div
      data-session-row
      className={cn(
        "group/row relative flex min-w-0 items-center gap-1 rounded-md pr-1",
        touch ? "min-h-11" : "h-8 [@media(hover:none)]:h-auto [@media(hover:none)]:min-h-11",
        active
          ? "bg-[var(--f-wash-2)]"
          : cn(
              "hover:bg-[var(--f-wash-1)] focus-within:bg-[var(--f-wash-1)]",
              menuOpen && "bg-[var(--f-wash-1)]",
            ),
        "transition-colors duration-150 ease-out motion-reduce:transition-none",
      )}
    >
      {disclosure.hint(
        <button
          type="button"
          aria-label={label}
          aria-current={active ? "page" : undefined}
          onClick={onOpen}
          onMouseEnter={measure}
          onFocus={measure}
          onMouseLeave={forget}
          onBlur={forget}
          className={cn(
            // Fills the row's height, so the button's own box is the hit area.
            "flex min-w-0 flex-1 items-center gap-2 self-stretch text-left outline-none",
            // Stretched hit area: the whole row opens the session.
            "after:absolute after:inset-0 after:rounded-md",
            "focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[var(--f-focus)]",
          )}
          style={{ paddingLeft: 10 + depth * INDENT }}
        >
          <span className="flex size-4 shrink-0 items-center justify-center">
            <StatusDot status={status} />
          </span>
          {pinned ? (
            <Icon iconName={IconName.Pin} size={12} className="shrink-0 text-basic-muted" />
          ) : null}
          <span
            ref={titleRef}
            className={cn(
              "min-w-0 flex-1 truncate",
              touch ? "type-body-chrome !text-md" : "type-body-chrome",
              active ? "font-medium text-basic-primary" : "text-basic-secondary",
              status === "working" && "focus-shimmer",
            )}
          >
            {title}
          </span>
        </button>,
        menuOpen || !truncated,
      )}
      {childCount > 0 && onToggleChildren ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} ${childCount} ${childCount === 1 ? "subagent" : "subagents"} of ${title}`}
          onClick={onToggleChildren}
          className={cn(
            "type-tag tabular relative z-[1] inline-flex shrink-0 items-center gap-0.5 rounded-pill px-1.5",
            "h-5",
            // Touch keeps the pill's look and grows only its hit area to 44px.
            "before:absolute before:top-1/2 before:left-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2",
            touch ? "before:block" : "before:hidden [@media(hover:none)]:before:block",
            "bg-[var(--f-wash-1)] text-basic-tertiary hover:bg-[var(--f-wash-2)] hover:text-basic-primary",
          )}
        >
          {childCount}
          <Icon
            iconName={IconName.Right}
            size={10}
            className={cn(
              "transition-transform duration-150 ease-out motion-reduce:transition-none",
              expanded && "rotate-90",
            )}
          />
        </button>
      ) : null}
      <div className={cn("relative z-[1] shrink-0", touch ? "flex items-center gap-0.5" : SLOT)}>
        <span
          className={cn(
            "type-meta tabular pr-1 text-basic-muted",
            !touch && cn(FADE, AGE_SWAP, menuOpen && "opacity-0"),
          )}
          title={longAge(updatedAt)}
        >
          {age}
        </span>
        <SessionRowMenu
          title={title}
          pinned={pinned}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          touch={touch}
          className={touch ? undefined : cn(FADE, !menuOpen && TRIGGER_REVEAL)}
          onRename={onRename}
          onPin={onPin}
          onAssign={onAssign}
          onViewName={disclosure.view}
          onDelete={onDelete}
        />
      </div>
      {disclosure.overlay}
    </div>
  );
}
