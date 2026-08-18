import React, { useState } from "react";
import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import DatePicker, { type DateRange } from "../date-picker";
import Icon, { IconName } from "../icon";
import InputWrapper, { type InputWrapperProps } from "../input/InputWrapper";
import Popover, { PopoverPlacement, PopoverSize } from "../popover";

/**
 * Values cross this boundary as `YYYY-MM-DD`, the same calendar-day form a
 * native date input uses. Anything with a time in it would drag a timezone
 * along and shift the day for users west of UTC.
 */
export type DateString = string;

export interface DateStringRange {
  from: DateString | null;
  to: DateString | null;
}

const toDateString = (date: Date): DateString =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

const fromDateString = (value?: DateString | null): Date | undefined => {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

const display = (value?: DateString | null): string => {
  const date = fromDateString(value);
  return date ? date.toLocaleDateString("en-US") : "";
};

interface CommonProps extends Omit<InputWrapperProps, "children" | "validationText"> {
  size?: ButtonSize;
  disabled?: boolean;
  validationText?: string;
  placement?: PopoverPlacement;
  min?: DateString;
  max?: DateString;
  placeholder?: string;
}

interface SingleProps extends CommonProps {
  value: DateString | null;
  onChange: (value: DateString) => void;
  range?: never;
  onRangeChange?: never;
}

interface RangeProps extends CommonProps {
  value?: never;
  onChange?: never;
  range: DateStringRange;
  onRangeChange: (range: DateStringRange) => void;
}

type DateSelectorProps = SingleProps | RangeProps;

/** Calendar behind a field-shaped trigger, closing once the value is complete. */
const DateSelector: React.FC<DateSelectorProps> = ({
  value,
  onChange,
  range,
  onRangeChange,
  size = ButtonSize.Medium,
  disabled = false,
  validation,
  validationText,
  placement = PopoverPlacement.BottomRight,
  min,
  max,
  placeholder,
  label,
  required,
  hintText,
  hoverHint,
  className = "",
}) => {
  const [open, setOpen] = useState(false);
  const isRange = Boolean(range);

  const text = isRange
    ? range?.from || range?.to
      ? `${display(range?.from) || "Start"} – ${display(range?.to) || "End"}`
      : (placeholder ?? "Select range")
    : ((display(value) || placeholder) ?? "Select date");

  const pickDate = (date: Date) => {
    onChange?.(toDateString(date));
    setOpen(false);
  };

  const pickRange = (next: DateRange) => {
    onRangeChange?.({
      from: next.from ? toDateString(next.from) : null,
      to: next.to ? toDateString(next.to) : null,
    });
    // Leave the calendar up between the two clicks that make a range.
    if (next.from && next.to) setOpen(false);
  };

  const calendar = isRange ? (
    <DatePicker
      range={{ from: fromDateString(range?.from), to: fromDateString(range?.to) }}
      onRangeChange={pickRange}
      min={fromDateString(min)}
      max={fromDateString(max)}
      disabled={disabled}
    />
  ) : (
    <DatePicker
      selected={fromDateString(value)}
      onSelect={pickDate}
      min={fromDateString(min)}
      max={fromDateString(max)}
      disabled={disabled}
    />
  );

  return (
    <InputWrapper
      label={label}
      required={required}
      validation={validation}
      validationText={validationText}
      hintText={hintText}
      hoverHint={hoverHint}
      className={className}
    >
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        placement={placement}
        size={PopoverSize.Fit}
        sticky
        className="w-full"
        panelClassName="p-0"
        content={calendar}
      >
        <Button
          variant={open ? ButtonVariant.SecondaryHighlighted : ButtonVariant.Secondary}
          size={size}
          content={ButtonContent.IconLeft}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn("w-full justify-between", validation && "input-validation")}
          onClick={() => setOpen((current) => !current)}
        >
          <Icon iconName={IconName.Calendar} />
          <span className="flex-1 min-w-0 truncate text-left">{text}</span>
          <Icon
            iconName={IconName.Down}
            className={cn("transition-transform", open && "rotate-180")}
          />
        </Button>
      </Popover>
    </InputWrapper>
  );
};

export default DateSelector;
