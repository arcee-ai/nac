import { parseStoreTime } from "@/app/lib/format";
import type { SessionStatus } from "@/app/lib/sessionStatus";
import type { TraditionalChildStatus } from "@/app/types/api";

/** A delegated record's lifecycle on the one status ladder every list shares. */
export function subagentDotStatus(status: TraditionalChildStatus): SessionStatus {
  switch (status) {
    case "running":
      return "working";
    case "failed":
    case "interrupted":
      return "failed";
    case "completed":
      return "done";
    default:
      return "idle";
  }
}

const STATE_LABEL: Record<TraditionalChildStatus, string> = {
  idle: "Idle",
  running: "Working",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

/** "now", "4m", "3h", "2d": how long ago the record last changed. */
export function compactAge(updatedAt: string, now: number): string {
  const then = parseStoreTime(updatedAt);
  if (!Number.isFinite(then) || then <= 0) return "";
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/** The row's one line of state: its kind, where it is, and the latest word from it. */
export function subagentStateLine({
  status,
  background,
  detail,
}: {
  status: TraditionalChildStatus;
  background: boolean;
  detail: string | null;
}): string {
  const first =
    detail
      ?.split("\n")
      .find((line) => line.trim())
      ?.trim() ?? null;
  return [
    STATE_LABEL[status],
    status === "running" && background ? "background" : null,
    status !== "running" ? first : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
