import { useQuery } from "@tanstack/react-query";

import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { queryKeys } from "@/app/services/queries/keys";

/**
 * The full arguments and output of one tool call, redacted and size-bounded by
 * the server. Ask only for a settled call: its content no longer changes, so
 * the answer is kept for good. A failure is not retried on its own; the
 * surface that asked offers the retry.
 */
export function useToolCallContent(sessionId: string, callId: string | null, enabled = true) {
  const { api } = useNativeRuntime();

  return useQuery({
    queryKey: queryKeys.toolCallContent(sessionId, callId ?? ""),
    queryFn: ({ signal }) => api.getToolCallContent(sessionId, callId!, signal),
    enabled: enabled && callId != null,
    staleTime: Infinity,
    retry: false,
  });
}
