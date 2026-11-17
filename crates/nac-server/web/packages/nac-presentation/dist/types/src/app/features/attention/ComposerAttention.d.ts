export interface ComposerAttentionProps {
    sessionId: string;
    /** Read this session's permission broker (direct behaviors only). */
    permissions: boolean;
    /** Read this session's task questions. */
    questions: boolean;
    requesterLabel?: string;
    /** Hoist owned child agents' requests into this card. */
    includeChildren?: boolean;
    /** A child's retries go through its owning primary. */
    parentSessionId?: string;
    poll?: boolean;
    /** The permission sheet is open and presents the same requests. */
    hidden?: boolean;
    /** Opens the full permission sheet on this request. */
    onReviewAll?: (requestKey: string | null) => void;
    /** The last request was denied: hand the keyboard back to the composer. */
    onDenied?: () => void;
}
/**
 * The single stacked card above the composer: whatever needs the user, one at
 * a time and oldest first — permission requests (a child's included), then
 * agent questions as they arrive. Approvals cannot be dismissed, only
 * answered; the replies are the broker's own and stay fail-closed.
 */
export declare function ComposerAttention({ sessionId, permissions, questions: questionsEnabled, requesterLabel, includeChildren, parentSessionId, poll, hidden, onReviewAll, onDenied, }: ComposerAttentionProps): import("react").JSX.Element | null;
