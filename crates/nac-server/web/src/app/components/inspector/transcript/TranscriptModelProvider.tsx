import { useMemo, type ReactNode } from "react";

import { TranscriptModelContext } from "@/app/components/inspector/transcript/TranscriptModelContext";
import { useTranscriptModel } from "@/app/components/inspector/transcript/useTranscriptModel";
import { TranscriptTurnsContext } from "@/app/features/insights/transcript/transcriptTurns";
import type { SessionSnapshotResponse } from "@/app/types/api";

/**
 * Derives the session's transcript model once for the whole page, so the chat
 * and Insights read the same turns. Its own component: stream deltas re-render
 * it and the readers of the model, not the page that renders it — nor the rows,
 * which read their neighbours from the turns the stream leaves alone.
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
  const source = useMemo(
    () => ({ sessionId, turns: model.baseTurns }),
    [sessionId, model.baseTurns],
  );
  return (
    <TranscriptModelContext.Provider value={model}>
      <TranscriptTurnsContext value={source}>{children}</TranscriptTurnsContext>
    </TranscriptModelContext.Provider>
  );
}
