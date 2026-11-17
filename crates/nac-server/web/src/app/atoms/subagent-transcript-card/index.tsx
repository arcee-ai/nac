import type React from "react";
import { useId } from "react";

import { cn } from "../../lib/cn";
import { sessionBehaviorName } from "../../lib/sessionBehavior";
import type { SessionBehavior, SessionLineage } from "../../types/api";
import Icon, { IconName } from "../icon";

export enum SubagentCardStatus {
  Ready = "ready",
  Running = "running",
  /** Ready's layout with an error mark; `statusLabel` names the outcome. */
  Failed = "failed",
  /** The child session is gone, so the card stays static whatever it is given. */
  NotFound = "not-found",
}

interface SubagentTranscriptCardProps {
  title: string;
  status: SubagentCardStatus;
  /**
   * Outcome shown next to the footer link, such as "Failed" or "Cancelled". A
   * failed card's name ends with it, lowercased.
   */
  statusLabel?: string;
  /** Why a failed card's call did not go through, under the title. */
  error?: string | null;
  /** Session type, drawn in the header while the child is ready. */
  behavior?: SessionBehavior | null;
  /** A delegated session's relationship, which decides over its behavior. */
  lineage?: SessionLineage["kind"] | null;
  /** Figma `isNacEnable`: whether the behavior glyph is drawn at all. */
  showBehaviorIcon: boolean;
  /** Opens Subagents with this child selected. Without it the card is no button. */
  onOpen?: () => void;
  /** The child session route behind "Go to session". Without it there is no link. */
  sessionHref?: string | null;
  /** Follows "Go to session" in the caller's router instead of loading the href. */
  onSessionLinkClick?: React.MouseEventHandler<HTMLAnchorElement>;
  className?: string;
}

/**
 * The status ladder's dot for each card state, drawn as `StatusDot` draws it.
 * The card's own words carry the state, so the dot stays out of its text.
 */
const DOT: Record<SubagentCardStatus, string> = {
  [SubagentCardStatus.Ready]: "bg-[var(--f-green)]",
  [SubagentCardStatus.Running]: "bg-[var(--f-ink)] status-dot-pulse",
  [SubagentCardStatus.Failed]: "bg-[var(--f-red)]",
  [SubagentCardStatus.NotFound]: "bg-[var(--f-ink-5)] opacity-60",
};

/** What the state line says when the card is given no outcome of its own. */
const STATE_TEXT: Record<SubagentCardStatus, string> = {
  [SubagentCardStatus.Ready]: "Ready",
  [SubagentCardStatus.Running]: "Working…",
  [SubagentCardStatus.Failed]: "Failed",
  [SubagentCardStatus.NotFound]: "No session found",
};

const STATUS_NAME: Record<SubagentCardStatus, string | null> = {
  [SubagentCardStatus.Ready]: null,
  [SubagentCardStatus.Running]: "running",
  [SubagentCardStatus.Failed]: "failed",
  [SubagentCardStatus.NotFound]: null,
};

const LINK_CLASS = cn(
  "pointer-events-auto relative z-10 inline-flex h-7 shrink-0 items-center gap-0.5 rounded-pill pl-2.5 pr-1.5 type-meta-strong",
  "text-basic-secondary transition-colors duration-150 ease-out hover:bg-[var(--f-wash-2)] hover:text-basic-primary max-md:min-h-11",
  "outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus-outline)]",
);

/**
 * A child session in its parent's transcript: a small quiet card with the
 * status ladder's dot, the child's title, one line of state and a way to it.
 *
 * The card is a `div`, so no interactive element nests in another: a stretched
 * button opens the child in Subagents and the "Go to session" link sits above
 * it. The button lies under the content, which lets clicks through, so its
 * hover and press backgrounds stay behind the text. The card rings the
 * button's keyboard focus; the link rings its own, so the two Tab stops differ.
 */
const SubagentTranscriptCard: React.FC<SubagentTranscriptCardProps> = ({
  title,
  status,
  statusLabel,
  error,
  behavior,
  lineage,
  showBehaviorIcon,
  onOpen,
  sessionHref,
  onSessionLinkClick,
  className,
}) => {
  const errorId = useId();
  const notFound = status === SubagentCardStatus.NotFound;
  const openable = !notFound && onOpen != null;
  const href = notFound ? null : sessionHref || null;
  const label = notFound ? undefined : statusLabel;
  const reason = status === SubagentCardStatus.Failed ? error?.trim() || null : null;
  const statusName =
    status === SubagentCardStatus.Failed && label ? label.toLowerCase() : STATUS_NAME[status];
  // The glyph is decorative, so the name carries what it shows.
  const typeName =
    status === SubagentCardStatus.Ready && showBehaviorIcon
      ? sessionBehaviorName(behavior, lineage)
      : null;
  const openName = [`Open ${title} in Subagents`, typeName, statusName].filter(Boolean).join(", ");

  // The behavior glyph gave way to the status dot, so the type is in words here.
  const state = [typeName, label ?? STATE_TEXT[status]].filter(Boolean).join(" · ");

  return (
    <div
      title={notFound ? undefined : title}
      className={cn(
        "relative isolate flex w-[440px] max-w-full min-w-0 items-center gap-3 rounded-card border border-tertiary px-3.5 py-2.5",
        "bg-elevation-level-1 transition-colors duration-150 ease-out",
        openable && "hover:border-secondary",
        "has-[>button:focus-visible]:ring-2 has-[>button:focus-visible]:ring-[var(--color-border-focus-outline)]",
        className,
      )}
    >
      {openable ? (
        <button
          type="button"
          aria-label={openName}
          aria-describedby={reason ? errorId : undefined}
          onClick={onOpen}
          className="absolute inset-0 rounded-[inherit] outline-none hover:bg-[var(--f-wash-1)] active:bg-[var(--f-wash-2)]"
        />
      ) : null}
      <span aria-hidden className="relative flex size-4 shrink-0 items-center justify-center">
        <span className={cn("block size-2 rounded-pill", DOT[status])} />
      </span>
      <div
        className={cn("relative flex min-w-0 flex-1 flex-col", openable && "pointer-events-none")}
      >
        <span
          className={cn(
            "truncate type-label",
            notFound ? "text-basic-muted" : "text-basic-primary",
          )}
        >
          {notFound ? "Not found" : title}
        </span>
        <span
          title={reason ?? undefined}
          className={cn(
            "truncate type-meta",
            status === SubagentCardStatus.Failed ? "text-error-primary" : "text-basic-tertiary",
          )}
        >
          <span>{state}</span>
          {reason ? (
            <>
              <span aria-hidden> · </span>
              <span id={errorId}>{reason}</span>
            </>
          ) : null}
        </span>
      </div>
      {href ? (
        <a
          href={href}
          onClick={onSessionLinkClick}
          aria-label={`Go to session ${title}`}
          className={LINK_CLASS}
        >
          <span>Go to session</span>
          <Icon iconName={IconName.Right} size={14} aria-hidden className="shrink-0" />
        </a>
      ) : null}
    </div>
  );
};

export default SubagentTranscriptCard;
