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
export declare function useToolCallContent(sessionId: string, call: ToolCallRef | null, enabled?: boolean): {
    data: NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }> | undefined;
    error: Error;
    isError: true;
    isPending: false;
    isLoading: false;
    isLoadingError: false;
    isRefetchError: true;
    isSuccess: false;
    isPlaceholderData: false;
    status: "error";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: import("@tanstack/query-core").RefetchOptions) => Promise<import("@tanstack/query-core").QueryObserverResult<NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }>>;
} | {
    data: NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }> | undefined;
    error: null;
    isError: false;
    isPending: false;
    isLoading: false;
    isLoadingError: false;
    isRefetchError: false;
    isSuccess: true;
    isPlaceholderData: false;
    status: "success";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: import("@tanstack/query-core").RefetchOptions) => Promise<import("@tanstack/query-core").QueryObserverResult<NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }>>;
} | {
    data: NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }> | undefined;
    error: Error;
    isError: true;
    isPending: false;
    isLoading: false;
    isLoadingError: true;
    isRefetchError: false;
    isSuccess: false;
    isPlaceholderData: false;
    status: "error";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: import("@tanstack/query-core").RefetchOptions) => Promise<import("@tanstack/query-core").QueryObserverResult<NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }>>;
} | {
    data: NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }> | undefined;
    error: null;
    isError: false;
    isPending: true;
    isLoading: true;
    isLoadingError: false;
    isRefetchError: false;
    isSuccess: false;
    isPlaceholderData: false;
    status: "pending";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: import("@tanstack/query-core").RefetchOptions) => Promise<import("@tanstack/query-core").QueryObserverResult<NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }>>;
} | {
    data: NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }> | undefined;
    error: null;
    isError: false;
    isPending: true;
    isLoadingError: false;
    isRefetchError: false;
    isSuccess: false;
    isPlaceholderData: false;
    status: "pending";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isLoading: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: import("@tanstack/query-core").RefetchOptions) => Promise<import("@tanstack/query-core").QueryObserverResult<NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }>>;
} | {
    data: NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }> | undefined;
    isError: false;
    error: null;
    isPending: false;
    isLoading: false;
    isLoadingError: false;
    isRefetchError: false;
    isSuccess: true;
    isPlaceholderData: true;
    status: "success";
    dataUpdatedAt: number;
    errorUpdatedAt: number;
    failureCount: number;
    failureReason: Error | null;
    errorUpdateCount: number;
    isFetched: boolean;
    isFetchedAfterMount: boolean;
    isFetching: boolean;
    isInitialLoading: boolean;
    isPaused: boolean;
    isRefetching: boolean;
    isStale: boolean;
    isEnabled: boolean;
    refetch: (options?: import("@tanstack/query-core").RefetchOptions) => Promise<import("@tanstack/query-core").QueryObserverResult<NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }>, Error>>;
    fetchStatus: import("@tanstack/query-core").FetchStatus;
    promise: Promise<NoInfer<{
        arguments: string;
        arguments_truncated: boolean;
        call_id: string;
        output: string | null;
        output_truncated: boolean;
    }>>;
};
