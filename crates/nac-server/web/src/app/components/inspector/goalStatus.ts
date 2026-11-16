import type { GoalStatus, SessionGoalRecord } from "@/app/types/api";

/** A goal status as a label: `budget_limited` reads "Budget limited". */
export function statusLabel(status: GoalStatus): string {
  const label = status.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The accessible name of the control that opens the goal editor. */
export function goalActionLabel(goal: SessionGoalRecord | null | undefined): string {
  return goal ? `Edit goal: ${statusLabel(goal.status)}` : "Set durable goal";
}
