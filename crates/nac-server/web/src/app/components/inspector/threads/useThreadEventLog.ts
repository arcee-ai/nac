import { useMemo } from "react";

import { mergeThreadEventPages } from "@/app/lib/threadLog";
import { useThreadEventPages } from "@/app/services/queries";

import type { AgentEvent, SessionSnapshotResponse } from "@/app/types/api";

export interface ThreadEventLog {
  /** The fetched history once a page arrives, the snapshot's events until then. */
  events: AgentEvent[] | undefined;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadingInitial: boolean;
  historyError: string | null;
  loadOlder: () => Promise<void>;
  retry: () => Promise<void>;
}

/** One thread's persisted events, loaded a page at a time back from the newest. */
export function useThreadEventLog(
  snapshot: SessionSnapshotResponse | null,
  threadName: string | null,
): ThreadEventLog {
  const sessionId = snapshot?.metadata.session_id ?? "";
  const eventPages = useThreadEventPages(snapshot ? sessionId : null, threadName);
  const pagedEvents = useMemo(
    () => (eventPages.data ? mergeThreadEventPages(eventPages.data.pages) : undefined),
    [eventPages.data],
  );
  return {
    events:
      pagedEvents ?? (threadName === null ? undefined : snapshot?.thread_events?.[threadName]),
    hasOlder: Boolean(eventPages.hasNextPage),
    loadingOlder: eventPages.isFetchingNextPage,
    loadingInitial: eventPages.isPending,
    historyError: eventPages.error instanceof Error ? eventPages.error.message : null,
    loadOlder: async () => {
      await eventPages.fetchNextPage();
    },
    retry: async () => {
      if (eventPages.data) await eventPages.fetchNextPage();
      else await eventPages.refetch();
    },
  };
}
