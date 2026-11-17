import type React from "react";
import { useId } from "react";

import { cn } from "../../lib/cn";
import CopyButton from "../button/CopyButton";
import InsightShowFullButton from "./InsightShowFullButton";

export enum InsightItemCodeDisplayerState {
  Default = "default",
  Loading = "loading",
  Expanded = "expanded",
}

interface InsightItemCodeDisplayerProps {
  /** Names the field: the heading, the group and the copy button all use it. */
  title: string;
  /** Some types draw the field without its heading; the title still names it. */
  showHeading?: boolean;
  state?: InsightItemCodeDisplayerState;
  /** Shown in Default and Loading. Empty leaves the heading and the link. */
  shortContent: string;
  /** Shown, and copied, in Expanded. */
  fullContent?: string | null;
  /** "Show full" is offered only with a handler. */
  onShowFull?: () => void;
  /** "Hide" is offered only with a handler. */
  onHide?: () => void;
  /** Under the content in Default. "Show full" stays enabled, so it retries. */
  error?: string | null;
  /** Under the full content in Expanded, e.g. where the server cut it short. */
  note?: string | null;
}

/**
 * Focus mono at 12.5/20 without tracking. `.code` sets its own line height
 * and tracking in unlayered CSS, which only `!` utilities outrank.
 */
const CONTENT_TYPE =
  "code text-[length:var(--type-mono)] !leading-5 !tracking-normal whitespace-pre-wrap break-words";

/**
 * A tool call's input or output inside an `InsightItem`, on the code surface
 * in a hairline box. The caller owns the state and the full content: "Show full" asks for
 * it, Loading keeps the preview on screen with the link disabled, and Expanded
 * shows the full content with "Hide" and a copy button. Long lines wrap, so
 * the detail column stays the only scroller.
 */
const InsightItemCodeDisplayer: React.FC<InsightItemCodeDisplayerProps> = ({
  title,
  showHeading = true,
  state = InsightItemCodeDisplayerState.Default,
  shortContent,
  fullContent,
  onShowFull,
  onHide,
  error,
  note,
}) => {
  const headingId = useId();
  const contentId = useId();
  const loading = state === InsightItemCodeDisplayerState.Loading;
  const expanded = state === InsightItemCodeDisplayerState.Expanded;
  const content = expanded ? (fullContent ?? shortContent) : shortContent;
  const onToggle = expanded ? onHide : onShowFull;
  const showsToggle = loading || onToggle !== undefined;

  return (
    <div
      role="group"
      aria-labelledby={showHeading ? headingId : undefined}
      aria-label={showHeading ? undefined : title}
      className="flex w-full min-w-0 flex-col gap-1.5"
    >
      {showHeading ? (
        <p id={headingId} className="break-words type-meta text-basic-tertiary">
          {title}
        </p>
      ) : null}
      <div
        id={contentId}
        aria-busy={loading || undefined}
        className={cn(
          CONTENT_TYPE,
          "empty:hidden rounded-lg border border-tertiary bg-[var(--color-code-bg)] px-3 py-2",
          loading ? "text-shimmer-basic motion-reduce:animate-none" : "text-basic-secondary",
        )}
      >
        {content}
      </div>
      {error && state === InsightItemCodeDisplayerState.Default ? (
        <p role="alert" className="break-words type-meta text-error-primary">
          {error}
        </p>
      ) : null}
      {note && expanded ? <p className="break-words type-meta text-basic-muted">{note}</p> : null}
      {showsToggle || expanded ? (
        <div className="flex w-full items-start gap-4">
          {showsToggle ? (
            <InsightShowFullButton
              expanded={expanded}
              loading={loading}
              controls={contentId}
              onClick={onToggle}
            />
          ) : null}
          {expanded ? <CopyButton value={content} title={`Copy ${title}`} /> : null}
        </div>
      ) : null}
    </div>
  );
};

export default InsightItemCodeDisplayer;
