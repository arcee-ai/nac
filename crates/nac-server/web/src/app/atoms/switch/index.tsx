import type React from "react";
import { cn } from "../../lib/cn";

export enum SwitchSize {
  /** Figma Small: 32×16 track, 12px knob. */
  Medium = "medium",
  /** Figma Regular: 40×20 track, 16px knob. A phone wants this larger hit area. */
  Large = "large",
}

const TRACK = {
  [SwitchSize.Medium]: "h-4 w-8",
  [SwitchSize.Large]: "h-5 w-10",
};

const KNOB = {
  [SwitchSize.Medium]: "top-0.5 left-0.5 size-3",
  [SwitchSize.Large]: "top-0.5 left-[3px] size-4",
};

const KNOB_TRAVEL = {
  [SwitchSize.Medium]: "translate-x-4",
  [SwitchSize.Large]: "translate-x-[18px]",
};

interface SwitchProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "size"
> {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  size?: SwitchSize;
}

/** Track and knob toggle. Sizes and tokens follow the Figma Switcher. */
const Switch: React.FC<SwitchProps> = ({
  checked = false,
  disabled = false,
  onChange,
  size = SwitchSize.Medium,
  className = "",
  ...props
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => !disabled && onChange?.(!checked)}
    className={cn(
      "relative shrink-0 rounded-full shadow-convex transition-colors duration-150",
      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]",
      TRACK[size],
      disabled
        ? cn(
            "cursor-not-allowed",
            checked ? "bg-input-switcher-active-disabled" : "bg-input-switcher-disabled",
          )
        : cn("cursor-pointer", checked ? "bg-input-switcher-active" : "bg-input-switcher"),
      className,
    )}
    {...props}
  >
    <span
      className={cn(
        "absolute rounded-full transition-transform duration-150",
        KNOB[size],
        disabled ? "bg-input-knob-disabled" : checked ? "bg-input-knob-active" : "bg-input-knob",
        checked ? KNOB_TRAVEL[size] : "translate-x-0",
      )}
    />
  </button>
);

export default Switch;
