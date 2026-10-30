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

const CARD_CLASS =
  "flex w-fit max-w-[540px] min-w-0 items-start gap-4 rounded-interaction p-4 text-left";

const FOCUS_CLASS =
  "-outline-offset-2 outline-[var(--color-border-focus-outline)] focus-visible:outline-2";

function ForkCardContent({
  label,
  idLabel,
  deleted,
}: {
  label: string;
  idLabel: string;
  deleted: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon iconName={IconName.Scheme} size={20} aria-hidden className="shrink-0" />
      <div className="flex min-w-0 flex-col items-start gap-3 pr-1.5">
        <span className={cn("max-w-full truncate", deleted ? "header-sm" : "label-small")}>
          {label}
        </span>
        <span className="text-2xs whitespace-nowrap opacity-50">{idLabel}</span>
      </div>
    </div>
  );
}

/**
 * Marker under a model turn on the chat that was forked from. Live cards open
 * the fork; a deleted card stays until the user dismisses it.
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
      <div className={cn(CARD_CLASS, "bg-elevation-sublevel-variant-A text-basic-muted")}>
        <ForkCardContent label={label} idLabel={idLabel} deleted />
        {onDismiss ? (
          <button
            type="button"
            title="Dismiss"
            aria-label="Dismiss deleted fork"
            onClick={onDismiss}
            className={cn(
              "inline-flex shrink-0 rounded-interaction hover:text-basic-primary",
              FOCUS_CLASS,
            )}
          >
            <Icon iconName={IconName.Close} size={20} aria-hidden />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        CARD_CLASS,
        "bg-btn-ghost-accent-highlighted text-btn-accent",
        "hover:bg-btn-ghost-accent-highlighted-hovered",
        "active:bg-btn-ghost-accent-highlighted-pressed",
        FOCUS_CLASS,
      )}
    >
      <ForkCardContent label={label} idLabel={idLabel} deleted={false} />
    </button>
  );
};

export default ForkSessionItem;
