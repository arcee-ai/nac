import { useState } from "react";

import { InsightItemCodeDisplayerState } from "@/app/atoms";
import { useToolCallContent } from "@/app/services/queries/toolCalls";

/**
 * "Show full" over one call's content: Loading until the server answers, then
 * Expanded. "Hide" keeps the answer, so showing it again is instant; a failed
 * load returns to Default, where "Show full" retries it.
 */
export function useFullContent(sessionId: string, callId: string | null) {
  const [open, setOpen] = useState(false);
  const query = useToolCallContent(sessionId, callId, open);
  const failed = open && query.isError && !query.isFetching;
  const content = open ? query.data : undefined;
  let state = InsightItemCodeDisplayerState.Default;
  if (content) state = InsightItemCodeDisplayerState.Expanded;
  else if (open && !failed) state = InsightItemCodeDisplayerState.Loading;
  return {
    state,
    content,
    failed,
    showFull: () => {
      if (failed) void query.refetch();
      setOpen(true);
    },
    hide: () => setOpen(false),
  };
}
