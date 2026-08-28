import type React from "react";

import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "./index";

interface StickyButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
  variant?: ButtonVariant;
  content?: ButtonContent;
  children: React.ReactNode;
  loading?: boolean;
  /** Applied to the elevated wrapper rather than the button itself. */
  className?: string;
  buttonClassName?: string;
}

const StickyButton: React.FC<StickyButtonProps> & {
  Variant: typeof ButtonVariant;
  Content: typeof ButtonContent;
} = ({
  variant = ButtonVariant.Ghost,
  content = ButtonContent.Text,
  disabled,
  className = "",
  buttonClassName = "",
  children,
  loading = false,
  type = "button",
  ...props
}) => {
  const stretches = className.includes("flex-grow") || className.includes("flex-1");

  return (
    <div
      className={cn(
        "bg-elevation-level-3 shadow-2xl rounded-full overflow-hidden h-10",
        stretches ? "flex w-full" : "inline-flex w-fit",
        className,
      )}
    >
      <Button
        size={ButtonSize.Large}
        variant={variant}
        content={content}
        type={type}
        disabled={disabled}
        loading={loading}
        className={cn("btn-sticky", stretches && "w-full", buttonClassName)}
        {...props}
      >
        {children}
      </Button>
    </div>
  );
};

StickyButton.Variant = ButtonVariant;
StickyButton.Content = ButtonContent;

export default StickyButton;
