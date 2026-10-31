import type React from "react";

import { Button as UIButton, ButtonContent, ButtonSize, ButtonVariant } from "../../ui/button";
import Loader, { LoaderSize, LoaderVariant } from "../loader";

export { ButtonContent, ButtonSize, ButtonVariant };

// Props
interface ButtonProps extends React.ComponentPropsWithRef<"button"> {
  size?: ButtonSize;
  variant?: ButtonVariant;
  content?: ButtonContent;
  children: React.ReactNode;
  loading?: boolean;
}

const loaderSize = {
  "btn-medium": LoaderSize.Small,
  "btn-small": LoaderSize.Small,
  "btn-large": LoaderSize.Small,
};

export const loaderVariant = {
  // nac's primary button is gray/white rather than brand teal, so the spinner
  // has to pick up the primary fill token instead of the accent one.
  "btn-primary": LoaderVariant.OnPrimary,
  "btn-secondary": LoaderVariant.Neutral,
  "btn-secondary-highlighted": LoaderVariant.Neutral,
  "btn-secondary-destructive": LoaderVariant.Destructive,
  "btn-secondary-accent": LoaderVariant.Brand,
  "btn-secondary-accent-highlighted": LoaderVariant.Brand,
  "btn-tertiary": LoaderVariant.Neutral,
  "btn-tertiary-destructive": LoaderVariant.Destructive,
  "btn-tertiary-accent": LoaderVariant.Brand,
  "btn-ghost": LoaderVariant.Neutral,
  "btn-ghost-destructive": LoaderVariant.Destructive,
  "btn-ghost-accent": LoaderVariant.Brand,
  "btn-ghost-highlighted": LoaderVariant.Neutral,
  "btn-ghost-highlighted-accent": LoaderVariant.Brand,
};
// Component
const Button: React.FC<ButtonProps> & {
  Size: typeof ButtonSize;
  Variant: typeof ButtonVariant;
  Content: typeof ButtonContent;
} = ({
  size = ButtonSize.Medium,
  variant = ButtonVariant.Ghost,
  content = ButtonContent.Text,
  disabled,
  className = "",
  children,
  loading = false,
  type = "button",
  ...props
}) => (
  <UIButton
    size={size}
    variant={variant}
    content={content}
    className={className}
    type={type}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    {...props}
  >
    {loading ? (
      <>
        <Loader size={loaderSize[size]} variant={loaderVariant[variant]} />
        {/* The spinner stands in for the label on screen, not for a screen reader. */}
        <span className="sr-only">{children}</span>
      </>
    ) : (
      children
    )}
  </UIButton>
);

// Attach enums to the Button object
Button.Size = ButtonSize;
Button.Variant = ButtonVariant;
Button.Content = ButtonContent;

export default Button;
