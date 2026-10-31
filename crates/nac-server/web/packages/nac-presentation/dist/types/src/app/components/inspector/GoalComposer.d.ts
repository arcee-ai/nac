interface GoalComposerProps {
    sessionId: string;
    open: boolean;
    mobile: boolean;
    onClose: () => void;
}
/** One edit lifetime across the inline and phone presentations. */
export declare function GoalComposer({ sessionId, open, mobile, onClose }: GoalComposerProps): import("react").JSX.Element;
interface GoalFlagProps {
    sessionId: string;
    compact: boolean;
    onOpen: () => void;
}
/** Flag beside Send while the field rests. Opens the goal editor. */
export declare function GoalFlag({ sessionId, compact, onOpen }: GoalFlagProps): import("react").JSX.Element;
export {};
