import { useCallback, useMemo, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  ChatLoader,
  Icon,
  IconName,
  MessageBox,
  MessageBoxSize,
  MessageBoxVariant,
  ModelPill,
} from "@/app/atoms";
import {
  ChatBadge,
  CodeChangesBadge,
} from "@/app/components/inspector/ChatBadge";
import { ModelMessage } from "@/app/components/inspector/ModelMessage";
import { UserMessage } from "@/app/components/inspector/UserMessage";
import { useStickToBottom } from "@/app/hooks/useStickToBottom";
import { RevertModal } from "@/app/components/modals/RevertModal";
import {
  displayPromptFromMessageText,
  formatStoreTime,
} from "@/app/lib/format";
import type { SessionPanel } from "@/app/lib/routes";
import { buildTranscript, type TranscriptTurn } from "@/app/lib/transcript";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useRegenerateRun, useSubmitRun } from "@/app/services/queries";
import {
  selectThread,
  selectWorkset,
  useSelectedThread,
  useSelectedWorkset,
} from "@/app/store/sessionLayoutStore";
import {
  pushLocalEvent,
  useActivity,
  useLiveThreads,
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
  const liveThreads = useLiveThreads();
  const streamText = useStreamText();
  const streamReasoning = useStreamReasoning();
  const selectedThread = useSelectedThread();
  const selectedWorkset = useSelectedWorkset();
  const toast = useToast();
  const submitRun = useSubmitRun();
  const regenerateRun = useRegenerateRun();
  const { scrollRef, contentRef, showJumpButton, jumpToLatest } =
    useStickToBottom();

  const turns = useMemo(
    () =>
      buildTranscript(snapshot, liveThreads, {
        text: streamText,
        reasoning: streamReasoning,
      }),
    [snapshot, liveThreads, streamText, streamReasoning],
  );

  const refreshIndex = useMemo(() => lastAnsweredUserIndex(turns), [turns]);
  const actionsBusy = running || submitRun.isPending || regenerateRun.isPending;
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
  const resend = useCallback(
    async (messageIdx: number) => {
      if (actionsBusy) return;
      try {
        const response = await regenerateRun.mutateAsync({
          id: sessionId,
          messageIdx,
        });
        pushLocalEvent(
          "run",
          `▶ resent: ${response.display_prompt.slice(0, 80)}`,
        );
      } catch (err) {
        const message = errorMessage(err);
        pushLocalEvent("error", `resend failed: ${message}`, true);
        toast.error(`Failed to resend: ${message}`);
      }
    },
    [actionsBusy, regenerateRun, sessionId, toast],
  );

  const model = snapshot?.metadata.model ?? "";
  const workspace = snapshot?.workspace ?? null;
  const additions = workspace?.total_additions ?? 0;
  const deletions = workspace?.total_deletions ?? 0;

  // While a run is in flight the just-submitted user message may not be in the
  // persisted snapshot yet; surface it from active_run so the chat feels live.
  const submitted = running
    ? snapshot?.active_run?.submitted_user_message
    : undefined;
  const pendingText = submitted
    ? displayPromptFromMessageText(submitted.content)
    : "";
  // Compared against the last *user* turn rather than the last turn of any
  // kind: everything the run produces lands after the prompt it answers, so
  // once that prompt is in the snapshot the copy is a duplicate no matter how
  // many model turns have piled up on top of it.
  const showPending = Boolean(
    pendingText && lastUserText(turns) !== pendingText,
  );

  // Once the run has a model message of its own, that message carries the
  // liveness — its pill spins and its header names the activity. A standalone
  // row below would be a second pill for the same run.
  const liveTurn = running && turns[turns.length - 1]?.kind === "model";

  const focusThread = (name: string) => {
    selectThread(name);
    onFocusPanel("threads");
  };
  const focusWorkset = (id: string) => {
    selectWorkset(id);
    onFocusPanel("worksets");
  };

  const runError = error && !running ? error : null;
  // Prefer the session notice when both fire; a broken config already explains
  // why the run could not continue.
  const notice = errorNotice ?? (runError ? { message: runError } : null);

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} className="h-full overflow-auto">
        {/* The top bar is fixed over this scroll region, so the first message
            needs to clear it. */}
        <div
          ref={contentRef}
          className="flex flex-col pt-[72px] pb-[320px] [&>*]:shrink-0 mx-auto max-w-[840px]"
        >
          {!snapshot && !errorNotice ? (
            <div className="text-basic-muted label-small">Loading…</div>
          ) : null}

          {snapshot && turns.length === 0 && !running && !showPending ? (
            <div className="text-basic-muted label-small">
              No messages yet. Type something below.
            </div>
          ) : null}

          {turns.map((turn, index) =>
            turn.kind === "user" ? (
              <UserMessage
                key={turn.key}
                text={turn.text}
                timestamp={turn.createdAt ? formatStoreTime(turn.createdAt) : null}
                actionsDisabled={actionsBusy}
                onRefresh={
                  refreshIndex === index
                    ? () => void resend(turn.messageIndex)
                    : null
                }
                onRevert={() =>
                  setRevertTarget({
                    messageIdx: turn.messageIndex,
                    prompt: turn.text,
                  })
                }
              />
            ) : (
              <ModelMessage
                key={turn.key}
                turn={turn}
                model={model}
                active={running && index === turns.length - 1}
                isLast={index === turns.length - 1}
                activity={activity}
                selectedThread={panel === "threads" ? selectedThread : null}
                selectedWorkset={panel === "worksets" ? selectedWorkset : null}
                onSelectThread={focusThread}
                onSelectWorkset={focusWorkset}
              />
            ),
          )}

          {showPending ? <UserMessage text={pendingText} pending /> : null}

          {running && !liveTurn ? (
            <div className="flex items-center gap-3">
              <ModelPill active />
              {activity ? (
                <span className="paragraph-medium text-shimmer-basic">
                  {activity}
                </span>
              ) : (
                // Before the first tool or message there is nothing to name,
                // and the dots read better than a placeholder verb.
                <ChatLoader />
              )}
            </div>
          ) : null}

          {/* The backend keeps one running diff for the workspace rather than a
              snapshot per turn, so it belongs after the last message. */}
          {!running && (additions || deletions) ? (
            <ChatBadge
              label="Snapshot"
              trailing={
                <CodeChangesBadge additions={additions} deletions={deletions} />
              }
              onClick={() => onFocusPanel("files")}
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
        className={`absolute z-[2] left-1/2 bottom-0 -translate-x-1/2 rounded-full  transition-all duration-200 ease-in-out ${
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
