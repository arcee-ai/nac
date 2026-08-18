import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { cn } from "@/app/lib/cn";

export type SshBadgeState = "connected" | "disconnected" | "reconnect";

/**
 * Compact SSH status label for the chat bar and settings header. Connected is
 * quiet cyan; a break shows the warning glyph, and reconnect adds a refresh.
 */
export function SshBadge({
  state,
  onReconnect,
  className,
}: {
  state: SshBadgeState;
  onReconnect?: () => void;
  className?: string;
}) {
  const broken = state !== "connected";
  return (
    <div className={cn("flex items-center h-4 shrink-0", broken ? "gap-1" : null, className)}>
      {broken ? <Icon iconName={IconName.Danger} size={16} className="text-error-primary" /> : null}
      <span
        className={cn("tag-label uppercase", broken ? "text-error-primary" : "text-info-primary")}
      >
        SSH
      </span>
      {state === "reconnect" && onReconnect ? (
        <Tooltip title="Reconnect SSH" position={TooltipPosition.TopCenter}>
          <Button
            size={ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            content={ButtonContent.Icon}
            aria-label="Reconnect SSH"
            onClick={(e) => {
              e.stopPropagation();
              onReconnect();
            }}
          >
            <Icon iconName={IconName.Refresh} size={16} />
          </Button>
        </Tooltip>
      ) : null}
    </div>
  );
}
