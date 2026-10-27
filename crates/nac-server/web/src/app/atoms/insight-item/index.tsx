import type React from "react";
import { useId } from "react";

import { useIsMobile } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/cn";
import { ButtonSize, ButtonVariant } from "../button";
import CopyButton from "../button/CopyButton";
import Icon, { IconName } from "../icon";
import Loader, { LoaderSize } from "../loader";
import { TooltipPosition } from "../tooltip";

export { default as InsightCodeBox } from "./InsightCodeBox";
export {
  default as InsightItemCodeDisplayer,
  InsightItemCodeDisplayerState,
} from "./InsightItemCodeDisplayer";
export { default as InsightLinkButton } from "./InsightLinkButton";
export { default as InsightShowFullButton } from "./InsightShowFullButton";

export enum InsightItemState {
  Default = "default",
  Loading = "loading",
  Error = "error",
}

interface InsightItemProps {
  /** Scroll-into-view anchor. */
  id?: string;
  icon: IconName;
  /** Loading appends the ellipsis, so pass the bare loading title ("Thinking"). */
  title: string;
  state?: InsightItemState;
  /** Highlights the item a list row points at; the layout does not move. */
  active?: boolean;
  /** What the header's copy button puts on the clipboard. Default state only. */
  copyText?: string | null;
  /** Shown under the body in the Error state, keeping its line breaks. */
  errorMessage?: string | null;
  /** Under the error message, e.g. an `InsightShowFullButton` for a cut message. */
  errorAction?: React.ReactNode;
  /**
   * The type's body, rendered straight into the item's 16px-gap column in every
   * state: the type decides what stays visible while loading or after a
   * failure (a session link, the input box).
   */
  children?: React.ReactNode;
}

/**
 * One step in the Insights detail column: a header with the type icon, the
 * title and a copy button, then the type's own body. Loading swaps the icon
 * for the spinner and shimmers the title; Error swaps it for the error-tone
 * Close and appends the message and its action. Neither offers copy. Body
 * text defaults to the design's 12px tertiary text; code boxes and links
 * bring their own.
 * Each item draws its own bottom divider inside its 24px bottom padding, as
 * the design does, so a stack of items needs no gap or separators.
 */
const InsightItem: React.FC<InsightItemProps> = ({
  id,
  icon,
  title,
  state = InsightItemState.Default,
  active = false,
  copyText,
  errorMessage,
  errorAction,
  children,
}) => {
  const isMobile = useIsMobile();
  const titleId = useId();
  const loading = state === InsightItemState.Loading;
  const failed = state === InsightItemState.Error;

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={titleId}
      aria-current={active || undefined}
      className={cn(
        "flex flex-col gap-4 border-b border-muted px-4 pt-6 pb-[23px] text-micro text-basic-tertiary",
        active && "bg-elevation-level-1",
      )}
    >
      <div className="flex w-full items-start gap-2 py-1">
        {loading ? (
          <Loader size={LoaderSize.Small} aria-hidden className="shrink-0" />
        ) : (
          <Icon
            iconName={failed ? IconName.Close : icon}
            size={20}
            aria-hidden
            className={cn(
              "shrink-0",
              failed ? "[&>path]:fill-error-primary" : "[&>path]:fill-basic-primary",
            )}
          />
        )}
        <span
          id={titleId}
          className={cn(
            "flex-1 min-w-0 break-words label-small",
            loading ? "text-shimmer-basic motion-reduce:animate-none" : "text-basic-primary",
          )}
        >
          {loading ? `${title}…` : title}
        </span>
        {copyText && state === InsightItemState.Default ? (
          <CopyButton
            value={copyText}
            title={`Copy ${title}`}
            size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
            variant={isMobile ? ButtonVariant.Ghost : ButtonVariant.Tertiary}
            position={TooltipPosition.BottomLeft}
            className="md:!h-4 md:!min-h-4 md:!p-0"
          />
        ) : null}
      </div>
      {children}
      {failed && errorMessage ? (
        <div className="flex flex-col gap-2">
          <p className="whitespace-pre-wrap break-words text-small text-error-primary">
            {errorMessage}
          </p>
          {errorAction}
        </div>
      ) : null}
    </div>
  );
};

export default InsightItem;
