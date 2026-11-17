import { useMemo, useState } from "react";

import {
  keepTurnKeys,
  replyKey,
  type DrawnTurns,
} from "@/app/components/inspector/transcript/turnKeys";
import { displayPromptFromMessageText, invokedSkillNames } from "@/app/lib/format";
import { perfMark, perfTime } from "@/app/lib/perfDebug";
import { buildTranscript, withStreamedOutput, type TranscriptTurn } from "@/app/lib/transcript";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useSessionPermissions } from "@/app/services/queries";

import type { SessionSnapshotResponse, SubmittedUserMessageSnapshot } from "@/app/types/api";

/** Text of the newest user bubble, or null when the chat opens with the model. */
function lastUserText(turns: TranscriptTurn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.kind === "delegated-completion" || turn.kind === "goal-continuation") return null;
    if (turn.kind === "user") return turn.text;
  }
  return null;
}

/** Index of the newest user prompt, drawn or stored; -1 without one. */
function lastPromptIndex(turns: readonly TranscriptTurn[]): number {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].kind === "user") return index;
  }
  return -1;
}

export interface TranscriptModel {
  /** The snapshot's turns with the pending prompt and the live stream folded in. */
  turns: TranscriptTurn[];
  /**
   * The same turns without the stream, which deltas leave untouched — what a
   * row reads its neighbours from, so a delta does not re-render it.
   */
  baseTurns: TranscriptTurn[];
  running: boolean;
  optimisticPrompt: string | null;
  /** The prompt the active run stored, while the session is running. */
  submitted: SubmittedUserMessageSnapshot | null | undefined;
  pendingText: string;
  /** The sent prompt has not reached the snapshot's turns yet. */
  showPending: boolean;
  /** Key of the turn answering the newest prompt, streamed or committed. */
  replyKey: string;
}

interface Drawn extends DrawnTurns {
  sessionId: string;
  built: TranscriptTurn[];
  turns: TranscriptTurn[];
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
    runtimeStore,
  } = useNativeRuntime().stores.runtimeStore;

  const running = useRunning(sessionId);
  const liveThreads = useLiveThreads();
  const finishedToolCalls = useFinishedToolCalls();
  const primaryToolEvents = usePrimaryToolEvents();
  const streamText = useStreamText();
  const streamReasoning = useStreamReasoning();
  const streamSettled = runtimeStore.useStore((state) => state.streamSettled);
  const streamPredatesPrompt = runtimeStore.useStore((state) => state.streamPredatesPrompt);
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
  const built = useMemo(
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
  const windowStart = snapshot?.message_page?.start ?? 0;
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  let current = drawn;
  if (current?.built !== built || current.sessionId !== sessionId) {
    const previous = current?.sessionId === sessionId ? current : null;
    current = {
      sessionId,
      built,
      windowStart,
      turns: keepTurnKeys(built, windowStart, previous),
    };
    setDrawn(current);
  }
  const snapshotTurns = current.turns;

  // Prefer the live active_run copy; fall back to the optimistic prompt set at
  // Send so the bubble is already above the model pill before the round-trip.
  const submitted = running ? snapshot?.active_run?.submitted_user_message : undefined;
  const pendingText = submitted
    ? displayPromptFromMessageText(submitted.content)
    : (optimisticPrompt ?? "");
  // Compared against the last *user* turn rather than the last turn of any
  // kind: everything the run produces lands after the prompt it answers, so
  // once that prompt is in the snapshot the copy is a duplicate no matter how
  // many model turns have piled up on top of it.
  const showPending = Boolean(pendingText && lastUserText(snapshotTurns) !== pendingText);
  // The prompt is drawn under the index it is about to be stored at, so the
  // bubble and the reply under it keep their rows when the snapshot commits it.
  const nextIndex = windowStart + (snapshot?.messages.length ?? 0);
  const baseTurns = useMemo(
    () =>
      showPending
        ? [
            ...snapshotTurns,
            {
              kind: "user" as const,
              key: `user-${nextIndex}`,
              text: pendingText,
              // The optimistic copy is raw typed text; only the stored message
              // can carry an expansion.
              invokedSkills: submitted ? invokedSkillNames(submitted.content) : null,
              messageIndex: nextIndex,
              createdAt: null,
              pending: true as const,
            },
          ]
        : snapshotTurns,
    [snapshotTurns, showPending, nextIndex, pendingText, submitted],
  );
  const reply = replyKey(baseTurns, windowStart);
  // Between Send and the run starting, the buffers still hold the previous
  // run's output. It may add to the turn it came from, but it must not open a
  // turn under the new prompt and read as that prompt's answer, whether the
  // prompt is drawn pending or the snapshot already stores it. `running`
  // cannot tell: a snapshot may report the run before `run_started` arrives,
  // and a short run may end before the snapshot shows its prompt.
  const stale = streamSettled && streamPredatesPrompt;
  const turns = useMemo(() => {
    const stream = { text: streamText, reasoning: streamReasoning, settled: streamSettled };
    const prompt = stale ? lastPromptIndex(baseTurns) : -1;
    if (prompt < 0) return withStreamedOutput(baseTurns, stream, false, reply);
    const before = baseTurns.slice(0, prompt);
    const folded = before.length
      ? withStreamedOutput(before, stream, false, replyKey(before, windowStart))
      : before;
    return folded === before ? baseTurns : [...folded, ...baseTurns.slice(prompt)];
  }, [baseTurns, streamText, streamReasoning, streamSettled, stale, reply, windowStart]);
  perfMark("transcript:turns", {
    fields: { turns: turns.length, streamChars: streamText.length },
    throttleMs: 1000,
  });

  return {
    turns,
    baseTurns,
    running,
    optimisticPrompt,
    submitted,
    pendingText,
    showPending,
    replyKey: reply,
  };
}
