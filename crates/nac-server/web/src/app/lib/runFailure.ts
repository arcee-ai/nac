import type { RunFailure, SessionGoalRecord } from "@/app/types/api";

/** Where a backend that signs in stands after its login was refused. */
export type LoginRecovery = "needed" | "restored";

/** Keep state-preserving recovery distinct from destructive transcript rewind. */
export function failureRecoveryAffordance(
  failure: RunFailure,
  goal: SessionGoalRecord | null | undefined,
  hasOriginalPrompt: boolean,
  login?: LoginRecovery,
): "resume_goal" | "sign_in" | "settings" | "regenerate" | null {
  if (failure.recovery_action === "resume_goal") {
    return goal?.status === "blocked" ? "resume_goal" : null;
  }
  if (failure.recovery_action === "settings") {
    if (!login || failure.kind !== "authentication") return "settings";
    if (login === "needed") return "sign_in";
    return hasOriginalPrompt ? "regenerate" : null;
  }
  if (failure.recovery_action === "regenerate_with_rewind" && hasOriginalPrompt) {
    return "regenerate";
  }
  return null;
}
