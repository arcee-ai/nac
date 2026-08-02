import type { ReactNode } from "react";

import { cn } from "@/app/lib/cn";

/**
 * The shape all three side-box panels share: a narrow list of rows on the left
 * and the detail of whatever is selected on the right.
 */
export function PanelSplit({
  list,
  children,
}: {
  list: ReactNode;
  children: ReactNode;
}) {
  return (
    // The box can be half the window or the whole of it, so the list gives up
    // width to the detail once the panel itself gets narrow.
    <div className="@container flex flex-1 min-h-0 w-full">
      <div className="flex flex-col shrink-0 w-[208px] @max-[560px]:w-[148px] min-h-0 overflow-auto pt-4 px-1 border-r border-muted bg-elevation-level-1 [&>*]:shrink-0">
        {list}
      </div>
      <div className="flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-level-0-5">
        {children}
      </div>
    </div>
  );
}

/** Row of the left list, sized to the 24px tree row in the design. */
export function PanelRow({
  label,
  active = false,
  icon,
  trailing,
  labelClassName,
  title,
  onClick,
}: {
  label: string;
  active?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
  /** Overrides the label colour, e.g. to mark a file's git status. */
  labelClassName?: string;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-center gap-1 p-1 w-full rounded-[4px] text-left",
        active ? "btn-ghost-highlighted" : "btn-ghost",
      )}
      aria-pressed={active}
      title={title}
      onClick={onClick}
    >
      {icon}
      <span
        className={cn(
          "flex-1 min-w-0 truncate label-micro",
          labelClassName ?? "text-btn-secondary",
        )}
      >
        {label}
      </span>
      {trailing}
    </button>
  );
}

/** Placeholder for an empty or not-yet-selected panel. */
export function PanelEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center label-small text-basic-muted">
      {children}
    </div>
  );
}
