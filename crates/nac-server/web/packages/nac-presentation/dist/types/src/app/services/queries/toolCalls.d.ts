/**
 * One call in the transcript. A provider may reuse a call id in a later
 * message, so the call's block key keeps each call's content apart.
 */
export interface ToolCallRef {
    id: string;
    blockKey: string;
}
/**
 * The full arguments and output of one tool call, redacted and size-bounded by
 * the server. A result reaches the store only once its whole batch of
 * parallel calls is done, so an answer without one is asked again until it
 * has one; from then on the content no longer changes and is kept for good. A
 * failure, also of one of those asks, is not retried on its own; the surface
 * that asked offers the retry.
 */
export declare function useToolCallContent(sessionId: string, call: ToolCallRef | null, enabled?: boolean): import("@tanstack/react-query").UseQueryResult<NoInfer<{
    arguments: string;
    arguments_truncated: boolean;
    call_id: string;
    output: string | null;
    output_truncated: boolean;
}>, Error>;
