import React, { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import Button, { ButtonContent, ButtonSize, ButtonVariant } from "../button";
import Icon, { IconName } from "../icon";
import DayGrid, { type DateRange } from "./DayGrid";
import { addDays, addMonths, monthGrid, monthLabel, startOfMonth, weekdayLabels } from "./utils";

export type { DateRange };

interface DatePickerProps {
  /** Single-date mode. Ignored when `range` is used. */
  selected?: Date;
  onSelect?: (date: Date) => void;
  /** Range mode: pass a range and its setter instead of `selected`. */
  range?: DateRange;
  onRangeChange?: (range: DateRange) => void;
  min?: Date;
  max?: Date;
  disabled?: boolean;
  /** Month shown first, when nothing is selected yet. */
  defaultMonth?: Date;
  className?: string;
}

const WEEKDAYS = weekdayLabels();

/**
 * Month calendar for one date or a range. It owns only the visible month and
 * the focused day; the value itself stays with the caller.
 */
const DatePicker: React.FC<DatePickerProps> = ({
  selected,
  onSelect,
  range,
  onRangeChange,
  min,
  max,
  disabled = false,
  defaultMonth,
  className = "",
}) => {
  const anchor = range ? (range.to ?? range.from) : selected;
  const [month, setMonth] = useState(() => startOfMonth(defaultMonth ?? anchor ?? new Date()));
  const [focused, setFocused] = useState<Date | undefined>(anchor);
  const days = useMemo(() => monthGrid(month), [month]);

  const pick = (date: Date) => {
    setFocused(date);
    if (!range) {
      onSelect?.(date);
      return;
    }
    // A range is built in two clicks: the first starts a fresh one, the second
    // closes it, flipping the ends when the user picked them backwards.
    const from = range.from;
    if (!from || range.to) {
      onRangeChange?.({ from: date, to: undefined });
      return;
    }
    onRangeChange?.(date < from ? { from: date, to: from } : { from, to: date });
  };

  const navigate = (from: Date, offsetDays: number) => {
    const next = addDays(from, offsetDays);
    setFocused(next);
    if (next.getFullYear() !== month.getFullYear() || next.getMonth() !== month.getMonth()) {
      setMonth(startOfMonth(next));
    }
  };

  return (
    <div
      role="group"
      aria-label="Calendar"
      className={cn("flex flex-col min-w-0 w-[280px]", className)}
    >
      <div className="flex items-center justify-between gap-2 p-1 border-b border-muted">
        <Button
          variant={ButtonVariant.Ghost}
          size={ButtonSize.Medium}
          content={ButtonContent.Icon}
          aria-label="Previous month"
          onClick={() => setMonth((current) => addMonths(current, -1))}
        >
          <Icon iconName={IconName.Left} />
        </Button>
        <div className="label-small text-basic-primary" aria-live="polite">
          {monthLabel(month)}
        </div>
        <Button
          variant={ButtonVariant.Ghost}
          size={ButtonSize.Medium}
          content={ButtonContent.Icon}
          aria-label="Next month"
          onClick={() => setMonth((current) => addMonths(current, 1))}
        >
          <Icon iconName={IconName.Right} />
        </Button>
      </div>

      <div className="grid grid-cols-7 px-2 pt-2" role="row">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            role="columnheader"
            className="label-micro text-basic-tertiary text-center py-1"
          >
            {weekday}
          </div>
        ))}
      </div>

      <DayGrid
        days={days}
        selected={range ? undefined : selected}
        range={range}
        focused={focused}
        min={min}
        max={max}
        disabled={disabled}
        onSelect={pick}
        onFocusDay={setFocused}
        onNavigate={navigate}
      />
    </div>
  );
};

export default DatePicker;
