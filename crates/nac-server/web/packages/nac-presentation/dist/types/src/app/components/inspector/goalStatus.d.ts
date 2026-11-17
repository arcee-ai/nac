import { goalStatusLabel } from "../../features/goals/status";
import type { SessionGoalRecord } from "../../types/api";
/** A goal status as a label: `budget_limited` reads "Budget limited". */
export declare const statusLabel: typeof goalStatusLabel;
/** The accessible name of the control that opens the goal editor. */
export declare function goalActionLabel(goal: SessionGoalRecord | null | undefined): string;
