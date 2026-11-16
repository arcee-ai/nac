import type { ReactNode } from "react";

import StatusDot from "@/app/atoms/status-dot";
import { cn } from "@/app/lib/cn";
import type { TraditionalChildStatus } from "@/app/types/api";

import { subagentDotStatus } from "./subagentRowModel";

/**
 * A quiet row of the Subagents list: the status dot, the session's title,
 * one muted line of state and how long ago it last changed. The opening
 * button is named by the title alone; the state line describes it. Pin and
 * rename sit beside it, revealed on hover where there is hover.
 */
export function SubagentListRow({
  title,
  status,
  stateLine,
  age,
  active,
  isMobile,
  actions,
  onClick,
}: {
  title: string;
  status: TraditionalChildStatus;
  stateLine: string;
  age: string;
  active: boolean;
  isMobile: boolean;
  actions?: ReactNode;
  onClick: () => void;
}) {
  const running = status === "running";
  return (
    <div className="@container min-w-0">
      <div
        className={cn(
          "group/subagent-row relative isolate flex min-w-0 items-center rounded-md",
          // Very narrow lists (a 195px zoomed phone) move the actions under the title.
          "@max-[280px]:flex-wrap",
          "transition-colors duration-150 ease-out",
          "-outline-offset-2 outline-[var(--color-border-focus-outline)] has-[>button:focus-visible]:outline-2",
          isMobile ? "min-h-14 gap-3 px-3" : "min-h-11 gap-2.5 px-2.5",
          active ? "bg-[var(--f-wash-2)]" : "hover:bg-[var(--f-wash-1)]",
        )}
      >
        <button
          type="button"
          aria-label={title}
          aria-description={stateLine}
          aria-current={active ? "true" : undefined}
          onClick={onClick}
          className={cn(
            "flex min-w-0 flex-1 items-start gap-2.5 py-2 text-left outline-none",
            "after:absolute after:inset-0 after:-z-10 after:rounded-md",
          )}
        >
          <StatusDot status={subagentDotStatus(status)} size="md" className="mt-1.5" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-baseline gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  isMobile ? "type-subheading font-medium" : "type-label",
                  active
                    ? "text-basic-primary"
                    : "text-basic-secondary group-hover/subagent-row:text-basic-primary",
                )}
              >
                {title}
              </span>
              {age ? (
                <span className="shrink-0 type-meta tabular text-basic-muted @max-[280px]:hidden">
                  {age}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "min-w-0 truncate type-meta",
                running ? "focus-shimmer text-basic-tertiary" : "text-basic-tertiary",
              )}
            >
              {stateLine}
            </span>
          </span>
        </button>
        {actions ? (
          <span
            className={cn(
              "relative flex shrink-0 items-center @max-[280px]:w-full @max-[280px]:justify-end",
              !isMobile &&
                "opacity-0 transition-opacity duration-150 ease-out group-hover/subagent-row:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
            )}
          >
            {actions}
          </span>
        ) : null}
      </div>
    </div>
  );
}
