import type { RunFailure, SessionGoalRecord } from "@/app/types/api";

/** Keep state-preserving recovery distinct from destructive transcript rewind. */
export function failureRecoveryAffordance(
  failure: RunFailure,
  goal: SessionGoalRecord | null | undefined,
  hasOriginalPrompt: boolean,
): "resume_goal" | "settings" | "regenerate" | null {
  if (failure.recovery_action === "resume_goal") {
    return goal?.status === "blocked" ? "resume_goal" : null;
  }
  if (failure.recovery_action === "settings") return "settings";
  if (failure.recovery_action === "regenerate_with_rewind" && hasOriginalPrompt) {
    return "regenerate";
  }
  return null;
}
