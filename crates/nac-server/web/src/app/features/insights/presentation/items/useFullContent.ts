import { useState } from "react";

import { InsightItemCodeDisplayerState } from "@/app/atoms";
import { useToolCallContent } from "@/app/services/queries/toolCalls";

/**
 * "Show full" over one call's content: Loading until the server answers, then
 * Expanded. "Hide" keeps the answer, so showing it again is instant; a failed
 * load returns to Default, where "Show full" retries it. A result reaches the
 * store only once the call's whole batch of parallel calls is done, so a view
 * of the output stays Loading until the answer has one.
 */
export function useFullContent(sessionId: string, callId: string | null, needsOutput: boolean) {
  const [open, setOpen] = useState(false);
  const query = useToolCallContent(sessionId, callId, open);
  const failed = open && query.isError && !query.isFetching;
  const data = open ? query.data : undefined;
  const content = data && (!needsOutput || data.output !== null) ? data : undefined;
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
