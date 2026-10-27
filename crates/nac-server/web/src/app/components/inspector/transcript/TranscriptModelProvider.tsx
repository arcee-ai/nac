import type { ReactNode } from "react";

import { TranscriptModelContext } from "@/app/components/inspector/transcript/TranscriptModelContext";
import { useTranscriptModel } from "@/app/components/inspector/transcript/useTranscriptModel";
import type { SessionSnapshotResponse } from "@/app/types/api";

/**
 * Derives the session's transcript model once for the whole page, so the chat
 * and Insights read the same turns. Its own component: stream deltas re-render
 * it and the readers of the context, not the page that renders it.
 */
export function TranscriptModelProvider({
  sessionId,
  snapshot,
  children,
}: {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  children: ReactNode;
}) {
  const model = useTranscriptModel(sessionId, snapshot);
  return (
    <TranscriptModelContext.Provider value={model}>{children}</TranscriptModelContext.Provider>
  );
}
