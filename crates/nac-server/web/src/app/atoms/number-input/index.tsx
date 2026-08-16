import React, { useState } from "react";
import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";
import { InputSize } from "../input";

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  size?: InputSize;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

const buttonSizeFor = {
  [InputSize.Small]: ButtonSize.Small,
  [InputSize.Medium]: ButtonSize.Medium,
  [InputSize.Large]: ButtonSize.Large,
} satisfies Record<InputSize, ButtonSize>;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Stepper for a bounded number. Typing is free-form until blur or Enter, so a
 * half-written value like "1" on the way to "12" is not clamped mid-keystroke.
 */
const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  size = InputSize.Medium,
  disabled = false,
  className = "",
  "aria-label": ariaLabel,
}) => {
  const [draft, setDraft] = useState(String(value));
  // The field is only loosely bound while it is being typed into, so a value
  // that changes from the outside has to overwrite whatever is in there.
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(String(value));
  }

  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === "" || Number.isNaN(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = clamp(parsed, min, max);
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  const nudge = (delta: number) => {
    const next = clamp(value + delta, min, max);
    if (next !== value) onChange(next);
  };

  return (
    <div className={cn("flex items-center gap-2 w-fit", className)}>
      <Button
        variant={ButtonVariant.Secondary}
        size={buttonSizeFor[size]}
        content={ButtonContent.Icon}
        disabled={disabled || value <= min}
        aria-label="Decrease"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => nudge(-step)}
      >
        <Icon iconName={IconName.Remove} />
      </Button>

      <input
        type="text"
        inputMode="numeric"
        role="spinbutton"
        aria-label={ariaLabel}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        className={cn(
          "input rounded-[4px] text-center w-16 px-1 font-normal",
          size,
          disabled && "input-disabled",
        )}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            nudge(step);
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            nudge(-step);
          }
        }}
      />

      <Button
        variant={ButtonVariant.Secondary}
        size={buttonSizeFor[size]}
        content={ButtonContent.Icon}
        disabled={disabled || value >= max}
        aria-label="Increase"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => nudge(step)}
      >
        <Icon iconName={IconName.Add} />
      </Button>
    </div>
  );
};

export default NumberInput;
