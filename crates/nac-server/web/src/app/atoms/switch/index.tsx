import type React from "react";
import { cn } from "../../lib/cn";

export enum SwitchSize {
  Medium = "medium",
  Large = "large",
}

const TRACK = {
  [SwitchSize.Medium]: "w-9 h-5",
  [SwitchSize.Large]: "w-11 h-6",
};

const KNOB = {
  [SwitchSize.Medium]: "w-4 h-4",
  [SwitchSize.Large]: "w-5 h-5",
};

const KNOB_TRAVEL = {
  [SwitchSize.Medium]: "translate-x-4",
  [SwitchSize.Large]: "translate-x-5",
};

interface SwitchProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "onChange" | "size"
  > {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  /** A phone wants the larger track, which is easier to hit with a thumb. */
  size?: SwitchSize;
}

/** Track/knob toggle on the input switcher tokens. */
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
      "relative shrink-0 rounded-full transition-colors duration-150",
      TRACK[size],
      disabled
        ? "bg-input-switcher-disabled cursor-not-allowed"
        : checked
          ? "bg-input-switcher-active cursor-auto"
          : "bg-input-switcher cursor-auto",
      className,
    )}
    {...props}
  >
    <span
      className={cn(
        "absolute top-0.5 left-0.5 rounded-full transition-transform duration-150",
        KNOB[size],
        disabled
          ? "bg-input-knob-disabled"
          : checked
            ? "bg-input-knob"
            : "bg-input-knob",
        checked ? KNOB_TRAVEL[size] : "translate-x-0",
      )}
    />
  </button>
);

export default Switch;
