import type { SessionGoalRecord } from "../../types/api";
/** What a typed token budget accepts: larger values cannot be sent exactly. */
export declare const GOAL_BUDGET_INPUT_RULE: string;
/**
 * A typed amount as a whole number of tokens, or null when it is not one. The
 * server owns which amounts are allowed and says so when it refuses one.
 */
export declare function parseGoalBudget(text: string): number | null;
/** Whether a stored goal still holds the fields an edit was started from. */
export declare function sameGoalEditableFields(left: SessionGoalRecord, right: SessionGoalRecord): boolean;
