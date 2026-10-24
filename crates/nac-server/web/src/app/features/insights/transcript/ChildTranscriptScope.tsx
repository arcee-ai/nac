import { useMemo, type ReactNode } from "react";

import { InsightsNavigationProvider } from "@/app/features/insights/InsightsNavigationProvider";
import { TranscriptTurnsContext } from "@/app/features/insights/transcript/transcriptTurns";
import type { TranscriptTurn } from "@/app/lib/transcript";
import type { SessionPanel } from "@/app/lib/routes";

const NO_PANELS: readonly SessionPanel[] = [];
const stayPut = () => {};

/**
 * A child's transcript drawn inside its parent's session page: its rows read
 * the child's own turns instead of the page's, and no jump from them reaches
 * the parent's panels, whose selection belongs to the parent's transcript.
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
  return (
    <InsightsNavigationProvider sessionId={sessionId} panels={NO_PANELS} focusPanel={stayPut}>
      <TranscriptTurnsContext value={source}>{children}</TranscriptTurnsContext>
    </InsightsNavigationProvider>
  );
}
