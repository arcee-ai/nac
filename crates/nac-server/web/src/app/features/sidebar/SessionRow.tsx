import { Icon, IconName, StatusDot } from "@/app/atoms";
import { ChatSessionActions } from "@/app/components/projects/ChatSessionActions";
import { cn } from "@/app/lib/cn";
import type { SessionStatus } from "@/app/lib/sessionStatus";

import { compactAge, longAge } from "./relativeTime";

/** Indent per nesting level, so subagents sit under their parent's title. */
const INDENT = 14;

/**
 * Fine pointers: the actions float over the row's end, transparent until the
 * row is hovered or holds focus (still focusable, so Tab reaches them).
 * Coarse pointers: always shown, in flow.
 */
const REVEAL = cn(
  "absolute inset-y-0 right-0 flex rounded-r-md pr-1 pl-4",
  "bg-elevation-level-0-5 [mask-image:linear-gradient(to_right,transparent,black_14px)]",
  "pointer-events-none opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none",
  "group-hover/row:pointer-events-auto group-hover/row:opacity-100",
  "group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100",
  "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:static [@media(hover:none)]:bg-transparent [@media(hover:none)]:p-0 [@media(hover:none)]:opacity-100 [@media(hover:none)]:[mask-image:none]",
);
/** Hidden while the actions above are shown. */
const CONCEAL = "[@media(hover:none)]:hidden";

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
  /** Phone menu rows: 44px targets and always-visible actions. */
  touch?: boolean;
  onOpen: () => void;
  onPin?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onAssign?: () => void;
}

/**
 * One 32px session row: status dot, title, tabular age. Row actions take the
 * age's place on hover or keyboard focus, and stay visible on coarse pointers.
 * The title button stretches over the whole row; the controls sit above it.
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
  return (
    <div
      data-session-row
      className={cn(
        "group/row relative flex min-w-0 items-center gap-1 rounded-md pr-1",
        touch ? "min-h-11" : "h-8",
        active
          ? "bg-[var(--f-wash-2)]"
          : "hover:bg-[var(--f-wash-1)] focus-within:bg-[var(--f-wash-1)]",
        "transition-colors duration-150 ease-out motion-reduce:transition-none",
      )}
    >
      <button
        type="button"
        aria-label={label}
        aria-current={active ? "page" : undefined}
        title={title}
        onClick={onOpen}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-2 text-left outline-none",
          // Stretched hit area: the whole row opens the session.
          "after:absolute after:inset-0 after:rounded-md",
          "focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[var(--f-ring)]",
        )}
        style={{ paddingLeft: 10 + depth * INDENT }}
      >
        <span className="flex size-3 shrink-0 items-center justify-center">
          <StatusDot status={status} />
        </span>
        {pinned ? (
          <Icon iconName={IconName.Pin} size={12} className="shrink-0 text-basic-muted" />
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            touch ? "type-body-chrome !text-md" : "type-body-chrome",
            active ? "font-medium text-basic-primary" : "text-basic-secondary",
            status === "working" && "focus-shimmer",
          )}
        >
          {title}
        </span>
      </button>
      {childCount > 0 && onToggleChildren ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} ${childCount} ${childCount === 1 ? "subagent" : "subagents"} of ${title}`}
          onClick={onToggleChildren}
          className={cn(
            "type-tag tabular relative z-[1] inline-flex shrink-0 items-center gap-0.5 rounded-pill px-1.5",
            touch ? "h-11 min-w-11 justify-center" : "h-5",
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
      {touch ? null : (
        <span
          className={cn("type-meta tabular relative shrink-0 pr-1 text-basic-muted", CONCEAL)}
          title={longAge(updatedAt)}
        >
          {age}
        </span>
      )}
      <div className={cn("z-[1] shrink-0 items-center gap-0.5", touch ? "relative flex" : REVEAL)}>
        {touch ? null : (
          <span
            aria-hidden
            className={cn(
              "absolute inset-0 -z-[1] rounded-r-md",
              active ? "bg-[var(--f-wash-2)]" : "bg-[var(--f-wash-1)]",
              "[@media(hover:none)]:hidden",
            )}
          />
        )}
        <ChatSessionActions
          title={title}
          pinned={pinned}
          isMobile={touch}
          onPin={onPin}
          onRename={onRename}
          onDelete={onDelete}
          onAssign={onAssign}
        />
      </div>
    </div>
  );
}
