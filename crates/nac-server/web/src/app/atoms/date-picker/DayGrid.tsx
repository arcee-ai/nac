import React, { useEffect, useRef } from "react";
import { cn } from "../../lib/cn";
import Button, { ButtonSize, ButtonVariant } from "../button";
import {
  type CalendarDay,
  dayKey,
  isOutOfBounds,
  isSameDay,
  isToday,
  isWithin,
} from "./utils";

export interface DateRange {
  from?: Date;
  to?: Date;
}

interface DayGridProps {
  days: CalendarDay[];
  selected?: Date;
  range?: DateRange;
  /** The day that owns the roving tab stop, kept focused as it moves. */
  focused?: Date;
  min?: Date;
  max?: Date;
  disabled?: boolean;
  onSelect: (date: Date) => void;
  onFocusDay: (date: Date) => void;
  onNavigate: (from: Date, offsetDays: number) => void;
}

function variantFor(
  isSelected: boolean,
  isEdge: boolean,
  inRange: boolean,
  today: boolean,
): ButtonVariant {
  if (isSelected || isEdge) return ButtonVariant.Primary;
  if (inRange) return ButtonVariant.GhostHighlightedAccent;
  if (today) return ButtonVariant.SecondaryHighlighted;
  return ButtonVariant.Ghost;
}

/** The 7-column body of the calendar, including arrow-key navigation. */
const DayGrid: React.FC<DayGridProps> = ({
  days,
  selected,
  range,
  focused,
  min,
  max,
  disabled = false,
  onSelect,
  onFocusDay,
  onNavigate,
}) => {
  const gridRef = useRef<HTMLDivElement>(null);

  // Arrow keys can walk into the next month, which re-renders the whole grid,
  // so the focus has to be reapplied once the new buttons exist.
  useEffect(() => {
    const grid = gridRef.current;
    if (!focused || !grid) return undefined;
    const frame = requestAnimationFrame(() => {
      const target = grid.querySelector<HTMLButtonElement>(
        `button[data-day="${dayKey(focused)}"]`,
      );
      if (target && !target.disabled) target.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focused, days]);

  const onKeyDown = (event: React.KeyboardEvent, date: Date) => {
    const offset = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    onNavigate(date, offset);
  };

  return (
    <div ref={gridRef} className="grid grid-cols-7 gap-y-1 p-2" role="rowgroup">
      {days.map(({ date, inMonth }) => {
        const isSelected = selected ? isSameDay(date, selected) : false;
        const isStart = range?.from ? isSameDay(date, range.from) : false;
        const isEnd = range?.to ? isSameDay(date, range.to) : false;
        const inRange =
          range?.from && range?.to ? isWithin(date, range.from, range.to) : false;
        const isDisabled =
          disabled || !inMonth || isOutOfBounds(date, min, max);
        // Square off the inner edges so a selected span reads as one bar.
        const seam =
          isStart && isEnd
            ? null
            : isStart
              ? "rounded-r-none"
              : isEnd
                ? "rounded-l-none"
                : inRange
                  ? "rounded-none"
                  : null;

        return (
          <div key={dayKey(date)} role="gridcell" aria-selected={isSelected}>
            <Button
              data-day={dayKey(date)}
              variant={variantFor(isSelected, isStart || isEnd, inRange, isToday(date))}
              size={ButtonSize.Medium}
              disabled={isDisabled}
              tabIndex={focused && isSameDay(date, focused) ? 0 : -1}
              className={cn("w-full", seam, !inMonth && "invisible")}
              onClick={() => onSelect(date)}
              onFocus={() => onFocusDay(date)}
              onKeyDown={(event) => onKeyDown(event, date)}
            >
              {date.getDate()}
            </Button>
          </div>
        );
      })}
    </div>
  );
};

export default DayGrid;
