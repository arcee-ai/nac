import { useMemo } from "react";

import { displayPromptFromMessageText, invokedSkillNames } from "@/app/lib/format";
import { perfMark, perfTime } from "@/app/lib/perfDebug";
import {
  buildTranscript,
  withStreamedOutput,
  STREAMING_TURN_KEY,
  type TranscriptTurn,
} from "@/app/lib/transcript";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useSessionPermissions } from "@/app/services/queries";

import type { SessionSnapshotResponse, SubmittedUserMessageSnapshot } from "@/app/types/api";

/** Text of the newest user bubble, or null when the chat opens with the model. */
function lastUserText(turns: TranscriptTurn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.kind === "delegated-completion") return null;
    if (turn.kind === "user") return turn.text;
  }
  return null;
}

export interface TranscriptModel {
  /** The snapshot's turns with the live stream folded into them. */
  turns: TranscriptTurn[];
  /** The snapshot half alone, which stream deltas leave untouched. */
  snapshotTurns: TranscriptTurn[];
  running: boolean;
  optimisticPrompt: string | null;
  /** The prompt the active run stored, while the session is running. */
  submitted: SubmittedUserMessageSnapshot | null | undefined;
  pendingText: string;
  pendingSkills: string[] | null;
  /** The sent prompt has not reached the snapshot's turns yet. */
  showPending: boolean;
  /** The last turn exists only as a stream answering the pending prompt. */
  streamingTurn: boolean;
}

/**
 * The turns a session's chat shows: the snapshot's, plus whatever the live
 * stream and the prompt sent ahead of the snapshot add to them.
 */
export function useTranscriptModel(
  sessionId: string,
  snapshot: SessionSnapshotResponse | null,
): TranscriptModel {
  const {
    useStreamText,
    useStreamReasoning,
    useRunning,
    useOptimisticUserPrompt,
    useLiveThreads,
    usePrimaryToolEvents,
    useFinishedToolCalls,
  } = useNativeRuntime().stores.runtimeStore;

  const running = useRunning(sessionId);
  const liveThreads = useLiveThreads();
  const finishedToolCalls = useFinishedToolCalls();
  const primaryToolEvents = usePrimaryToolEvents();
  const streamText = useStreamText();
  const streamReasoning = useStreamReasoning();
  const optimisticPrompt = useOptimisticUserPrompt();
  const direct =
    snapshot?.metadata.behavior === "direct" ||
    snapshot?.metadata.behavior === "direct-with-orchestrator";
  const { data: permissions } = useSessionPermissions(sessionId, direct);
  const pendingPermissionCallIds = useMemo(
    () =>
      new Set(
        (permissions?.requests ?? [])
          .map((request) => request.call_id)
          .filter((callId): callId is string => Boolean(callId)),
      ),
    [permissions?.requests],
  );

  // Split so a delta rebuilds only the turn it lands in: the snapshot half is
  // untouched between refetches, and the stream half hands its earlier turns
  // straight back, which is what keeps the memoized rows from re-rendering.
  const snapshotTurns = useMemo(
    () =>
      perfTime("buildTranscript", () =>
        buildTranscript(
          snapshot,
          liveThreads,
          finishedToolCalls,
          primaryToolEvents,
          pendingPermissionCallIds,
        ),
      ),
    [snapshot, liveThreads, finishedToolCalls, primaryToolEvents, pendingPermissionCallIds],
  );
  // Prefer the live active_run copy; fall back to the optimistic prompt set at
  // Send so the bubble is already above the model pill before the round-trip.
  const submitted = running ? snapshot?.active_run?.submitted_user_message : undefined;
  const pendingText = submitted
    ? displayPromptFromMessageText(submitted.content)
    : (optimisticPrompt ?? "");
  // The optimistic copy is raw typed text; only the stored message can carry
  // an expansion.
  const pendingSkills = submitted ? invokedSkillNames(submitted.content) : null;
  // Compared against the last *user* turn rather than the last turn of any
  // kind: everything the run produces lands after the prompt it answers, so
  // once that prompt is in the snapshot the copy is a duplicate no matter how
  // many model turns have piled up on top of it.
  const showPending = Boolean(pendingText && lastUserText(snapshotTurns) !== pendingText);
  const turns = useMemo(
    () =>
      withStreamedOutput(
        snapshotTurns,
        { text: streamText, reasoning: streamReasoning },
        showPending,
      ),
    [snapshotTurns, streamText, streamReasoning, showPending],
  );
  // A stream that had to open a turn of its own is answering a prompt the
  // snapshot has not caught up with, so the optimistic bubble moves into the
  // list with it instead of being rendered under the whole thing.
  const streamingTurn = showPending && turns[turns.length - 1]?.key === STREAMING_TURN_KEY;
  perfMark("transcript:turns", {
    fields: { turns: turns.length, streamChars: streamText.length },
    throttleMs: 1000,
  });

  return {
    turns,
    snapshotTurns,
    running,
    optimisticPrompt,
    submitted,
    pendingText,
    pendingSkills,
    showPending,
    streamingTurn,
  };
}
