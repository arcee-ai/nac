import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  CopyButton,
  Icon,
  IconName,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { perfRender } from "@/app/lib/perfDebug";

interface UserMessageProps {
  text: string;
  pending?: boolean;
  /** Shown on hover when the message has a known time. */
  timestamp?: string | null;
  /**
   * Answer this prompt again, discarding the reply it already produced. Only
   * for the user turn that produced the latest model reply — older turns keep
   * revert + copy only.
   */
  onRefresh?: (() => void) | null;
  /** Restore the session to the snapshot at this prompt. */
  onRevert?: (() => void) | null;
  /** Disable destructive / network actions while a run is in flight. */
  actionsDisabled?: boolean;
}

/** The prompt bubble. Pending ones are dimmed until the snapshot catches up. */
export function UserMessage({
  text,
  pending = false,
  timestamp = null,
  onRefresh = null,
  onRevert = null,
  actionsDisabled = false,
}: UserMessageProps) {
  perfRender("UserMessage");
  return (
    <div className="group/user-msg flex flex-col items-end w-full max-w-full pt-4 pb-8">
      <div
        className={cn(
          "py-3 px-5 rounded-[12px] bg-elevation-sublevel-variant-B shadow-convex",
          "label-small text-basic-primary whitespace-pre-wrap break-words",
          pending && "opacity-60",
        )}
      >
        {text}
      </div>

      {!pending ? (
        <div
          className={cn(
            "flex items-center justify-end gap-3 pt-1",
            // Keep the row hittable while moving from the bubble to the actions.
            "opacity-0 pointer-events-none transition-opacity duration-150",
            "group-hover/user-msg:opacity-100 group-hover/user-msg:pointer-events-auto",
            "group-focus-within/user-msg:opacity-100 group-focus-within/user-msg:pointer-events-auto",
          )}
        >
          {timestamp ? (
            <span className="label-micro text-basic-tertiary whitespace-nowrap truncate">
              {timestamp}
            </span>
          ) : null}

          {onRefresh ? (
            <Tooltip title="Resend" position={TooltipPosition.TopCenter}>
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Tertiary}
                content={ButtonContent.Icon}
                aria-label="Resend"
                disabled={actionsDisabled}
                onClick={onRefresh}
                className="!h-4 !min-h-4 !p-0"
              >
                <Icon iconName={IconName.Refresh} size={16} />
              </Button>
            </Tooltip>
          ) : null}

          {onRevert ? (
            <Tooltip
              title="Revert to this snapshot"
              position={TooltipPosition.TopCenter}
            >
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Tertiary}
                content={ButtonContent.Icon}
                aria-label="Revert to this snapshot"
                disabled={actionsDisabled}
                onClick={onRevert}
                className="!h-4 !min-h-4 !p-0"
              >
                <Icon iconName={IconName.TurnLeft} size={16} />
              </Button>
            </Tooltip>
          ) : (
            <Tooltip
              title="This message is not in the transcript yet"
              position={TooltipPosition.TopCenter}
            >
              <span className="inline-flex">
                <Button
                  size={ButtonSize.Small}
                  variant={ButtonVariant.Tertiary}
                  content={ButtonContent.Icon}
                  aria-label="Revert to this snapshot"
                  disabled
                  className="!h-4 !min-h-4 !p-0"
                >
                  <Icon iconName={IconName.TurnLeft} size={16} />
                </Button>
              </span>
            </Tooltip>
          )}

          <CopyButton
            value={text}
            size={ButtonSize.Small}
            variant={ButtonVariant.Tertiary}
            title="Copy message"
            position={TooltipPosition.TopCenter}
            className="!h-4 !min-h-4 !p-0"
          />
        </div>
      ) : null}
    </div>
  );
}
