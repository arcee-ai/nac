import type { ReactNode } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";

interface MessageActionIconProps {
  /** Tooltip text for the enabled action. */
  title: string;
  /** Accessible action name when it intentionally differs from the tooltip. */
  ariaLabel?: string;
  disabled?: boolean;
  /** Replaces the tooltip title while disabled, matching the existing action contract. */
  disabledReason?: string | null;
  position: TooltipPosition;
  isMobile: boolean;
  onClick?: () => void;
  children: ReactNode;
}

/**
 * Shared transcript action chrome. Disabled native buttons do not receive
 * pointer events, so the tooltip keeps a wrapping span in that state.
 */
export function MessageActionIcon({
  title,
  ariaLabel = title,
  disabled = false,
  disabledReason,
  position,
  isMobile,
  onClick,
  children,
}: MessageActionIconProps) {
  const button = (
    <Button
      size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
      variant={isMobile ? ButtonVariant.Ghost : ButtonVariant.Tertiary}
      content={ButtonContent.Icon}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="md:!h-4 md:!min-h-4 md:!p-0"
    >
      {children}
    </Button>
  );

  return (
    <Tooltip title={disabledReason && disabled ? disabledReason : title} position={position}>
      {disabled ? <span className="inline-flex">{button}</span> : button}
    </Tooltip>
  );
}
