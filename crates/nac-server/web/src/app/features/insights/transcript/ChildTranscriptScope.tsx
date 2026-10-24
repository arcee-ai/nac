import { useMemo, type ReactNode } from "react";

import { TranscriptTurnsContext } from "@/app/features/insights/transcript/transcriptTurns";
import type { TranscriptTurn } from "@/app/lib/transcript";

/**
 * A child's transcript drawn inside its parent's session page: its rows read
 * the child's own turns instead of the page's.
 */
export function ChildTranscriptScope({
  sessionId,
  turns,
  children,
}: {
  sessionId: string;
  /** The child's snapshot turns, without the stream folded in. */
  turns: readonly TranscriptTurn[];
  children: ReactNode;
}) {
  const source = useMemo(() => ({ sessionId, turns }), [sessionId, turns]);
  return <TranscriptTurnsContext value={source}>{children}</TranscriptTurnsContext>;
}
