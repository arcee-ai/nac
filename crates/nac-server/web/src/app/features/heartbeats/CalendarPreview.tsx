import type { HeartbeatCalendarPreview } from "@/app/types/api";

export function CalendarPreview({ preview }: { preview: HeartbeatCalendarPreview }) {
  return (
    <section
      aria-label="Upcoming calendar checks"
      className="flex flex-col gap-3 rounded-card border border-tertiary px-4 py-3"
    >
      <p className="type-meta text-basic-tertiary">Times in {preview.calendar.zone}</p>
      <ol className="flex flex-col gap-2">
        {preview.occurrences.map((point) => (
          <li key={point.due_ms} className="flex flex-col">
            <span className="type-body-chrome tabular text-basic-primary">
              {point.local.replace("T", " ")} · {preview.calendar.zone}
            </span>
            <span className="type-meta tabular text-basic-muted">UTC {point.utc}</span>
          </li>
        ))}
      </ol>
      <p className="type-meta text-basic-tertiary">
        Missing wall times are skipped. Repeated wall times run once, at the first occurrence.
      </p>
    </section>
  );
}
