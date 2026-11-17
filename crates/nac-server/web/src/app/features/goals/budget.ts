import type { SessionGoalRecord } from "@/app/types/api";

/** What a typed token budget accepts: larger values cannot be sent exactly. */
export const GOAL_BUDGET_INPUT_RULE = `a whole number of tokens up to ${Number.MAX_SAFE_INTEGER.toLocaleString("en-US")}`;

/**
 * A typed amount as a whole number of tokens, or null when it is not one. The
 * server owns which amounts are allowed and says so when it refuses one.
 */
export function parseGoalBudget(text: string): number | null {
  const digits = text.replace(/[\s,_]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/** Whether a stored goal still holds the fields an edit was started from. */
export function sameGoalEditableFields(left: SessionGoalRecord, right: SessionGoalRecord): boolean {
  return (
    left.goal_id === right.goal_id &&
    left.objective === right.objective &&
    left.token_budget === right.token_budget
  );
}
