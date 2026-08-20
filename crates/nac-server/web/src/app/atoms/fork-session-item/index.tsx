import type React from "react";

import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";

interface ForkSessionItemProps {
  /** Fork session id, shown shortened under the title. */
  sessionId: string;
  title?: string | null;
  deleted?: boolean;
  /** Opens the live fork. Ignored when the fork session is gone. */
  onOpen?: () => void;
  /** Removes a deleted-state marker from the original chat. */
  onDismiss?: () => void;
}

function shortSessionId(sessionId: string): string {
  return sessionId.replace(/-/g, "").slice(0, 12);
}

/**
 * Marker under a model turn on the chat that was forked from. Live rows open
 * the fork; a deleted row stays until the user dismisses it.
 */
const ForkSessionItem: React.FC<ForkSessionItemProps> = ({
  sessionId,
  title,
  deleted = false,
  onOpen,
  onDismiss,
}) => {
  const label = deleted ? "No fork found" : title?.trim() || "Fork";
  const idLabel = `ID: ${shortSessionId(sessionId)}`;

  if (deleted) {
    return (
      <div
        className={cn(
          "flex items-start gap-4 w-full min-w-0 pl-4 pr-2 py-4 rounded-r-[4px] max-w-[540px]",
          "border-l-2 border-tertiary bg-elevation-sublevel-variant-A text-basic-tertiary",
        )}
      >
        <div className="flex flex-col gap-2 items-start min-w-0">
          <div className="flex gap-1.5 items-start min-w-0">
            <Icon iconName={IconName.Scheme} size={20} className="shrink-0" />
            <span className="header-micro">{label}</span>
            {onDismiss ? (
              <button
                type="button"
                title="Dismiss"
                aria-label="Dismiss deleted fork"
                onClick={onDismiss}
                className="shrink-0 inline-flex"
              >
                <Icon iconName={IconName.Close} size={20} />
              </button>
            ) : (
              <Icon iconName={IconName.Close} size={20} className="shrink-0" />
            )}
          </div>
          <span className="code-micro opacity-75 whitespace-nowrap">
            {idLabel}
          </span>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex items-start gap-4 w-full min-w-0 pl-4 pr-2 py-4 rounded-r-[4px] text-left max-w-[540px]",
        "border-l-2 border-accent-primary bg-btn-ghost-accent-highlighted text-btn-accent",
        "hover:bg-btn-ghost-accent-highlighted-hovered",
        "active:bg-btn-ghost-accent-highlighted-pressed",
      )}
    >
      <div className="flex flex-col gap-2 items-start min-w-0">
        <div className="flex gap-1.5 items-start min-w-0">
          <Icon iconName={IconName.Scheme} size={20} className="shrink-0" />
          <span className="header-micro">{label}</span>
          <Icon iconName={IconName.Right} size={20} className="shrink-0" />
        </div>
        <span className="code code-micro opacity-75 whitespace-nowrap">
          {idLabel}
        </span>
      </div>
    </button>
  );
};

export default ForkSessionItem;
