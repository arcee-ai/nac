import { useEffect, useRef } from "react";

import { cn } from "@/app/lib/cn";
import { useLiveEvents, useStreamStatus } from "@/app/store/runtimeStore";
import type { RuntimeEventKind } from "@/app/store/runtimeStore";
import type { StreamStatus } from "@/app/services/eventStream";

const KIND_COLOR: Record<RuntimeEventKind | "local", string> = {
  run: "text-accent-primary",
  tool: "text-basic-secondary",
  thread: "text-info-primary",
  assistant: "text-basic-primary",
  steering: "text-info-primary",
  compaction: "text-basic-tertiary",
  error: "text-error-primary",
  local: "text-warning-primary",
};

const STATUS: Record<StreamStatus, { dot: string; label: string }> = {
  live: { dot: "text-success-primary", label: "Live" },
  connecting: { dot: "text-warning-primary", label: "Connecting…" },
  reconnecting: { dot: "text-warning-primary", label: "Reconnecting…" },
  error: { dot: "text-error-primary", label: "Stream unavailable" },
  idle: { dot: "text-basic-muted", label: "Idle" },
};

/**
 * Live event log fed by the SSE stream plus client-side events (submit, cancel).
 * The header reflects the connection status.
 */
export function EventsView() {
  const events = useLiveEvents();
  const status = useStreamStatus();
  const ref = useRef<HTMLDivElement>(null);
  const meta = STATUS[status];

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-primary shrink-0">
        <span className="tag-label text-basic-muted">Live events</span>
        <span className={cn("text-micro flex items-center gap-1", meta.dot)}>
          <span aria-hidden="true">●</span> {meta.label}
        </span>
      </div>
      <div
        ref={ref}
        className="flex-1 min-h-0 overflow-auto p-3 font-mono text-micro flex flex-col gap-1 [&>*]:shrink-0"
      >
        {events.length === 0 ? (
          <div className="text-basic-muted">
            No events yet. Send a prompt to see the stream.
          </div>
        ) : (
          events.map((event, index) => (
            <div
              key={`${event.seq ?? "local"}-${index}`}
              className={cn(
                "whitespace-pre-wrap break-words",
                KIND_COLOR[event.local ? "local" : event.kind],
              )}
            >
              <span className="text-basic-muted">
                {event.local ? "•" : `#${event.seq ?? "—"}`}
              </span>{" "}
              {event.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
