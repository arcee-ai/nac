import type React from "react";

import { AnchorPlacement } from "../../lib/anchor";
import { cn } from "../../lib/cn";
import HoverHint from "../hover-hint";
import type { HoverHintConfig } from "../label";

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

const VARIANT_CLASS: Record<TabButtonVariant, string> = {
  [TabButtonVariant.Regular]: "tab-btn-regular",
  [TabButtonVariant.Accent]: "tab-btn-accent",
  [TabButtonVariant.Destructive]: "tab-btn-destructive",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: React.Ref<HTMLButtonElement>;
  size?: TabButtonSize;
  variant?: TabButtonVariant;
  children: React.ReactNode;
  active?: boolean;
  /** Info glyph at the end of the row, after any shortcut. Its hover text explains the row. */
  hoverHint?: HoverHintConfig;
  /** Sits before the hover hint, for a shortcut or other trailing affordance. */
  trailing?: React.ReactNode;
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
  hoverHint,
  trailing,
  ...props
}) => {
  const classes = cn(
    "btn btn-icon tab-btn w-full",
    size,
    VARIANT_CLASS[variant],
    active && "tab-btn-active",
    disabled && "btn-disabled",
    className,
  );

  return (
    <button onClick={() => {}} className={classes} disabled={disabled} {...props}>
      {children}
      {trailing}
      {hoverHint ? (
        <span
          className="inline-flex shrink-0"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <HoverHint
            title={hoverHint.title}
            description={hoverHint.description}
            muted={hoverHint.muted}
            position={AnchorPlacement.CenterRight}
          />
        </span>
      ) : null}
    </button>
  );
};

TabButton.Size = TabButtonSize;
TabButton.Variant = TabButtonVariant;

export default TabButton;
