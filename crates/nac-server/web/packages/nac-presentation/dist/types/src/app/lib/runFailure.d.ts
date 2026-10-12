import type { RunFailure, SessionGoalRecord } from "../types/api";
/** Keep state-preserving recovery distinct from destructive transcript rewind. */
export declare function failureRecoveryAffordance(failure: RunFailure, goal: SessionGoalRecord | null | undefined, hasOriginalPrompt: boolean): "resume_goal" | "settings" | "regenerate" | null;
