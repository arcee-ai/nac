import type {
  ActionStatus,
  InsightEntry,
  InsightSegment,
} from "@/app/features/insights/model/types";
import type { ToolPresentationStatus } from "@/app/lib/toolPresentation";
import type { ThreadState } from "@/app/lib/transcript";

const TOOL_STATUSES: Record<ToolPresentationStatus, ActionStatus> = {
  pending: "running",
  running: "running",
  "awaiting-approval": "pending",
  success: "ready",
  error: "failed",
  "timed-out": "failed",
  cancelled: "failed",
  interrupted: "failed",
};

const THREAD_STATUSES: Record<ThreadState, ActionStatus> = {
  running: "running",
  pending: "pending",
  done: "ready",
  cancelled: "failed",
  error: "failed",
};

const PRECEDENCE: readonly ActionStatus[] = ["running", "pending", "failed", "ready"];

export function toolActionStatus(status: ToolPresentationStatus): ActionStatus {
  return TOOL_STATUSES[status];
}

export function segmentStatus(segment: InsightSegment): ActionStatus {
  if (segment.kind === "reasoning") return segment.streaming ? "running" : "ready";
  if (segment.kind === "tool" && segment.presentation) {
    return toolActionStatus(segment.presentation.status);
  }
  return segment.pending ? "running" : "ready";
}

/** The status a group of these reports: running, then pending, then failed, else ready. */
export function combineStatuses(statuses: Iterable<ActionStatus>): ActionStatus {
  let rank = PRECEDENCE.length - 1;
  for (const status of statuses) rank = Math.min(rank, PRECEDENCE.indexOf(status));
  return PRECEDENCE[rank];
}

export function entryStatus(entry: InsightEntry): ActionStatus {
  if (entry.kind === "group") return entry.group.status;
  if (entry.kind === "thread") return THREAD_STATUSES[entry.thread.state];
  return entry.status;
}
