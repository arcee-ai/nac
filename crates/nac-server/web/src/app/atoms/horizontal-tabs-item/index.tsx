import type React from "react";
import { cn } from "../../lib/cn";
import Icon, { type IconName } from "../icon";

export enum HorizontalTabsItemSize {
  Small = "btn-small",
  Medium = "btn-medium",
  Large = "btn-large",
}

export enum HorizontalTabsItemContent {
  IconLeft = "horizontal-tab-item-icon-left",
  IconRight = "horizontal-tab-item-icon-right",
  IconOnly = "horizontal-tab-item-icon",
  TextOnly = "horizontal-tab-item-text",
  Full = "horizontal-tab-item-full",
}

interface HorizontalTabsItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  size?: HorizontalTabsItemSize;
  /** Layout of the label and icons. Omitted, it follows whichever icons are set. */
  content?: HorizontalTabsItemContent;
  iconName?: IconName;
  trailingIcon?: IconName;
}

const HorizontalTabsItem: React.FC<HorizontalTabsItemProps> & {
  Size: typeof HorizontalTabsItemSize;
  Content: typeof HorizontalTabsItemContent;
} = ({
  active = false,
  size = HorizontalTabsItemSize.Large,
  content,
  iconName,
  trailingIcon,
  disabled = false,
  className = "",
  children,
  type = "button",
  ...props
}) => {
  const hasLabel = children != null && children !== false && children !== "";
  const resolved =
    content ??
    (iconName && trailingIcon
      ? HorizontalTabsItemContent.Full
      : iconName
        ? hasLabel
          ? HorizontalTabsItemContent.IconLeft
          : HorizontalTabsItemContent.IconOnly
        : trailingIcon
          ? hasLabel
            ? HorizontalTabsItemContent.IconRight
            : HorizontalTabsItemContent.IconOnly
          : HorizontalTabsItemContent.TextOnly);
  const showLabel = resolved !== HorizontalTabsItemContent.IconOnly;
  const showLeading =
    Boolean(iconName) &&
    (resolved === HorizontalTabsItemContent.IconLeft ||
      resolved === HorizontalTabsItemContent.IconOnly ||
      resolved === HorizontalTabsItemContent.Full);
  const showTrailing =
    Boolean(trailingIcon) &&
    (resolved === HorizontalTabsItemContent.IconRight ||
      resolved === HorizontalTabsItemContent.Full ||
      (resolved === HorizontalTabsItemContent.IconOnly && !iconName));

  return (
    <button
      type={type}
      disabled={disabled}
      className={cn(
        "horizontal-tab-item btn",
        size,
        resolved,
        active ? "horizontal-tab-item-active btn-ghost-highlighted" : "btn-ghost",
        disabled && "btn-disabled",
        className,
      )}
      {...props}
    >
      {showLeading ? <Icon iconName={iconName as IconName} /> : null}
      {showLabel ? <span className="min-w-0 truncate">{children}</span> : null}
      {showTrailing ? <Icon iconName={trailingIcon as IconName} /> : null}
    </button>
  );
};

HorizontalTabsItem.Size = HorizontalTabsItemSize;
HorizontalTabsItem.Content = HorizontalTabsItemContent;

export default HorizontalTabsItem;
