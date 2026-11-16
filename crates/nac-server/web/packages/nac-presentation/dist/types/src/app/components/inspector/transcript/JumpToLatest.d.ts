/**
 * A small round button floating just above the composer that brings the
 * newest message back into view. Always mounted, so showing and hiding can
 * fade and lift instead of blinking in and out.
 */
export declare const JumpToLatest: import("react").MemoExoticComponent<({ visible, onJump, }: {
    visible: boolean;
    onJump: () => void;
}) => import("react").JSX.Element>;
