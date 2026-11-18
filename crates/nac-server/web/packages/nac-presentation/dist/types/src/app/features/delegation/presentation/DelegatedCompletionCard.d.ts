import type { DelegatedCompletionTurn } from "../../../lib/transcript";
/** A receipt is a historical generation, not the child's current status. */
export declare function DelegatedCompletionCard({ turn, interactive, }: {
    turn: DelegatedCompletionTurn;
    interactive?: boolean;
}): import("react").JSX.Element;
