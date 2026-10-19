import type { RunFailure, SessionGoalRecord } from "../types/api";
/** Where a backend that signs in stands after its login was refused. */
export type LoginRecovery = "needed" | "restored";
/** Keep state-preserving recovery distinct from destructive transcript rewind. */
export declare function failureRecoveryAffordance(failure: RunFailure, goal: SessionGoalRecord | null | undefined, hasOriginalPrompt: boolean, login?: LoginRecovery): "resume_goal" | "sign_in" | "settings" | "regenerate" | null;
