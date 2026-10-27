import { useQuery } from "@tanstack/react-query";

import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { queryKeys } from "@/app/services/queries/keys";

/** How often an answer without a result asks again. */
const RESULT_POLL_MS = 2_000;

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
export function useToolCallContent(sessionId: string, call: ToolCallRef | null, enabled = true) {
  const { api } = useNativeRuntime();

  const query = useQuery({
    queryKey: queryKeys.toolCallContent(sessionId, call?.id ?? "", call?.blockKey ?? ""),
    queryFn: ({ signal }) => api.getToolCallContent(sessionId, call!.id, signal),
    enabled: enabled && call != null,
    staleTime: (query) => (query.state.data?.output === null ? 0 : Infinity),
    refetchInterval: (query) =>
      query.state.status !== "error" && query.state.data?.output === null ? RESULT_POLL_MS : false,
    // Returning to an errored item must leave its explicit Retry in charge.
    retryOnMount: false,
    refetchOnMount: (query) => query.state.status !== "error",
    refetchOnReconnect: (query) => query.state.status !== "error",
    refetchOnWindowFocus: false,
    retry: false,
  });
  // Revalidation can reject an ID that has become ambiguous. The earlier
  // cached answer must not remain visible after that rejection.
  return { ...query, data: query.isError ? undefined : query.data };
}
