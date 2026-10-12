/**
 * What the thread was asked to do, on demand from the panel header.
 *
 * The dispatch carries this from the moment the thread starts, so it is the one
 * thing about a running thread that can be read before it has produced
 * anything.
 */
export declare function TaskButton({ action, large, }: {
    action: string;
    /** The phone header, where the touch target and its label are a size up. */
    large?: boolean;
}): import("react").JSX.Element;
/**
 * The same panel from a pill, for the phone's floating view switch — where an
 * underlined label beside two solid pills would read as a stray link rather
 * than as the third control of the set.
 */
export declare function TaskPill({ action }: {
    action: string;
}): import("react").JSX.Element;
/**
 * The same task as a hover preview, for the thread cards in the chat.
 *
 * The card is too small to carry the task and stops being about it the moment
 * the thread answers, so the hint only appears under the pointer. Its preview
 * outlives the pointer leaving the hint: the reader has to travel over a gap to
 * reach the card, and scrolling it means being nowhere near the hint at all.
 */
export declare function TaskPreviewHoverHint({ action, onOpenChange, }: {
    action: string;
    /** Keeps the hint mounted by its owner while the preview is up. */
    onOpenChange?: (open: boolean) => void;
}): import("react").JSX.Element;
