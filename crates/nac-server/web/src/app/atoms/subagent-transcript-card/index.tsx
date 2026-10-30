import type React from "react";
import { useId } from "react";

import { cn } from "../../lib/cn";
import { sessionBehaviorName } from "../../lib/sessionBehavior";
import type { SessionBehavior, SessionLineage } from "../../types/api";
import Icon, { IconName } from "../icon";
import ModelLoader, { ModelLoaderSize } from "../model-loader";
import SessionBehaviorIcon, { SessionBehaviorIconSize } from "../session-behavior-icon";

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

const TITLE_TONE: Record<SubagentCardStatus, string> = {
  [SubagentCardStatus.Ready]: "text-basic-primary",
  [SubagentCardStatus.Running]: "text-shimmer-basic",
  [SubagentCardStatus.Failed]: "text-basic-primary",
  [SubagentCardStatus.NotFound]: "text-basic-muted",
};

const STATUS_NAME: Record<SubagentCardStatus, string | null> = {
  [SubagentCardStatus.Ready]: null,
  [SubagentCardStatus.Running]: "running",
  [SubagentCardStatus.Failed]: "failed",
  [SubagentCardStatus.NotFound]: null,
};

const LINK_CLASS = cn(
  "pointer-events-auto relative z-10 flex h-7 min-w-0 items-center gap-1 rounded-interaction p-1 label-micro",
  "text-btn-secondary hover:text-btn-secondary-hovered active:text-btn-secondary-pressed",
  "[&_.icon]:text-fill-btn-secondary hover:[&_.icon]:text-fill-btn-secondary-hovered active:[&_.icon]:text-fill-btn-secondary-pressed",
  "-outline-offset-2 outline-[var(--color-border-focus-outline)] focus-visible:outline-2",
);

function CardLeading({
  status,
  behavior,
  lineage,
  showBehaviorIcon,
}: Pick<SubagentTranscriptCardProps, "status" | "behavior" | "lineage" | "showBehaviorIcon">) {
  switch (status) {
    case SubagentCardStatus.Running:
      return <ModelLoader size={ModelLoaderSize.Medium} />;
    case SubagentCardStatus.Failed:
      return (
        <Icon
          iconName={IconName.Close}
          size={20}
          aria-hidden
          className="shrink-0 text-error-primary"
        />
      );
    case SubagentCardStatus.NotFound:
      return (
        <Icon
          iconName={IconName.Close}
          size={20}
          aria-hidden
          className="shrink-0 text-fill-btn-secondary-disabled"
        />
      );
    default:
      return showBehaviorIcon ? (
        <SessionBehaviorIcon
          behavior={behavior}
          lineage={lineage}
          size={SessionBehaviorIconSize.Medium}
          className="text-fill-btn-secondary"
        />
      ) : null;
  }
}

/**
 * A child session in its parent's transcript.
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

  return (
    <div
      title={notFound ? undefined : title}
      className={cn(
        "relative isolate flex w-[320px] max-w-full min-w-0 flex-col gap-4 rounded-[4px] p-3",
        "bg-elevation-level-1 shadow-convex",
        "-outline-offset-2 outline-[var(--color-border-focus-outline)] has-[>button:focus-visible]:outline-2",
        className,
      )}
    >
      {openable ? (
        <button
          type="button"
          aria-label={openName}
          aria-describedby={reason ? errorId : undefined}
          onClick={onOpen}
          className="absolute inset-0 rounded-[4px] outline-none hover:bg-btn-ghost-hovered active:bg-btn-ghost-pressed"
        />
      ) : null}
      <div
        className={cn(
          "relative flex min-w-0 items-start gap-2.5 p-1",
          openable && "pointer-events-none",
        )}
      >
        <CardLeading
          status={status}
          behavior={behavior}
          lineage={lineage}
          showBehaviorIcon={showBehaviorIcon}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn("truncate label-small", TITLE_TONE[status])}>
            {notFound ? "Not found" : title}
          </span>
          {reason ? (
            <p
              id={errorId}
              title={reason}
              className="line-clamp-3 text-xs break-words text-error-primary"
            >
              {reason}
            </p>
          ) : null}
        </div>
        {typeName && !openable ? <span className="sr-only">, {typeName}</span> : null}
      </div>
      {notFound ? (
        <div className="relative flex h-7 min-w-0 items-center justify-end p-1">
          <span className="truncate text-xs text-basic-muted">No session found</span>
        </div>
      ) : label || href ? (
        <div
          className={cn(
            "relative flex h-7 min-w-0 items-center justify-end gap-1",
            openable && "pointer-events-none",
          )}
        >
          {label ? (
            <span className="min-w-0 truncate px-1 text-xs text-basic-muted">{label}</span>
          ) : null}
          {href ? (
            <a
              href={href}
              onClick={onSessionLinkClick}
              aria-label={`Go to session ${title}`}
              className={LINK_CLASS}
            >
              <span className="truncate">Go to session</span>
              <Icon iconName={IconName.Right} size={16} aria-hidden className="shrink-0" />
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default SubagentTranscriptCard;
