import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  MessageBox,
  MessageBoxSize,
  MessageBoxVariant,
} from "@/app/atoms";
import { ActivityAnnouncement } from "@/app/components/inspector/ActivityAnnouncement";
import { ModelMessage } from "@/app/components/inspector/ModelMessage";
import { QueuedMessage } from "@/app/components/inspector/QueuedMessage";
import { UserMessage } from "@/app/components/inspector/UserMessage";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useStickToBottom } from "@/app/hooks/useStickToBottom";
import { ForkModal } from "@/app/components/modals/ForkModal";
import { cn } from "@/app/lib/cn";
import { RevertModal } from "@/app/components/modals/RevertModal";
import {
  displayPromptFromMessageText,
  formatStoreTime,
} from "@/app/lib/format";
import { revisionsByTurn } from "@/app/lib/revisions";
import type { SessionPanel } from "@/app/lib/routes";
import { PerfProfiler } from "@/app/lib/PerfProfiler";
import { perfMark, perfRender, perfTime } from "@/app/lib/perfDebug";
import {
  buildTranscript,
  withStreamedOutput,
  type TranscriptTurn,
} from "@/app/lib/transcript";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useDeleteQueuedRun,
  useEditQueuedRun,
  useRegenerateRun,
  useSubmitRun,
  useWorkspaceRevisions,
} from "@/app/services/queries";
import {
  selectFile,
  selectRevision,
  selectThread,
  selectWorkset,
  useSelectedFile,
  useSelectedRevision,
  useSelectedThreadEpisode,
  useSelectedWorkset,
} from "@/app/store/sessionLayoutStore";
import {
  pushLocalEvent,
  setOptimisticUserPrompt,
  useAdmittedQueuedRunId,
  useActivity,
  useRuntimeThreads,
  useOptimisticUserPrompt,
  useRunError,
  useRunning,
  useStreamReasoning,
  useStreamText,
} from "@/app/store/runtimeStore";
import type { SessionSnapshotResponse } from "@/app/types/api";

interface TranscriptProps {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  /** Which side-panel tab is currently open. */
  panel: SessionPanel;
  /** Brings the matching side panel forward when the chat points at a row. */
  onFocusPanel: (panel: SessionPanel) => void;
  /** Session-level failure (broken config / snapshot fetch), shown in the chat. */
  errorNotice?: {
    message: string;
    action?: { label: string; onClick: () => void };
  } | null;
}

/** Index of the user turn that produced the newest model reply, if any. */
function lastAnsweredUserIndex(turns: TranscriptTurn[]): number | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.kind !== "model") continue;
    for (let prior = index - 1; prior >= 0; prior -= 1) {
      if (turns[prior]?.kind === "user") return prior;
    }
    return null;
  }
  return null;
}

/** Text of the newest user bubble, or null when the chat opens with the model. */
function lastUserText(turns: TranscriptTurn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.kind === "user") return turn.text;
  }
  return null;
}

/**
 * Read-only transcript from the canonical snapshot plus a live typing indicator
 * fed by the SSE runtime store. Follows new content unless the user scrolls up.
 */
export function Transcript({
  sessionId,
  snapshot,
  panel,
  onFocusPanel,
  errorNotice = null,
}: TranscriptProps) {
  const running = useRunning();
  const activity = useActivity();
  const error = useRunError();
  const liveThreads = useRuntimeThreads();
  const streamText = useStreamText();
  const streamReasoning = useStreamReasoning();
  const optimisticPrompt = useOptimisticUserPrompt();
  const selectedThreadEpisode = useSelectedThreadEpisode();
  const selectedWorkset = useSelectedWorkset();
  const selectedFile = useSelectedFile();
  const selectedRevision = useSelectedRevision();
  const toast = useToast();
  const submitRun = useSubmitRun();
  const regenerateRun = useRegenerateRun();
  const editQueuedRun = useEditQueuedRun();
  const deleteQueuedRun = useDeleteQueuedRun();
  const admittedQueuedRunId = useAdmittedQueuedRunId();
  const { scrollRef, contentRef, showJumpButton, jumpToLatest } =
    useStickToBottom({ resetKey: sessionId });

  perfRender("Transcript");

  // Split so a delta rebuilds only the turn it lands in: the snapshot half is
  // untouched between refetches, and the stream half hands its earlier turns
  // straight back, which is what keeps the memoized rows from re-rendering.
  const snapshotTurns = useMemo(
    () =>
      perfTime("buildTranscript", () => buildTranscript(snapshot, liveThreads)),
    [snapshot, liveThreads],
  );
  const turns = useMemo(
    () =>
      withStreamedOutput(snapshotTurns, {
        text: streamText,
        reasoning: streamReasoning,
      }),
    [snapshotTurns, streamText, streamReasoning],
  );
  const activitySummary = useMemo(() => {
    const threads = turns.flatMap((turn) =>
      turn.kind === "model"
        ? turn.blocks.flatMap((block) => block.kind === "wave" ? block.rows.flat() : [])
        : [],
    );
    if (!threads.length) return "";
    const newest = threads[threads.length - 1];
    const state = newest.state === "dependency_pending"
      ? "pending"
      : newest.state.replace("_", " ");
    const delivery = newest.delivery === "available"
      ? ", result available"
      : newest.delivery === "delivered"
        ? ", result delivered"
        : "";
    return `Thread ${newest.name}: ${state}${delivery}`;
  }, [turns]);

  perfMark("transcript:turns", {
    fields: { turns: turns.length, streamChars: streamText.length },
    throttleMs: 1000,
  });

  const refreshIndex = useMemo(() => lastAnsweredUserIndex(turns), [turns]);
  const actionsBusy = running || submitRun.isPending || regenerateRun.isPending;
  const [forkBoundaryToken, setForkBoundaryToken] = useState<string | null>(null);
  const [revertTarget, setRevertTarget] = useState<{
    messageIdx: number;
    prompt: string;
  } | null>(null);

  /**
   * Answer this prompt again instead of asking it twice. The backend drops the
   * message and the reply it produced, rewinds the checkout with them, and
   * starts the new run under one lease — the prompt itself comes from the
   * transcript, so nothing here has to reconstruct it.
   */
  // The mutation object is rebuilt on every render, but its `mutateAsync` is
  // not — depending on the object would hand the bubble a new handler per delta
  // and undo its memoization.
  const regenerate = regenerateRun.mutateAsync;
  const resend = useCallback(
    (messageIdx: number) => {
      if (actionsBusy) return;
      void (async () => {
        try {
          const response = await regenerate({
            id: sessionId,
            messageIdx,
          });
          const label =
            response.disposition === "started"
              ? response.display_prompt
              : response.queued_message.display_prompt;
          pushLocalEvent("run", `▶ resent: ${label.slice(0, 80)}`);
        } catch (err) {
          const message = errorMessage(err);
          pushLocalEvent("error", `resend failed: ${message}`, true);
          toast.error(`Failed to resend: ${message}`);
        }
      })();
    },
    [actionsBusy, regenerate, sessionId, toast],
  );

  const openRevert = useCallback((messageIdx: number, prompt: string) => {
    setRevertTarget({ messageIdx, prompt });
  }, []);

  const isMobile = useIsMobile();

  const model = snapshot?.metadata.model ?? "";
  // A revision is captured per finished run, so each model turn carries what
  // its own run changed instead of one running total for the whole checkout.
  const { data: revisions } = useWorkspaceRevisions(sessionId);
  const turnRevisions = useMemo(
    () => revisionsByTurn(turns, revisions),
    [turns, revisions],
  );

  // Prefer the live active_run copy; fall back to the optimistic prompt set at
  // Send so the bubble is already above the model pill before the round-trip.
  const submitted = running
    ? snapshot?.active_run?.submitted_user_message
    : undefined;
  const pendingText = submitted
    ? displayPromptFromMessageText(submitted.content)
    : (optimisticPrompt ?? "");
  // Compared against the last *user* turn rather than the last turn of any
  // kind: everything the run produces lands after the prompt it answers, so
  // once that prompt is in the snapshot the copy is a duplicate no matter how
  // many model turns have piled up on top of it.
  const showPending = Boolean(
    pendingText && lastUserText(turns) !== pendingText,
  );
  useEffect(() => {
    if (!showPending && optimisticPrompt) {
      setOptimisticUserPrompt(null);
    }
  }, [showPending, optimisticPrompt]);

  // Once the run has a model message of its own, that message carries the
  // liveness — its pill spins and its header names the activity. A standalone
  // row below would be a second pill for the same run.
  const liveTurn = running && turns[turns.length - 1]?.kind === "model";
  // Keep the pill under the optimistic bubble too; otherwise it only appears
  // when `running` flips and the layout jumps.
  const showModelPending = (running || showPending) && !liveTurn;

  const focusThread = useCallback(
    (name: string, episodeKey: string) => {
      selectThread(name, episodeKey);
      onFocusPanel("threads");
    },
    [onFocusPanel],
  );
  const focusWorkset = useCallback(
    (id: string) => {
      selectWorkset(id);
      onFocusPanel("worksets");
    },
    [onFocusPanel],
  );
  // Opening a snapshot points the panel at that run's revision rather than at
  // the working tree: the run is what the badge describes, and the tree has
  // usually moved on — or been committed — since.
  const focusRevision = useCallback(
    (revision: number) => {
      selectRevision(revision);
      onFocusPanel("files");
    },
    [onFocusPanel],
  );
  const focusRevisionFile = useCallback(
    (revision: number, path: string) => {
      selectRevision(revision);
      selectFile(path);
      onFocusPanel("files");
    },
    [onFocusPanel],
  );

  // One object for every turn, and stable across stream deltas, so carrying it
  // does not re-render the memoized messages.
  const filesPanel = useMemo(
    () => ({
      sessionId,
      selectedFile: panel === "files" ? selectedFile : null,
      selectedRevision: panel === "files" ? selectedRevision : null,
      onOpenFile: focusRevisionFile,
      onOpenPanel: focusRevision,
    }),
    [
      sessionId,
      panel,
      selectedFile,
      selectedRevision,
      focusRevisionFile,
      focusRevision,
    ],
  );

  const runError = error && !running ? error : null;
  // Prefer the session notice when both fire; a broken config already explains
  // why the run could not continue.
  const notice = errorNotice ?? (runError ? { message: runError } : null);
  const queued =
    snapshot?.queued_message?.queued_run_id === admittedQueuedRunId
      ? undefined
      : snapshot?.queued_message;

  const editQueued = useCallback(
    async (prompt: string, expectedVersion: number) => {
      if (!queued) return;
      try {
        await editQueuedRun.mutateAsync({
          id: sessionId,
          queuedRunId: queued.queued_run_id,
          prompt,
          expectedVersion,
        });
      } catch (err) {
        toast.error(`Failed to edit next message: ${errorMessage(err)}`);
        throw err;
      }
    },
    [editQueuedRun, queued, sessionId, toast],
  );
  const deleteQueued = useCallback(
    async (expectedVersion: number) => {
      if (!queued) return;
      try {
        await deleteQueuedRun.mutateAsync({
          id: sessionId,
          queuedRunId: queued.queued_run_id,
          expectedVersion,
        });
      } catch (err) {
        toast.error(`Failed to delete next message: ${errorMessage(err)}`);
        throw err;
      }
    },
    [deleteQueuedRun, queued, sessionId, toast],
  );

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} className="h-full overflow-auto">
        {/* The top bar is fixed over this scroll region, so the first message
            needs to clear it. */}
        <div
          ref={contentRef}
          className={cn(
            "flex flex-col pt-[96px] md:pt-[72px] [&>*]:shrink-0 px-4 md:px-0",
            // The phone's input is a bare pill rather than a padded card, so
            // the run-out under the last message shrinks with it.
            isMobile ? "pb-[180px]" : "pb-[320px] mx-auto max-w-[840px]",
          )}
        >
          <ActivityAnnouncement summary={activitySummary} />
          {!snapshot && !errorNotice ? (
            <div className="text-basic-muted label-small">Loading…</div>
          ) : null}

          {snapshot && turns.length === 0 && !running && !showPending ? (
            <div className="text-basic-muted label-small">
              No messages yet. Type something below.
            </div>
          ) : null}

          <PerfProfiler id="turns">
            {turns.map((turn, index) => {
              if (turn.kind === "user") {
                return (
                  <UserMessage
                    key={turn.key}
                    text={turn.text}
                    timestamp={
                      turn.createdAt ? formatStoreTime(turn.createdAt) : null
                    }
                    messageIndex={turn.messageIndex}
                    actionsDisabled={actionsBusy}
                    onRefresh={refreshIndex === index ? resend : null}
                    onRevert={openRevert}
                    forkBoundaryToken={turn.forkBoundaryToken}
                    onFork={setForkBoundaryToken}
                  />
                );
              }

              // Resend / revert on a model turn address the user prompt it
              // answered — same messageIdx as the bubble above.
              let precedingUserIndex: number | null = null;
              let precedingUser: Extract<
                TranscriptTurn,
                { kind: "user" }
              > | null = null;
              for (let prior = index - 1; prior >= 0; prior -= 1) {
                const candidate = turns[prior];
                if (candidate?.kind === "user") {
                  precedingUserIndex = prior;
                  precedingUser = candidate;
                  break;
                }
              }

              return (
                <ModelMessage
                  key={turn.key}
                  turn={turn}
                  model={model}
                  active={running && index === turns.length - 1}
                  isLast={index === turns.length - 1}
                  activity={
                    running && index === turns.length - 1 ? activity : undefined
                  }
                  selectedThreadEpisode={
                    panel === "threads" ? selectedThreadEpisode : null
                  }
                  selectedWorkset={
                    panel === "worksets" ? selectedWorkset : null
                  }
                  onSelectThread={focusThread}
                  onSelectWorkset={focusWorkset}
                  userMessageIndex={precedingUser?.messageIndex}
                  userText={precedingUser?.text}
                  actionsDisabled={actionsBusy}
                  onRefresh={
                    precedingUserIndex != null &&
                    refreshIndex === precedingUserIndex
                      ? resend
                      : null
                  }
                  onRevert={openRevert}
                  snapshotRevision={turnRevisions.get(turn.key) ?? null}
                  filesPanel={filesPanel}
                />
              );
            })}
          </PerfProfiler>

          {showPending ? <UserMessage text={pendingText} pending /> : null}

          {/* Before the first assistant message or stream delta lands, keep the
              same chrome as a live ModelMessage — pill + model name — rather
              than a separate "Run started…" / loader row. */}
          {showModelPending ? (
            <ModelMessage
              turn={{
                kind: "model",
                key: "model-pending",
                blocks: [],
                durationMs: null,
                messageIndex: null,
              }}
              model={model}
              active
              isLast
              selectedThreadEpisode={
                panel === "threads" ? selectedThreadEpisode : null
              }
              selectedWorkset={panel === "worksets" ? selectedWorkset : null}
              onSelectThread={focusThread}
              onSelectWorkset={focusWorkset}
            />
          ) : null}

          {queued ? (
            <QueuedMessage
              key={`${queued.queued_run_id}:${queued.version}`}
              message={queued}
              onEdit={editQueued}
              onDelete={deleteQueued}
            />
          ) : null}

          {notice ? (
            <MessageBox
              variant={MessageBoxVariant.Error}
              size={MessageBoxSize.Medium}
              title={notice.message}
              className="w-fit max-w-full"
            >
              {notice.action ? (
                <button
                  type="button"
                  className="underline hover:opacity-80"
                  onClick={notice.action.onClick}
                >
                  {notice.action.label}
                </button>
              ) : null}
            </MessageBox>
          ) : null}
        </div>
      </div>

      {/* Always mounted so show/hide can animate opacity + translate like
          ArceeFM's "Last messages" control — unmounting would skip the exit. */}
      <div
        className={`absolute z-[2] left-1/2 bottom-0 -translate-x-1/2 rounded-full  transition-all duration-150 ease-out ${
          showJumpButton
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-3 scale-75 opacity-0 pointer-events-none"
        }`}
      >
        <Button
          variant={ButtonVariant.Primary}
          size={ButtonSize.Small}
          content={ButtonContent.IconRight}
          className="!rounded-b-none !shadow-3xl"
          onClick={jumpToLatest}
        >
          Last messages
          <Icon iconName={IconName.Down} />
        </Button>
      </div>

      <ForkModal
        open={forkBoundaryToken !== null}
        onClose={() => setForkBoundaryToken(null)}
        sourceId={sessionId}
        boundaryToken={forkBoundaryToken}
      />
      <RevertModal
        open={revertTarget !== null}
        onClose={() => setRevertTarget(null)}
        sessionId={sessionId}
        messageIdx={revertTarget?.messageIdx ?? null}
        prompt={revertTarget?.prompt ?? ""}
      />
    </div>
  );
}
