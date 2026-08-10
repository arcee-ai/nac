import type React from "react";

export enum TabButtonSize {
  Large = "btn-large",
  Medium = "btn-medium",
  Small = "btn-small",
}

export enum TabButtonVariant {
  Regular = "btn-ghost",
  Accent = "btn-ghost-accent",
  Destructive = "btn-ghost-destructive",
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: TabButtonSize;
  variant?: TabButtonVariant;
  children: React.ReactNode;
  active?: boolean;
}

const TabButton: React.FC<ButtonProps> & {
  Size: typeof TabButtonSize;
  Variant: typeof TabButtonVariant;
} = ({
  size = TabButtonSize.Medium,
  variant = TabButtonVariant.Regular,
  active = false,
  disabled,
  className = "",
  children,
  ...props
}) => {
    const computedVariant =
      active && variant === TabButtonVariant.Regular
        ? "btn-ghost-highlighted"
        : active && variant === TabButtonVariant.Accent
          ? "btn-ghost-highlighted-accent"
          : variant;

    const classes = [
      "btn btn-icon tab-btn",
      "w-full",
      "justify-start",
      size,
      computedVariant,
      disabled ? "btn-disabled" : "",
      className,
      "rounded-[4px]",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        onClick={() => { }}
        className={classes}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  };

TabButton.Size = TabButtonSize;
TabButton.Variant = TabButtonVariant;

export default TabButton;
