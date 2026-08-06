import { useState, type ReactNode } from "react";

import { DropdownContent, Icon, IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { Markdown } from "@/app/lib/markdown";
import { perfRender } from "@/app/lib/perfDebug";

/** How tall a body that is still being written may get before it scrolls. */
const LIVE_BODY_MAX_HEIGHT = 240;

interface ChatBadgeProps {
  label: string;
  /** Shimmers the label while the step the badge stands for is still running. */
  pending?: boolean;
  /** Highlighted when the matching side-panel tab is selected (e.g. a workset). */
  active?: boolean;
  /** Rendered after the label, e.g. the diff counts of a snapshot. */
  trailing?: ReactNode;
  /**
   * Rendered above the label, inside the same rule, e.g. the files a snapshot
   * touched. Unlike `body` it is always visible and is not a disclosure.
   */
  preface?: ReactNode;
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
  active = false,
  trailing,
  preface,
  body,
  onClick,
}: ChatBadgeProps) {
  perfRender("ChatBadge");
  const [open, setOpen] = useState(false);
  const collapsible = Boolean(body);
  const interactive = collapsible || Boolean(onClick);
  const highlighted = open || active;

  return (
    <div
      className={cn(
        "flex flex-col items-start w-full my-6 border-l-2 border-solid transition-colors duration-200",
        highlighted ? "border-primary" : "border-tertiary",
      )}
    >
      {preface}
      <button
        type="button"
        className={cn(
          "group flex items-center py-2 rounded-[4px] max-w-full",
          collapsible ? "gap-[6px] pl-4 pr-2" : "gap-4 px-4",
          !interactive
            ? "cursor-default"
            : highlighted
              ? "btn-ghost-highlighted"
              : "btn-ghost",
        )}
        disabled={!interactive}
        aria-expanded={collapsible ? open : undefined}
        aria-pressed={active || undefined}
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
          <Icon
            iconName={open ? IconName.Down : IconName.Right}
            size={20}
            className={cn(
              "shrink-0",
              open
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
            )}
          />
        ) : null}
      </button>
      {collapsible && body ? (
        // A body that is still being written follows itself, so an expanded
        // badge tails the stream instead of growing down the page.
        <DropdownContent
          isOpen={open}
          className="w-full"
          isScrollable={pending}
          scrollToBottom={pending}
          style={pending ? { maxHeight: LIVE_BODY_MAX_HEIGHT } : undefined}
        >
          <div className="thinking-content w-full pl-4 py-3">
            <Markdown className="text-basic-tertiary" streaming={pending}>
              {body}
            </Markdown>
          </div>
        </DropdownContent>
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
