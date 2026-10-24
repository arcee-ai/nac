import type React from "react";
import { useId } from "react";

import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import CopyButton from "../button/CopyButton";
import Icon, { IconName } from "../icon";
import Loader, { LoaderSize } from "../loader";

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
  /** Shown in Default and Loading. */
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
 * The design's mono is 12/16 without tracking. `.code` sets a 1.5 line height
 * and tracking in unlayered CSS, which only `!` utilities outrank.
 */
const CONTENT_TYPE =
  "code code-small font-medium !leading-4 !tracking-normal whitespace-pre-wrap break-words";

/**
 * A tool call's input or output inside an `InsightItem`, behind a 2px muted
 * rule. The caller owns the state and the full content: "Show full" asks for
 * it, Loading keeps the preview on screen with the link disabled, and Expanded
 * shows the full content with "Hide" and a copy button. Long lines wrap, so
 * the detail column stays the only scroller.
 *
 * The link is one button through every state, so focus stays on it while the
 * content loads; it is disabled with `aria-disabled` for that reason.
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
      className="flex w-full min-w-0 flex-col gap-2 border-l-2 border-muted pl-4"
    >
      {showHeading ? (
        <p id={headingId} className="break-words text-micro font-semibold text-basic-primary">
          {title}
        </p>
      ) : null}
      <div
        id={contentId}
        aria-busy={loading || undefined}
        className={cn(
          CONTENT_TYPE,
          loading ? "text-shimmer-basic motion-reduce:animate-none" : "text-basic-tertiary",
        )}
      >
        {content}
      </div>
      {error && state === InsightItemCodeDisplayerState.Default ? (
        <p role="alert" className="break-words text-micro text-error-primary">
          {error}
        </p>
      ) : null}
      {note && expanded ? <p className="break-words text-micro text-basic-muted">{note}</p> : null}
      {showsToggle || expanded ? (
        <div className="flex w-full items-start gap-4">
          {showsToggle ? (
            <Button
              size={ButtonSize.Small}
              variant={ButtonVariant.Tertiary}
              content={ButtonContent.IconRight}
              aria-expanded={expanded}
              aria-controls={contentId}
              aria-disabled={loading || undefined}
              className={cn(loading && "btn-disabled")}
              onClick={loading ? undefined : onToggle}
            >
              <span className="underline">{expanded ? "Hide" : "Show full"}</span>
              {loading ? (
                <Loader size={LoaderSize.XSmall} aria-hidden />
              ) : (
                <Icon iconName={expanded ? IconName.Top : IconName.Down} size={16} aria-hidden />
              )}
            </Button>
          ) : null}
          {expanded ? <CopyButton value={content} title={`Copy ${title}`} /> : null}
        </div>
      ) : null}
    </div>
  );
};

export default InsightItemCodeDisplayer;
