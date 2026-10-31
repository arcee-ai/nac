import type { DelegatedCompletionTurn } from "../../../lib/transcript";
/**
 * Where a delegated session's result reached its parent: the session's card,
 * opening it in Subagents and linking to its own page. Without `interactive`
 * it is a plain summary. Keep the retained generation's receipt available in
 * either case: navigation can be disabled, and the session preview can show a
 * newer generation than this completion.
 */
export declare function DelegatedCompletionCard({ turn, interactive, }: {
    turn: DelegatedCompletionTurn;
    interactive?: boolean;
}): import("react").JSX.Element;
