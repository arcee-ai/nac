import { cn } from "@/app/lib/cn";
import { formatSeconds } from "@/app/lib/format";
import {
  ToolCallLabelState,
  type SegmentDisplayConfig,
} from "@/app/lib/agentSegments";

export function ToolCallLabel({
  config,
  state = ToolCallLabelState.Default,
  durationMs,
  className,
}: {
  config: SegmentDisplayConfig;
  state?: ToolCallLabelState;
  durationMs?: number | null;
  className?: string;
}) {
  const isActive = state === ToolCallLabelState.Active;
  if (isActive) {
    return (
      <div className={cn("flex items-center gap-2 min-w-0", className)}>
        <span className="truncate min-w-0 text-shimmer-accent label-small">
          {config.inProgressLabel}
        </span>
      </div>
    );
  }
  const duration = formatSeconds(durationMs);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-accent-primary shrink-0 whitespace-nowrap label-small">
        {config.regularLabel}
        {duration ? `, ${duration}` : ""}
      </span>
    </div>
  );
}
