interface GoalFlagProps {
    sessionId: string;
    compact: boolean;
    onOpen: () => void;
}
/** Flag beside Send while the field rests. Opens the goal editor. */
export declare function GoalFlag({ sessionId, compact, onOpen }: GoalFlagProps): import("react").JSX.Element;
interface GoalEditorProps {
    sessionId: string;
    onClose: () => void;
}
/**
 * Desktop durable-goal editor that stands in for the message row while the
 * card wears the goal tone: the goal and its token budget above, the objective
 * where the message was, and the goal's own action where Send was.
 */
export declare function GoalEditor({ sessionId, onClose }: GoalEditorProps): import("react").JSX.Element;
interface GoalMobileModalProps {
    sessionId: string;
    open: boolean;
    onClose: () => void;
}
/**
 * The phone's goal editor. The card has no room for the budget beside the
 * objective there, so the flag opens this full-screen dialog instead.
 */
export declare function GoalMobileModal({ sessionId, open, onClose }: GoalMobileModalProps): import("react").JSX.Element;
export {};
