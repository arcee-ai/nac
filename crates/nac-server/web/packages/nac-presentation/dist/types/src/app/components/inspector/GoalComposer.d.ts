interface GoalFlagProps {
    sessionId: string;
    compact: boolean;
    className?: string;
    onOpen: () => void;
}
/** Flag at the end of the message pill. Opens the inline goal editor. */
export declare function GoalFlag({ sessionId, compact, className, onOpen }: GoalFlagProps): import("react").JSX.Element;
interface GoalEditorProps {
    sessionId: string;
    compact: boolean;
    onClose: () => void;
}
/**
 * Inline durable-goal editor that stands in for the message field: the goal
 * card above, the objective in the pill. The token budget switch off means no
 * limit; on means the slider value. An update leaves the budget alone until
 * the user changes it, so a stored figure the slider cannot hold survives an
 * objective edit.
 */
export declare function GoalEditor({ sessionId, compact, onClose }: GoalEditorProps): import("react").JSX.Element;
export {};
