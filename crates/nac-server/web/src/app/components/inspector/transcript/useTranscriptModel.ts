import { useMemo, useState } from "react";

import {
  keepTurnKeys,
  replyKey,
  type DrawnTurns,
} from "@/app/components/inspector/transcript/turnKeys";
import { displayPromptFromMessageText, invokedSkillNames } from "@/app/lib/format";
import { perfMark, perfTime } from "@/app/lib/perfDebug";
import { promptCommitCovers } from "@/app/lib/promptCommitEvidence";
import { buildTranscript, withStreamedOutput, type TranscriptTurn } from "@/app/lib/transcript";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useSessionPermissions } from "@/app/services/queries";

import type { SessionSnapshotResponse, SubmittedUserMessageSnapshot } from "@/app/types/api";

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
  optimisticPromptToken: number | null;
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
    usePrimaryToolEvents,
    runtimeStore,
    runtimeIdentity,
    captureRuntimeActivation,
  } = useNativeRuntime().stores.runtimeStore;

  const running = useRunning(sessionId);
  const primaryToolEvents = usePrimaryToolEvents();
  const streamText = useStreamText();
  const streamReasoning = useStreamReasoning();
  const streamSettled = runtimeStore.useStore((state) => state.streamSettled);
  const streamPredatesPrompt = runtimeStore.useStore((state) => state.streamPredatesPrompt);
  const streamRunId = runtimeStore.useStore((state) => state.streamRunId);
  const streamIdentityEpoch = runtimeStore.useStore((state) => state.streamIdentityEpoch);
  const optimisticPrompt = useOptimisticUserPrompt();
  const optimisticRunId = runtimeStore.useStore((state) => state.optimisticPromptRunId);
  const optimisticPromptToken = runtimeStore.useStore((state) => state.optimisticPromptToken);
  const optimisticPromptEpoch = runtimeStore.useStore((state) => state.optimisticPromptEpoch);
  const dismissedPromptRunIds = runtimeStore.useStore((state) => state.dismissedPromptRunIds);
  const direct = snapshot?.metadata.behavior === "direct";
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
        buildTranscript(snapshot, primaryToolEvents, pendingPermissionCallIds),
      ),
    [snapshot, primaryToolEvents, pendingPermissionCallIds],
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

  // Prefer the live active_run copy; fall back to the optimistic prompt set at
  // Send so the bubble is already above the model pill before the round-trip.
  const submittedMessage = running ? snapshot?.active_run?.submitted_user_message : undefined;
  const submitted =
    submittedMessage?.run_id && dismissedPromptRunIds.includes(submittedMessage.run_id)
      ? undefined
      : submittedMessage;
  const pendingText =
    optimisticPrompt ?? (submitted ? displayPromptFromMessageText(submitted.content) : "");
  // Compared against the last *user* turn rather than the last turn of any
  // kind: everything the run produces lands after the prompt it answers, so
  // once that prompt is in the snapshot the copy is a duplicate no matter how
  // many model turns have piled up on top of it.
  const pendingRunId = optimisticPrompt != null ? optimisticRunId : submitted?.run_id;
  const provesCurrentPrompt = promptCommitCovers(snapshot, pendingRunId, pendingText);
  const showPending = Boolean(pendingText && !provesCurrentPrompt);
  // Use a separate namespace so a committed row cannot collide with the
  // provisional live reply while the snapshot is waiting for its receipt.
  const [savedProvisional, setProvisional] = useState<{
    runtime: typeof runtimeStore;
    isActive: () => boolean;
    sessionId: string;
    token: number;
    epoch: number;
    key: string;
    runId: string | null;
    text: string;
  } | null>(null);
  let provisional = savedProvisional;
  if (
    provisional?.runtime !== runtimeStore ||
    (provisional != null && !provisional.isActive()) ||
    provisional?.sessionId !== sessionId ||
    (optimisticPromptToken != null && provisional.token !== optimisticPromptToken)
  ) {
    provisional = null;
  }
  if (
    showPending &&
    optimisticPrompt != null &&
    optimisticPromptToken != null &&
    runtimeStore.getState().sessionId === sessionId
  ) {
    if (!provisional) {
      provisional = {
        runtime: runtimeStore,
        isActive: captureRuntimeActivation(sessionId),
        sessionId,
        token: optimisticPromptToken,
        epoch: optimisticPromptEpoch ?? -1,
        text: optimisticPrompt,
        key: JSON.stringify(["pending-reply", runtimeIdentity, sessionId, optimisticPromptToken]),
        runId: optimisticRunId,
      };
    } else if (optimisticRunId && provisional.runId !== optimisticRunId) {
      provisional = { ...provisional, runId: optimisticRunId };
    }
  }
  if (provisional !== savedProvisional) setProvisional(provisional);
  const proofIndex = snapshot?.committed_prompt?.canonical_index;
  const promptPosition = lastPromptIndex(current.turns);
  const provenRun = provisional?.runId;
  const last = current.turns.at(-1);
  const followsPrompt =
    promptPosition === current.turns.length - 1 ||
    (promptPosition === current.turns.length - 2 && last?.kind === "model");
  const canTransfer =
    provenRun &&
    !dismissedPromptRunIds.includes(provenRun) &&
    (optimisticPromptToken == null || optimisticRunId === provenRun) &&
    streamRunId === provenRun &&
    provisional?.epoch === streamIdentityEpoch &&
    promptCommitCovers(snapshot, provenRun, provisional?.text) &&
    !streamPredatesPrompt &&
    followsPrompt &&
    proofIndex === current.turns[promptPosition]?.messageIndex;
  const provisionalKey = canTransfer ? provisional?.key : null;
  // Transfer only while this very snapshot proves the prompt and only to the
  // immediately following model turn. A later unproven snapshot may have been
  // rewritten, so it cannot inherit this identity.
  const snapshotTurns = useMemo(
    () =>
      provisionalKey &&
      promptPosition === current.turns.length - 2 &&
      last?.kind === "model" &&
      last.key !== provisionalKey
        ? [...current.turns.slice(0, -1), { ...last, key: provisionalKey }]
        : current.turns,
    [current.turns, last, promptPosition, provisionalKey],
  );
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
  const reply =
    showPending && optimisticPromptToken != null
      ? (provisional?.key ?? replyKey(baseTurns, windowStart))
      : (provisionalKey ?? replyKey(baseTurns, windowStart));
  // Between Send and the run starting, the buffers still hold the previous
  // run's output. It may add to the turn it came from, but it must not open a
  // turn under the new prompt and read as that prompt's answer, whether the
  // prompt is drawn pending or the snapshot already stores it. `running`
  // cannot tell: a snapshot may report the run before `run_started` arrives,
  // and a short run may end before the snapshot shows its prompt.
  const stale = streamSettled && streamPredatesPrompt;
  const turns = useMemo(() => {
    const stream = {
      text: streamText,
      reasoning: streamReasoning,
      settled: streamSettled,
    };
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
    optimisticPromptToken,
    submitted,
    pendingText,
    showPending,
    replyKey: reply,
  };
}
