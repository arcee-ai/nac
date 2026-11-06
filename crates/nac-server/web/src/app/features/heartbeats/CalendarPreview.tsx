import type { HeartbeatCalendarPreview } from "@/app/types/api";

export function CalendarPreview({ preview }: { preview: HeartbeatCalendarPreview }) {
  return (
    <section aria-label="Upcoming calendar checks" className="flex flex-col gap-2">
      <p className="label-small">Times in {preview.calendar.zone}</p>
      <ol className="flex flex-col gap-2">
        {preview.occurrences.map((point) => (
          <li key={point.due_ms} className="flex flex-col">
            <span>
              {point.local.replace("T", " ")} · {preview.calendar.zone}
            </span>
            <span className="text-basic-muted">UTC {point.utc}</span>
          </li>
        ))}
      </ol>
      <p className="text-basic-muted">
        Missing wall times are skipped. Repeated wall times run once, at the first occurrence.
      </p>
    </section>
  );
}
