import type React from "react";
import { cn } from "../../lib/cn";
import Icon, { type IconName } from "../icon";

export enum HorizontalTabsItemVariant {
  Accent = "accent",
  Neutral = "neutral",
}

interface HorizontalTabsItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  iconName?: IconName;
  variant?: HorizontalTabsItemVariant;
}

const ACTIVE_CLASS: Record<HorizontalTabsItemVariant, string> = {
  [HorizontalTabsItemVariant.Accent]: "btn-ghost-accent border-accent-primary",
  [HorizontalTabsItemVariant.Neutral]:
    "btn-ghost-highlighted border-primary text-basic-primary",
};

/** Horizontal tab item with an underline for the active state. */
const HorizontalTabsItem: React.FC<HorizontalTabsItemProps> & {
  Variant: typeof HorizontalTabsItemVariant;
} = ({
  active = false,
  iconName,
  variant = HorizontalTabsItemVariant.Accent,
  disabled = false,
  className = "",
  children,
  type = "button",
  ...props
}) => (
  <button
    type={type}
    disabled={disabled}
    className={cn(
      "horizontal-tab-item btn btn-medium rounded-b-none border-solid rounded-t-lg border-b-2 border-t-0 border-l-0 border-r-0",
      iconName ? "btn-icon-left" : "btn-text",
      active ? ACTIVE_CLASS[variant] : "border-transparent btn-ghost",
      disabled ? "btn-disabled" : "cursor-auto",
      className,
    )}
    {...props}
  >
    {iconName ? <Icon iconName={iconName} /> : null}
    {children}
  </button>
);

HorizontalTabsItem.Variant = HorizontalTabsItemVariant;

export default HorizontalTabsItem;
