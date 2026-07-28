import { html } from "../lib/html.js";
import { cn } from "../lib/cn.js";
import { Loader, LoaderSize, LoaderVariant } from "./loader.js";

export const ButtonSize = {
  Small: "btn-small",
  Medium: "btn-medium",
  Large: "btn-large",
};

export const ButtonVariant = {
  Primary: "btn-primary",
  Secondary: "btn-secondary",
  SecondaryHighlighted: "btn-secondary-highlighted",
  SecondaryDestructive: "btn-secondary-destructive",
  SecondaryAccent: "btn-secondary-accent",
  SecondaryAccentHighlighted: "btn-secondary-accent-highlighted",
  Tertiary: "btn-tertiary",
  TertiaryDestructive: "btn-tertiary-destructive",
  TertiaryAccent: "btn-tertiary-accent",
  Ghost: "btn-ghost",
  GhostDestructive: "btn-ghost-destructive",
  GhostAccent: "btn-ghost-accent",
  GhostHighlighted: "btn-ghost-highlighted",
  GhostHighlightedAccent: "btn-ghost-highlighted-accent",
};

export const ButtonContent = {
  Icon: "btn-icon",
  IconLeft: "btn-icon-left",
  IconRight: "btn-icon-right",
  Text: "btn-text",
};

const loaderSizeFor = {
  "btn-small": LoaderSize.Small,
  "btn-medium": LoaderSize.Medium,
  "btn-large": LoaderSize.Large,
};

const loaderVariantFor = {
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

export function Button({
  size = ButtonSize.Medium,
  variant = ButtonVariant.Ghost,
  content = ButtonContent.Text,
  disabled = false,
  loading = false,
  type = "button",
  className = "",
  children,
  ...rest
}) {
  const classes = cn(
    "btn",
    size,
    variant,
    content,
    (disabled || loading) && "btn-disabled",
    loading && "relative",
    className,
  );
  return html`
    <button
      type=${type}
      class=${classes}
      disabled=${disabled || loading}
      ...${rest}
    >
      ${children}
      ${loading
        ? html`<div
            class="absolute fade top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2"
          >
            <${Loader}
              size=${loaderSizeFor[size]}
              variant=${loaderVariantFor[variant]}
            />
          </div>`
        : null}
    </button>
  `;
}
