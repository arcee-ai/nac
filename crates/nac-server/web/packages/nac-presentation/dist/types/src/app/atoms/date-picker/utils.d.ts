export interface CalendarDay {
    date: Date;
    /** False for the leading and trailing days borrowed from adjacent months. */
    inMonth: boolean;
}
export declare const startOfMonth: (date: Date) => Date;
export declare const addMonths: (date: Date, count: number) => Date;
export declare const addDays: (date: Date, count: number) => Date;
/** Midnight local time, the canonical form every comparison here uses. */
export declare const startOfDay: (date: Date) => Date;
export declare const isSameDay: (a: Date, b: Date) => boolean;
export declare const isToday: (date: Date) => boolean;
export declare const isWithin: (date: Date, from: Date, to: Date) => boolean;
export declare const isOutOfBounds: (date: Date, min?: Date, max?: Date) => boolean;
export declare const monthLabel: (date: Date) => string;
/** Sunday first, matching the order `Date.getDay()` returns. */
export declare const weekdayLabels: () => string[];
/** A key stable across re-renders, used to find a day button to focus. */
export declare const dayKey: (date: Date) => string;
/** Whole weeks covering `month`, padded from the months on either side. */
export declare function monthGrid(month: Date): CalendarDay[];
