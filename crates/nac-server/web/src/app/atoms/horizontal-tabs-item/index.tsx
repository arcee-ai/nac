import type React from "react";
import { cn } from "../../lib/cn";
import Icon, { type IconName } from "../icon";

interface HorizontalTabsItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  iconName?: IconName;
}

/** Horizontal tab item with an underline for the active state. */
const HorizontalTabsItem: React.FC<HorizontalTabsItemProps> = ({
  active = false,
  iconName,
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
      active
        ? "btn-ghost-accent border-accent-primary"
        : "border-transparent btn-ghost",
      disabled ? "btn-disabled" : "cursor-auto",
      className,
    )}
    {...props}
  >
    {iconName ? <Icon iconName={iconName} /> : null}
    {children}
  </button>
);

export default HorizontalTabsItem;
