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
 * selects the spawn in Back Chat; stop / pause / open live on hover.
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
      className={`${active ? "border-l-primary" : "border-l-tertiary"} my-8 pl-4 border-l-2`}
    >
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
          "group/spawn-card relative flex w-full max-w-[320px] flex-col overflow-clip rounded-[4px] bg-elevation-level-1 text-left shadow-convex outline-none [&>*]:shrink-0",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--blue-500)]",
          missing || inert ? "cursor-default" : "cursor-pointer",
          className,
        )}
      >
        <div className="flex h-11 w-full shrink-0 items-center gap-[10px] px-2">
          {missing ? (
            <span className="flex size-7 shrink-0 items-center justify-center">
              <Icon
                iconName={IconName.Close}
                size={20}
                color="var(--color-fill-basic-muted)"
              />
            </span>
          ) : (
            <SessionTypeAvatar
              className="size-7 shrink-0"
              sessionType={sessionType}
              running={running}
            />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate label-small leading-5",
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
                "flex-none",
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
          <div className="flex w-full shrink-0 flex-col px-2 pb-2">
            {peek.map((line, index) => {
              const fade =
                LINE_OPACITY[LINE_OPACITY.length - peek.length + index] ??
                "opacity-100";
              return (
                <div
                  key={`${index}:${line}`}
                  className={cn(
                    "h-4 w-full truncate text-basic-tertiary !text-[12px] !leading-4",
                    fade,
                  )}
                >
                  {line}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ChildSessionBadge;
