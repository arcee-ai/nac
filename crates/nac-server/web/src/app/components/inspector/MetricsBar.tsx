import { cn } from "@/app/lib/cn";
import {
  formatDurationShort,
  formatRuntime,
  metricsFromSnapshot,
} from "@/app/lib/format";
import { useNow } from "@/app/hooks/useNow";
import type { ManagedSessionSummary, SessionSnapshotResponse } from "@/app/types/api";

function Cell({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="tag-label text-basic-muted">{label}</span>
      <strong
        className={cn(
          "label-small truncate",
          accent ? "text-accent-primary" : "text-basic-primary",
        )}
      >
        {value}
      </strong>
    </div>
  );
}

interface MetricsBarProps {
  snapshot: SessionSnapshotResponse | null;
  entry: ManagedSessionSummary | null;
}

export function MetricsBar({ snapshot, entry }: MetricsBarProps) {
  const metrics = metricsFromSnapshot(snapshot, entry);
  const now = useNow(1000, metrics.active);

  // A live run shows its elapsed time, an idle one the last response duration.
  let run = "idle";
  if (metrics.active) {
    run = metrics.startedAt ? formatRuntime(now - metrics.startedAt) : "running";
  } else if (metrics.lastResponseMs != null) {
    run = formatDurationShort(metrics.lastResponseMs);
  }

  return (
    <section className="grid grid-cols-3 sm:grid-cols-6 gap-x-4 gap-y-2 px-4 py-3 border-b border-primary shrink-0">
      <Cell label="Model" value={metrics.model} />
      <Cell label="Backend" value={metrics.backend} />
      <Cell label="Msgs" value={String(metrics.messages)} />
      <Cell label="Run" value={run} accent={metrics.active} />
      <Cell label="Tokens" value={metrics.tokens} />
      <Cell label="Orch Context" value={metrics.context} />
    </section>
  );
}
