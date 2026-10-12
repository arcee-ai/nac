export interface DelegatedPreviewStream {
    text: string;
    reasoning: string;
    /** True from `run_started` until the run settles, and while deltas are arriving. */
    running: boolean;
}
/**
 * Live model output for a subagent previewed from its parent.
 *
 * The parent's runtime store belongs to the open session. This subscription
 * keeps the child's deltas and snapshot refreshes on the side, so a run in the
 * preview can paint as it is produced without rewriting the parent transcript.
 */
export declare function useDelegatedPreviewStream(sessionId: string | null): DelegatedPreviewStream;
