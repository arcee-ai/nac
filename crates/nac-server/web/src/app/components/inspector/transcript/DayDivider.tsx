import { memo } from "react";

import { dayLabel } from "./days";

/** Marks where the conversation moves on to another day. */
export const DayDivider = memo(function DayDivider({ day }: { day: number }) {
  return (
    <div role="separator" aria-label={dayLabel(day)} className="flex items-center gap-3 pt-8">
      <span aria-hidden className="h-px flex-1 bg-[var(--f-line-soft)]" />
      <span aria-hidden className="type-meta text-basic-muted">
        {dayLabel(day)}
      </span>
      <span aria-hidden className="h-px flex-1 bg-[var(--f-line-soft)]" />
    </div>
  );
});
