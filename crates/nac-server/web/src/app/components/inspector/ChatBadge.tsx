import { useState, type ReactNode } from "react";

import { Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

interface ChatBadgeProps {
  label: string;
  /** Shimmers the label while the step the badge stands for is still running. */
  pending?: boolean;
  /** Rendered after the label, e.g. the diff counts of a snapshot. */
  trailing?: ReactNode;
  /** When given, the badge becomes a disclosure for this body. */
  body?: string;
  onClick?: () => void;
}

/**
 * The inline marker the model message uses for its non-prose steps: reasoning,
 * a saved workset, a snapshot. Only reasoning has a body to expand.
 */
export function ChatBadge({
  label,
  pending = false,
  trailing,
  body,
  onClick,
}: ChatBadgeProps) {
  const [open, setOpen] = useState(false);
  const collapsible = Boolean(body);
  const interactive = collapsible || Boolean(onClick);

  return (
    <div className="flex flex-col items-start w-full">
      <button
        type="button"
        className={cn(
          "flex items-center py-2 rounded-[4px] max-w-full",
          collapsible ? "gap-[6px] pl-4 pr-2" : "gap-4 px-4",
          interactive ? "btn-ghost" : "cursor-default",
        )}
        disabled={!interactive}
        aria-expanded={collapsible ? open : undefined}
        onClick={() => {
          if (collapsible) setOpen((value) => !value);
          onClick?.();
        }}
      >
        <span
          className={cn(
            "label-small truncate",
            pending ? "text-shimmer-basic" : "text-btn-secondary",
          )}
        >
          {label}
        </span>
        {trailing}
        {collapsible ? (
          <Icon iconName={open ? IconName.Down : IconName.Right} size={20} />
        ) : null}
      </button>
      {collapsible && open ? (
        <p className="w-full pl-4 py-3 whitespace-pre-wrap text-basic-tertiary text-[12px] leading-[16px]">
          {body}
        </p>
      ) : null}
    </div>
  );
}

/** The `+n -m` pair the snapshot badge carries. */
export function CodeChangesBadge({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  return (
    <span className="flex items-center gap-2 shrink-0 code code-small">
      <span className="text-success-primary">+{additions}</span>
      <span className="text-error-primary">-{deletions}</span>
    </span>
  );
}
