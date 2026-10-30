interface GoalFlagProps {
    sessionId: string;
    compact: boolean;
    className?: string;
    onOpen: () => void;
}
/** Flag at the end of the message pill. Opens the inline goal editor. */
export declare function GoalFlag({ sessionId, compact, className, onOpen, }: GoalFlagProps): import("react").JSX.Element;
interface GoalEditorProps {
    sessionId: string;
    compact: boolean;
    onClose: () => void;
}
/**
 * Inline durable-goal editor that stands in for the message field: the goal
 * card above, the objective in the pill. The token budget switch off means no
 * limit and hides the amount; on means the typed amount, which the slider can
 * also set up to its convenience maximum. An update leaves the budget alone
 * until the user changes it, so a stored figure the slider cannot hold
 * survives an objective edit. Edits are versioned against the goal the editor
 * loaded: if its objective or budget changed elsewhere, the server rejects the
 * stale edit instead of overwriting it.
 */
export declare function GoalEditor({ sessionId, compact, onClose }: GoalEditorProps): import("react").JSX.Element;
export {};
