interface GoalFlagProps {
    sessionId: string;
    className?: string;
    onOpen: () => void;
}
/** Flag inside the message field. Opens the inline goal editor. */
export declare function GoalFlag({ sessionId, className, onOpen }: GoalFlagProps): import("react").JSX.Element;
interface GoalEditorProps {
    sessionId: string;
    onClose: () => void;
}
/**
 * Inline durable-goal editor that replaces the message field. The token budget
 * switch off means no limit; on means the slider value.
 */
export declare function GoalEditor({ sessionId, onClose }: GoalEditorProps): import("react").JSX.Element;
export {};
