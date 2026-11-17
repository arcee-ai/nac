import { goalStatusLabel } from "@/app/features/goals/status";
import type { SessionGoalRecord } from "@/app/types/api";

/** A goal status as a label: `budget_limited` reads "Budget limited". */
export const statusLabel = goalStatusLabel;

/** The accessible name of the control that opens the goal editor. */
export function goalActionLabel(goal: SessionGoalRecord | null | undefined): string {
  return goal ? `Edit goal: ${statusLabel(goal.status)}` : "Set durable goal";
}
