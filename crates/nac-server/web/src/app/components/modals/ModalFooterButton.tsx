import type { ReactNode } from "react";

import { Button, ButtonContent, ButtonSize, ButtonVariant, StickyButton } from "@/app/atoms";

/**
 * A footer action: a sticky bar button on mobile, a large button on desktop
 * (where the neutral action renders as a ghost button).
 */
export function FooterButton({
  isMobile,
  variant,
  content,
  className,
  disabled,
  onClick,
  children,
}: {
  isMobile: boolean;
  variant: ButtonVariant;
  content?: ButtonContent;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  if (isMobile) {
    return (
      <StickyButton
        variant={variant}
        content={content ?? ButtonContent.Text}
        className={className}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </StickyButton>
    );
  }
  return (
    <Button
      size={ButtonSize.Large}
      variant={variant === ButtonVariant.Secondary ? ButtonVariant.Ghost : variant}
      content={content}
      className={className}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
