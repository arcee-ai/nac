import { html } from "../lib/html.js";
import { cn } from "../lib/cn.js";
import { Icon } from "./icon.js";

export const TabButtonSize = {
  Large: "btn-large",
  Medium: "btn-medium",
  Small: "btn-small",
};

export const TabButtonVariant = {
  Regular: "btn-ghost",
  Accent: "btn-ghost-accent",
  Destructive: "btn-ghost-destructive",
};

// Vertical/list tab item (used inside dropdowns and sidebars).
export function TabButton({
  size = TabButtonSize.Medium,
  variant = TabButtonVariant.Regular,
  active = false,
  disabled = false,
  className = "",
  children,
  ...rest
}) {
  const computed =
    active && variant === TabButtonVariant.Regular
      ? "btn-ghost-highlighted"
      : active && variant === TabButtonVariant.Accent
        ? "btn-ghost-highlighted-accent"
        : variant;
  const classes = cn(
    "btn btn-icon tab-btn w-full justify-start",
    size,
    computed,
    disabled && "btn-disabled",
    "rounded-[4px]",
    className,
  );
  return html`<button class=${classes} disabled=${disabled} ...${rest}>
    ${children}
  </button>`;
}

// Horizontal tab item with an underline for the active state.
export function HorizontalTabsItem({
  active = false,
  iconName,
  disabled = false,
  className = "",
  children,
  type = "button",
  ...rest
}) {
  const classes = cn(
    "horizontal-tab-item btn btn-medium rounded-b-none border-solid rounded-t-lg border-b-2 border-t-0 border-l-0 border-r-0",
    iconName ? "btn-icon-left" : "btn-text",
    active ? "btn-ghost-accent border-accent-primary" : "border-transparent btn-ghost",
    disabled ? "btn-disabled" : "cursor-auto",
    className,
  );
  return html`<button type=${type} class=${classes} disabled=${disabled} ...${rest}>
    ${iconName ? html`<${Icon} name=${iconName} />` : null}
    ${children}
  </button>`;
}
