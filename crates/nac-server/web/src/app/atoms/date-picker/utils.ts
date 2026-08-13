// Day arithmetic for the calendar grid. Everything works on local calendar
// days rather than instants, so a date is only ever compared by its year,
// month and day and never shifts because of a timezone.

/** The UI is English-only, so the locale is fixed rather than sniffed. */
const LOCALE = "en-US";

export interface CalendarDay {
  date: Date;
  /** False for the leading and trailing days borrowed from adjacent months. */
  inMonth: boolean;
}

const monthFormatter = new Intl.DateTimeFormat(LOCALE, {
  month: "long",
  year: "numeric",
});
const weekdayFormatter = new Intl.DateTimeFormat(LOCALE, { weekday: "short" });

export const startOfMonth = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), 1);

export const addMonths = (date: Date, count: number) =>
  new Date(date.getFullYear(), date.getMonth() + count, 1);

export const addDays = (date: Date, count: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);

/** Midnight local time, the canonical form every comparison here uses. */
export const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const isToday = (date: Date) => isSameDay(date, new Date());

export const isWithin = (date: Date, from: Date, to: Date) => {
  const value = startOfDay(date).getTime();
  return (
    value >= startOfDay(from).getTime() && value <= startOfDay(to).getTime()
  );
};

export const isOutOfBounds = (date: Date, min?: Date, max?: Date) => {
  const value = startOfDay(date).getTime();
  if (min && value < startOfDay(min).getTime()) return true;
  if (max && value > startOfDay(max).getTime()) return true;
  return false;
};

export const monthLabel = (date: Date) => monthFormatter.format(date);

/** Sunday first, matching the order `Date.getDay()` returns. */
export const weekdayLabels = (): string[] => {
  const sunday = new Date(2021, 7, 1);
  return Array.from({ length: 7 }, (_, offset) =>
    weekdayFormatter.format(addDays(sunday, offset)),
  );
};

/** A key stable across re-renders, used to find a day button to focus. */
export const dayKey = (date: Date) =>
  `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/** Whole weeks covering `month`, padded from the months on either side. */
export function monthGrid(month: Date): CalendarDay[] {
  const first = startOfMonth(month);
  const lead = first.getDay();
  const daysInMonth = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();

  const days: CalendarDay[] = [];
  for (let offset = -lead; offset < 0; offset += 1) {
    days.push({ date: addDays(first, offset), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push({
      date: new Date(month.getFullYear(), month.getMonth(), day),
      inMonth: true,
    });
  }
  const trail = (7 - (days.length % 7)) % 7;
  for (let offset = 1; offset <= trail; offset += 1) {
    days.push({
      date: new Date(month.getFullYear(), month.getMonth(), daysInMonth + offset),
      inMonth: false,
    });
  }
  return days;
}
