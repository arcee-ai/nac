import type { ReactNode } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";

/**
 * Hover action on a transcript bubble. A disabled native button does not
 * receive pointer events, so the tooltip sits on a wrapping span.
 */
export function MessageActionIcon({
  title,
  disabled = false,
  disabledReason,
  position,
  isMobile,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  disabledReason?: string | null;
  position: TooltipPosition;
  isMobile: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const button = (
    <Button
      size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
      variant={isMobile ? ButtonVariant.Ghost : ButtonVariant.Tertiary}
      content={ButtonContent.Icon}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="md:!h-4 md:!min-h-4 md:!p-0"
    >
      {children}
    </Button>
  );
  return (
    <Tooltip
      title={title}
      description={disabled ? (disabledReason ?? undefined) : undefined}
      position={position}
    >
      {disabled ? <span className="inline-flex">{button}</span> : button}
    </Tooltip>
  );
}
