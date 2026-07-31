import type React from "react";
import Loader, { LoaderSize, LoaderVariant } from "../loader";

// Enums
export enum ButtonSize {
  Medium = "btn-medium",
  Small = "btn-small",
  Large = "btn-large",
}

export enum ButtonVariant {
  Primary = "btn-primary",
  Secondary = "btn-secondary",
  SecondaryHighlighted = "btn-secondary-highlighted",
  SecondaryDestructive = "btn-secondary-destructive",
  SecondaryAccent = "btn-secondary-accent",
  SecondaryAccentHighlighted = "btn-secondary-accent-highlighted",
  Tertiary = "btn-tertiary",
  TertiaryDestructive = "btn-tertiary-destructive",
  TertiaryAccent = "btn-tertiary-accent",
  Ghost = "btn-ghost",
  GhostDestructive = "btn-ghost-destructive",
  GhostAccent = "btn-ghost-accent",
  GhostHighlighted = "btn-ghost-highlighted",
  GhostHighlightedAccent = "btn-ghost-highlighted-accent",
}

export enum ButtonContent {
  Icon = "btn-icon",
  IconLeft = "btn-icon-left",
  IconRight = "btn-icon-right",
  Text = "btn-text",
}

// Props
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
  variant?: ButtonVariant;
  content?: ButtonContent;
  children: React.ReactNode;
  loading?: boolean;
}

const loaderSize = {
  "btn-medium": LoaderSize.Medium,
  "btn-small": LoaderSize.Small,
  "btn-large": LoaderSize.Large,
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
}) => {
    const classes = [
      "btn",
      size,
      variant,
      content,
      disabled || loading ? "btn-disabled" : "",
      loading ? "relative" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        type={type}
        className={classes}
        disabled={disabled || loading}
        {...props}
      >
        {children}
        {loading ? (
          <div className="absolute fade top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2">
            <Loader size={loaderSize[size]} variant={loaderVariant[variant]} />
          </div>
        ) : null}
      </button>
    );
  };

// Attach enums to the Button object
Button.Size = ButtonSize;
Button.Variant = ButtonVariant;
Button.Content = ButtonContent;

export default Button;
