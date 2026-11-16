/**
 * Always mounted so show/hide can animate opacity + translate like ArceeFM's
 * "Last messages" control — unmounting would skip the exit.
 */
export declare const JumpToLatest: import("react").MemoExoticComponent<({ visible, onJump, }: {
    visible: boolean;
    onJump: () => void;
}) => import("react").JSX.Element>;
