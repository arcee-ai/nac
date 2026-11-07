export interface GoalContinuation {
    goalId: string;
    objective: string;
}
/** The goal and objective of a well-formed continuation message, or null. */
export declare function parseGoalContinuation(content: string | null | undefined): GoalContinuation | null;
/**
 * Whether a message is shaped like any continuation envelope, including one
 * whose body does not parse. Such a message is still control text, never a
 * prompt to show or send again.
 */
export declare function isGoalContinuationEnvelope(content: string | null | undefined): boolean;
