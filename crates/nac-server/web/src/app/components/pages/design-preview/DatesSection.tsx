import { useState } from "react";
import { BoxSurface, DatePicker, DateSelector, type DateStringRange } from "@/app/atoms";

export function DatesSection() {
  const [day, setDay] = useState<string | null>(null);
  const [dayRange, setDayRange] = useState<DateStringRange>({
    from: null,
    to: null,
  });

  return (
    <BoxSurface title="Dates">
      <div className="p-4 flex flex-wrap items-start gap-6">
        <DateSelector label="Created after" value={day} onChange={setDay} className="w-[240px]" />
        <DateSelector
          label="Window"
          range={dayRange}
          onRangeChange={setDayRange}
          hintText="Two clicks pick the ends."
          className="w-[280px]"
        />
        <DatePicker
          selected={day ? new Date(`${day}T00:00:00`) : undefined}
          onSelect={(date) =>
            setDay(
              `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
            )
          }
          className="rounded-[8px] border border-muted bg-elevation-level-2"
        />
      </div>
    </BoxSurface>
  );
}
