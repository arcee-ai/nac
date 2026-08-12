import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  CopyButton,
  Icon,
  IconName,
  Tooltip,
  type TooltipPosition,
} from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

interface MessageActionsProps {
  tooltipPosition: TooltipPosition;
  messageIndex?: number;
  promptText: string;
  copyText: string;
  onRefresh?: ((messageIndex: number) => void) | null;
  onRevert?: ((messageIndex: number, text: string) => void) | null;
  disabled?: boolean;
}

const actionClassName = "md:!h-4 md:!min-h-4 md:!p-0";

/** Shared controls for user prompts and the model turns that answer them. */
export function MessageActions({
  tooltipPosition,
  messageIndex,
  promptText,
  copyText,
  onRefresh = null,
  onRevert = null,
  disabled = false,
}: MessageActionsProps) {
  const isMobile = useIsMobile();
  const size = isMobile ? ButtonSize.Medium : ButtonSize.Small;
  const variant = isMobile ? ButtonVariant.Ghost : ButtonVariant.Tertiary;
  const canRevert = onRevert != null && messageIndex != null;

  return (
    <>
      {onRefresh != null && messageIndex != null ? (
        <Tooltip title="Resend" position={tooltipPosition}>
          <Button
            size={size}
            variant={variant}
            content={ButtonContent.Icon}
            aria-label="Resend"
            disabled={disabled}
            onClick={() => onRefresh(messageIndex)}
            className={actionClassName}
          >
            <Icon iconName={IconName.Refresh} size={16} />
          </Button>
        </Tooltip>
      ) : null}

      <Tooltip
        title={
          canRevert
            ? "Revert to this snapshot"
            : "This message is not in the transcript yet"
        }
        position={tooltipPosition}
      >
        {canRevert ? (
          <Button
            size={size}
            variant={variant}
            content={ButtonContent.Icon}
            aria-label="Revert to this snapshot"
            disabled={disabled}
            onClick={() => onRevert(messageIndex, promptText)}
            className={actionClassName}
          >
            <Icon iconName={IconName.TurnLeft} size={16} />
          </Button>
        ) : (
          <span className="inline-flex">
            <Button
              size={size}
              variant={variant}
              content={ButtonContent.Icon}
              aria-label="Revert to this snapshot"
              disabled
              className={actionClassName}
            >
              <Icon iconName={IconName.TurnLeft} size={16} />
            </Button>
          </span>
        )}
      </Tooltip>

      <CopyButton
        value={copyText}
        size={size}
        variant={variant}
        title="Copy message"
        position={tooltipPosition}
        className={actionClassName}
      />
    </>
  );
}
