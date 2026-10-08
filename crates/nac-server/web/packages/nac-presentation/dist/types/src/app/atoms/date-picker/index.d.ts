import React from "react";
import { type DateRange } from "./DayGrid";
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
/**
 * Month calendar for one date or a range. It owns only the visible month and
 * the focused day; the value itself stays with the caller.
 */
declare const DatePicker: React.FC<DatePickerProps>;
export default DatePicker;
