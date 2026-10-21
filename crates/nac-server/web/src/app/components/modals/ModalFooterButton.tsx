import type { ReactNode } from "react";

import { Button, ButtonContent, ButtonSize, ButtonVariant, StickyButton } from "@/app/atoms";

/**
 * A footer action: a sticky pill on mobile, a large button on desktop.
 * The variant is the one the caller asked for on both sizes.
 */
export function FooterButton({
  isMobile,
  variant,
  content,
  className,
  disabled,
  onClick,
  children,
  ariaLabel,
}: {
  isMobile: boolean;
  variant: ButtonVariant;
  content?: ButtonContent;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
  ariaLabel?: string;
}) {
  if (isMobile) {
    return (
      <StickyButton
        variant={variant}
        content={content ?? ButtonContent.Text}
        className={className}
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={onClick}
      >
        {children}
      </StickyButton>
    );
  }
  return (
    <Button
      size={ButtonSize.Large}
      variant={variant}
      content={content}
      className={className}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
