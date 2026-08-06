import type React from "react";
import { cn } from "../../lib/cn";

interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
}

/** Track/knob toggle on the input switcher tokens. */
const Switch: React.FC<SwitchProps> = ({
  checked = false,
  disabled = false,
  onChange,
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
      "relative shrink-0 w-9 h-5 rounded-full transition-colors duration-150",
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
        "absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform duration-150",
        disabled
          ? "bg-input-knob-disabled"
          : checked
            ? "bg-input-knob-active"
            : "bg-input-knob",
        checked ? "translate-x-4" : "translate-x-0",
      )}
    />
  </button>
);

export default Switch;
