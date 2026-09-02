import type React from "react";

import { cn } from "../../lib/cn";
import ChildSessionActionButtons from "../child-session-action-buttons";
import Icon, { IconName } from "../icon";
import SessionTypeAvatar, { SessionType } from "../session-type-avatar";

export type ChildSessionBadgeState = "ready" | "running" | "missing";

interface ChildSessionBadgeProps {
  title: string;
  lines?: readonly string[];
  sessionType?: `${SessionType}`;
  state?: ChildSessionBadgeState;
  active?: boolean;
  busy?: boolean;
  canOpen?: boolean;
  onSelect?: () => void;
  onPause?: () => void;
  onPlay?: () => void;
  onStop?: () => void;
  onOpen?: () => void;
  /** Visual copy in a preview transcript: no select, no controls. */
  inert?: boolean;
  className?: string;
}

const LINE_OPACITY = ["opacity-10", "opacity-30", "opacity-100"] as const;

/**
 * Spawned child peek in a parent transcript (Figma ChildSessionBadge). Click
 * selects the spawn in Actions; stop / pause / open live on hover.
 */
const ChildSessionBadge: React.FC<ChildSessionBadgeProps> = ({
  title,
  lines = [],
  sessionType = SessionType.Agent,
  state = "ready",
  active = false,
  busy = false,
  canOpen = true,
  onSelect,
  onPause,
  onPlay,
  onStop,
  onOpen,
  inert = false,
  className = "",
}) => {
  const missing = state === "missing";
  const running = state === "running";
  const peek = missing ? ["Chat deleted or unrelated"] : lines;

  const activate = () => {
    if (missing || inert) return;
    onSelect?.();
  };

  return (
    <div
      role={inert || missing ? undefined : "group"}
      tabIndex={inert || missing ? -1 : 0}
      aria-current={active && !inert ? "true" : undefined}
      aria-disabled={missing || undefined}
      aria-label={missing ? "No chat found" : title}
      onClick={inert ? undefined : activate}
      onKeyDown={
        inert
          ? undefined
          : (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activate();
              }
            }
      }
      className={cn(
        "group/spawn-card relative flex w-full max-w-[320px] bg-elevation-level-2 flex-col overflow-clip rounded-[4px] text-left shadow-convex",
        missing
          ? "cursor-default bg-btn-ghost"
          : running
            ? inert
              ? "bg-btn-ghost-highlighted"
              : "cursor-pointer bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered active:bg-btn-ghost-highlighted-pressed"
            : inert
              ? "bg-btn-ghost"
              : "cursor-pointer bg-btn-ghost hover:bg-btn-ghost-hovered active:bg-btn-ghost-pressed",
        active &&
          !inert &&
          "outline outline-2 outline-offset-0 outline-[var(--blue-500)]",
        className,
      )}
    >
      <div className="flex w-full items-center gap-[10px] p-2">
        {missing ? (
          <span className="flex size-7 shrink-0 items-center justify-center">
            <Icon
              iconName={IconName.Close}
              size={20}
              color="var(--color-fill-basic-muted)"
            />
          </span>
        ) : (
          <SessionTypeAvatar sessionType={sessionType} running={running} />
        )}
        <span
          className={cn(
            "min-w-0 flex-1 truncate label-small",
            missing
              ? "text-basic-muted"
              : running
                ? "text-shimmer-basic"
                : "text-basic-primary",
          )}
        >
          {missing ? "No chat found" : title}
        </span>
        {missing || inert ? null : (
          <ChildSessionActionButtons
            className={cn(
              "opacity-0 pointer-events-none transition-opacity",
              "group-hover/spawn-card:opacity-100 group-hover/spawn-card:pointer-events-auto",
              "group-focus-within/spawn-card:opacity-100 group-focus-within/spawn-card:pointer-events-auto",
              active && "opacity-100 pointer-events-auto",
            )}
            state={running ? "running" : "ready"}
            busy={busy}
            canOpen={canOpen}
            onPause={onPause}
            onPlay={onPlay}
            onStop={onStop}
            onOpen={onOpen}
          />
        )}
      </div>
      {peek.length ? (
        <div className="flex h-12 w-full flex-col items-start justify-end overflow-clip">
          <div className="flex w-full flex-col p-2 text-micro text-basic-tertiary">
            {peek.map((line, index) => {
              const fade =
                LINE_OPACITY[LINE_OPACITY.length - peek.length + index] ??
                "opacity-100";
              return (
                <p
                  key={`${index}:${line}`}
                  className={cn("w-full truncate", fade)}
                >
                  {line}
                </p>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ChildSessionBadge;
