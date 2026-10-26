import { useQuery } from "@tanstack/react-query";

import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { queryKeys } from "@/app/services/queries/keys";

/** How often an answer without a result asks again. */
const RESULT_POLL_MS = 2_000;

/**
 * The full arguments and output of one tool call, redacted and size-bounded by
 * the server. A result reaches the store only once its whole batch of
 * parallel calls is done, so an answer without one is asked again until it
 * has one; from then on the content no longer changes and is kept for good. A
 * failure is not retried on its own; the surface that asked offers the retry.
 */
export function useToolCallContent(sessionId: string, callId: string | null, enabled = true) {
  const { api } = useNativeRuntime();

  return useQuery({
    queryKey: queryKeys.toolCallContent(sessionId, callId ?? ""),
    queryFn: ({ signal }) => api.getToolCallContent(sessionId, callId!, signal),
    enabled: enabled && callId != null,
    staleTime: (query) => (query.state.data?.output === null ? 0 : Infinity),
    refetchInterval: (query) => (query.state.data?.output === null ? RESULT_POLL_MS : false),
    retry: false,
  });
}
