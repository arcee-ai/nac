export interface StickToBottomOptions {
    /**
     * Identity of what is being scrolled. Changing it starts the view over, which
     * matters because the component is reused across sessions: React routes both
     * session URLs to the same element, so nothing here would otherwise unmount.
     */
    resetKey?: string | null;
}
export interface StickToBottom {
    /** The scrolling element. */
    scrollRef: React.RefObject<HTMLDivElement | null>;
    /** Its single child, whose growth is what pins the view. */
    contentRef: React.RefObject<HTMLDivElement | null>;
    /** True when the user is far enough up to warrant offering a way back. */
    showJumpButton: boolean;
    jumpToLatest: () => void;
    /**
     * Glide to the bottom after the user sends. Instant pin on the same commit
     * would cancel this and read as a jump.
     */
    followLatest: (durationMs?: number) => void;
}
/**
 * Keeps a scroll container pinned to its bottom edge as content grows, and
 * lets go the moment the user scrolls up.
 *
 * Growth is detected by observing the content element rather than by watching
 * a dependency, so it also covers the height a markdown block only settles on
 * after its code blocks have laid out. New content is glided onto rather than
 * snapped to, which is what makes a stream read as text arriving instead of as
 * the view ticking down a line at a time. Wheel handling mirrors ArceeFM's
 * `useChatScroll`: upward wheel unsticks immediately so follow-mode yields
 * before the next layout pin.
 *
 * Letting go is deliberately driven by input events rather than by position.
 * Content that shrinks — a finished message re-rendering as one document rather
 * than as the blocks it streamed in — clamps `scrollTop` and is indistinguishable
 * from a scrollbar drag if only the numbers are consulted, which used to abandon
 * follow-mode a hundred pixels short of the end of a stream.
 */
export declare function useStickToBottom({ resetKey }?: StickToBottomOptions): StickToBottom;
