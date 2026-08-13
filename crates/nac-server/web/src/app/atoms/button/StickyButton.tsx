import type React from "react";

import { cn } from "../../lib/cn";
import Loader, { LoaderSize } from "../loader";
import { ButtonContent, ButtonVariant, loaderVariant } from "./index";

interface StickyButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size"> {
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
  const stretches =
    className.includes("flex-grow") || className.includes("flex-1");

  return (
    <div
      className={cn(
        "bg-elevation-level-3 shadow-2xl rounded-full overflow-hidden h-10",
        stretches ? "flex w-full" : "inline-flex w-fit",
        className,
      )}
    >
      <button
        type={type}
        className={cn(
          "btn btn-large btn-sticky",
          variant,
          content,
          (disabled || loading) && "btn-disabled",
          loading && "relative",
          stretches && "w-full",
          buttonClassName,
        )}
        disabled={disabled || loading}
        {...props}
      >
        {children}
        {loading ? (
          <div className="absolute fade top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2">
            <Loader size={LoaderSize.Large} variant={loaderVariant[variant]} />
          </div>
        ) : null}
      </button>
    </div>
  );
};

StickyButton.Variant = ButtonVariant;
StickyButton.Content = ButtonContent;

export default StickyButton;
