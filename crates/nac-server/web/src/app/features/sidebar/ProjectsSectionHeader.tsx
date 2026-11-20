import type { ReactNode } from "react";

import { Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

/** The "Projects" heading over the sidebar's project groups: folds the list and adds a project. */
export function ProjectsSectionHeader({
  expanded,
  touch = false,
  onToggle,
  children,
}: {
  expanded: boolean;
  touch?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-0.5 pr-1", touch ? "min-h-11" : "h-8")}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-1 rounded-md pl-2.5 text-left outline-none",
          "type-body-chrome text-basic-muted hover:text-basic-primary",
          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--f-focus)]",
        )}
      >
        Projects
        <Icon
          iconName={IconName.Down}
          size={12}
          className={cn(
            "shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none",
            !expanded && "-rotate-90",
          )}
        />
      </button>
      {children}
    </div>
  );
}
