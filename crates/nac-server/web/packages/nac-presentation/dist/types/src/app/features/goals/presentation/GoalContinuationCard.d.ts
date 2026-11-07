import type { GoalContinuationTurn } from "../../../lib/transcript";
/**
 * Where NAC started a run for a durable goal: the objective the user wrote and
 * the goal it belongs to, in place of the control prompt the model reads. The
 * status is the durable goal's current one; a cleared or replaced goal is no
 * longer the session's goal and says so.
 */
export declare function GoalContinuationCard({ sessionId, turn, }: {
    sessionId: string;
    turn: GoalContinuationTurn;
}): import("react").JSX.Element;
