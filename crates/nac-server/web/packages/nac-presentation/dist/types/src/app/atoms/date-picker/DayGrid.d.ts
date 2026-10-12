import React from "react";
import { type CalendarDay } from "./utils";
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
/** The 7-column body of the calendar, including arrow-key navigation. */
declare const DayGrid: React.FC<DayGridProps>;
export default DayGrid;
