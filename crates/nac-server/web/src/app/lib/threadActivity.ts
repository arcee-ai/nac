import type { ActiveThreadDispatchSnapshot } from "@/app/types/api";

export function dispatchControlLabel(
  status: ActiveThreadDispatchSnapshot["status"] | null,
  cancelling: boolean,
  cancelledByRequest: boolean,
): string {
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "cancelled" || cancelledByRequest) return "Cancelled";
  return cancelling ? "Cancelling…" : "Cancel dispatch";
}
