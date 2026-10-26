import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { CommandCard } from "@/app/features/human-shell/CommandCard";
import { useNavigate } from "react-router-dom";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  ChatSessionMessage,
  ChatSessionMessageVariant,
  ShimmerLoader,
} from "@/app/atoms";
import { InitialPrompts } from "@/app/components/inspector/InitialPrompts";
import { JumpToLatest } from "@/app/components/inspector/transcript/JumpToLatest";
import { RunFailureRecovery } from "@/app/components/inspector/RunFailureRecovery";
import { ModelMessage } from "@/app/components/inspector/ModelMessage";
import { UserMessage } from "@/app/components/inspector/UserMessage";
import { useTranscriptModelContext } from "@/app/components/inspector/transcript/TranscriptModelContext";
import { DelegatedCompletionCard } from "@/app/features/delegation/presentation/DelegatedCompletionCard";
import { useInsightsNavigation } from "@/app/features/insights/useInsightsNavigation";
import { useAuthErrorSuppressed } from "@/app/hooks/useAuthErrorSuppressed";
import { useErrorNotice, type ErrorNotice } from "@/app/hooks/useErrorNotice";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useStickToBottom } from "@/app/hooks/useStickToBottom";
import { useTranscriptReveal } from "@/app/hooks/useTranscriptReveal";
import { cn } from "@/app/lib/cn";
import { RevertModal } from "@/app/components/modals/RevertModal";
import { formatStoreTime } from "@/app/lib/format";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { revisionsByTurn } from "@/app/lib/revisions";
import { routes, type SessionPanel } from "@/app/lib/routes";
import { PerfProfiler } from "@/app/lib/PerfProfiler";
import { perfRender } from "@/app/lib/perfDebug";
import type { ModelTurn, TranscriptTurn } from "@/app/lib/transcript";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import {
  useDismissSessionFork,
  useForkSession,
  useLoadOlderMessages,
  useRegenerateRun,
  useSessionGoal,
  useSubmitRun,
  useUpdateGoal,
  useWorkspaceRevisions,
} from "@/app/services/queries";

import type { SessionForkLink, SessionSnapshotResponse } from "@/app/types/api";

interface TranscriptProps {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  /** Which side-panel tab is on screen; null while the side box is hidden. */
  panel: SessionPanel | null;
  /** Brings the matching side panel forward when the chat points at a row. */
  onFocusPanel: (panel: SessionPanel) => void;
  /**
   * The failure the chat reports — a broken config, an unreadable snapshot, or
   * whatever the provider refused the run over — already put into words and
   * paired with whatever can be done about it.
   */
  errorNotice?: ErrorNotice | null;
}

export const TranscriptRecoveryNotice = memo(function TranscriptRecoveryNotice({
  warning,
}: {
  warning?: string | null;
}) {
  if (!warning) return null;
  return (
    <ChatSessionMessage
      role="status"
      variant={ChatSessionMessageVariant.Info}
      title="Session recovered"
    >
      {warning}
    </ChatSessionMessage>
  );
});

/**
 * Index of the user turn a resend addresses: the newest prompt, answered or
 * not. A run that failed before writing anything leaves its prompt as the last
 * turn, and that prompt is the one worth sending again — so the action sits on
 * its own bubble instead of on the reply to the prompt before it.
 */
function resendTargetIndex(turns: TranscriptTurn[]): number | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.kind === "delegated-completion") return null;
    if (turn?.kind === "user" && !turn.pending) return index;
  }
  return null;
}

const NO_BLOCKS: ModelTurn["blocks"] = [];

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
  const {
    useModelRetryAttempt,
    useRunFailure,
    useRunError,
    useCancelArmed,
    useActivity,
    setOptimisticUserPrompt,
    pushLocalEvent,
  } = useNativeRuntime().stores.runtimeStore;

  const {
    useSelectedThreadEpisode,
    useSelectedInsight,
    useSelectedRevision,
    useSelectedFile,
    selectRevision,
    selectFile,
  } = useNativeRuntime().stores.sessionLayoutStore;

  const stopping = useCancelArmed(sessionId);
  const activity = useActivity();
  const error = useRunError();
  const liveFailure = useRunFailure();
  const modelRetryAttempt = useModelRetryAttempt();
  const selectedInsight = useSelectedInsight();
  const threadEpisode = useSelectedThreadEpisode();
  const selectedThreadEpisode = selectedInsight?.kind === "thread" ? threadEpisode : null;
  const selectedGroupId = selectedInsight?.kind === "group" ? selectedInsight.groupId : null;
  const selectedFile = useSelectedFile();
  const selectedRevision = useSelectedRevision();
  const toast = useToast();
  const sessionActions = useSessionActions();
  const navigate = useNavigate();
  const backend = snapshot?.metadata.backend ?? null;
  const toNotice = useErrorNotice(sessionId, backend);
  // Read before the notice is built, since hook order cannot depend on whether
  // this run failed.
  const authErrorSuppressed = useAuthErrorSuppressed(backend, error);
  const submitRun = useSubmitRun();
  const regenerateRun = useRegenerateRun();
  const forkSession = useForkSession();
  const dismissFork = useDismissSessionFork();
  const olderMessages = useLoadOlderMessages(sessionId);
  const { data: revisions } = useWorkspaceRevisions(sessionId);
  const direct =
    snapshot?.metadata.behavior === "direct" ||
    snapshot?.metadata.behavior === "direct-with-orchestrator";
  // Read on every render: a query whose fields went unread re-renders on every
  // fetch, and the goal is polled each second.
  const goal = useSessionGoal(sessionId, direct).data;
  const updateGoal = useUpdateGoal();
  const { scrollRef, contentRef, showJumpButton, jumpToLatest, followLatest } = useStickToBottom({
    resetKey: sessionId,
    // Intentionally not keyed on running / active_run / message count: those
    // used to instant-snap on Send and bounce on Stop. Growth/shrink observers
    // keep the bottom edge; followLatest(300) covers the send glide.
  });
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);
  const hadPending = useRef(false);
  const sendFollowReady = useRef(false);
  const messageWindowStart = snapshot?.message_page?.start ?? 0;

  useLayoutEffect(() => {
    const anchor = prependAnchor.current;
    const scroller = scrollRef.current;
    if (!anchor || !scroller) return;
    scroller.scrollTop = anchor.top + (scroller.scrollHeight - anchor.height);
    prependAnchor.current = null;
  }, [messageWindowStart, scrollRef]);

  const loadOlderMessages = useCallback(() => {
    const scroller = scrollRef.current;
    if (scroller) {
      prependAnchor.current = {
        height: scroller.scrollHeight,
        top: scroller.scrollTop,
      };
    }
    void olderMessages
      .mutateAsync()
      .then((accepted) => {
        if (!accepted) prependAnchor.current = null;
      })
      .catch(() => {
        prependAnchor.current = null;
      });
  }, [olderMessages, scrollRef]);

  perfRender("Transcript");

  const { turns, baseTurns, running, optimisticPrompt, submitted, showPending, replyKey } =
    useTranscriptModelContext();
  useLayoutEffect(() => {
    hadPending.current = false;
    sendFollowReady.current = false;
  }, [sessionId]);
  useEffect(() => {
    sendFollowReady.current = true;
  }, [sessionId]);
  // Same moment ArceeFM starts its 300ms glide: the prompt bubble just
  // appeared. Opening an already-running chat must not take this path — that
  // is the first pin.
  useLayoutEffect(() => {
    const appeared = showPending && !hadPending.current;
    hadPending.current = showPending;
    if (appeared && sendFollowReady.current) followLatest(300);
  }, [showPending, followLatest]);

  // Read off the turns without the stream, which hold the same rows at the same
  // positions and leave these alone while a reply streams.
  const refreshIndex = useMemo(() => resendTargetIndex(baseTurns), [baseTurns]);
  const actionsBusy =
    running || stopping || submitRun.isPending || regenerateRun.isPending || forkSession.isPending;
  const [revertTarget, setRevertTarget] = useState<{
    messageIdx: number;
    prompt: string;
  } | null>(null);
  const closeRevert = useCallback(() => setRevertTarget(null), []);

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
          pushLocalEvent("run", `▶ regenerated: ${response.display_prompt.slice(0, 80)}`);
        } catch (err) {
          pushLocalEvent("error", `regeneration failed: ${errorMessage(toRunError(err))}`, true);
          toast.error(`Failed to regenerate: ${humanErrorText(toRunError(err), backend)}`);
        }
      })();
    },
    [actionsBusy, backend, pushLocalEvent, regenerate, sessionId, toast],
  );

  const fork = forkSession.mutateAsync;
  const createFork = useCallback(
    (messageIdx: number) => {
      if (actionsBusy) return;
      void (async () => {
        try {
          const response = await fork({ id: sessionId, messageIdx });
          navigate(routes.session(response.session_id));
        } catch (err) {
          toast.error(`Failed to create fork: ${humanErrorText(toRunError(err), backend)}`);
        }
      })();
    },
    [actionsBusy, backend, fork, navigate, sessionId, toast],
  );

  const openFork = useCallback(
    (forkId: string) => {
      navigate(routes.session(forkId));
    },
    [navigate],
  );

  const removeForkMarker = dismissFork.mutate;
  const dismissForkMarker = useCallback(
    (forkId: string) => {
      removeForkMarker(
        { id: sessionId, forkId },
        {
          onError: (err) => {
            toast.error(`Failed to dismiss fork: ${humanErrorText(toRunError(err), backend)}`);
          },
        },
      );
    },
    [backend, removeForkMarker, sessionId, toast],
  );

  const openRevert = useCallback((messageIdx: number, prompt: string) => {
    setRevertTarget({ messageIdx, prompt });
  }, []);

  const isMobile = useIsMobile();

  const model = snapshot?.metadata.model ?? "";
  const readOnly = snapshot?.lineage != null;
  // A revision is captured per finished run, so each model turn carries what
  // its own run changed instead of one running total for the whole checkout.
  const turnRevisions = useMemo(
    () => revisionsByTurn(baseTurns, revisions),
    [baseTurns, revisions],
  );
  const forksAt = useMemo(() => {
    const byMessage = new Map<number, SessionForkLink[]>();
    for (const entry of snapshot?.forks ?? []) {
      byMessage.set(entry.source_message_idx, [
        ...(byMessage.get(entry.source_message_idx) ?? []),
        entry,
      ]);
    }
    return byMessage;
  }, [snapshot?.forks]);

  useEffect(() => {
    if (!showPending && optimisticPrompt) {
      setOptimisticUserPrompt(null);
    }
  }, [showPending, optimisticPrompt, setOptimisticUserPrompt]);

  // Once *this* run has a model message of its own, that message carries the
  // liveness — its pill spins and its header names the activity. Until then an
  // empty reply stands in, under the optimistic bubble too, or the pill would
  // only appear when `running` flips and the layout would jump. It is keyed as
  // the reply it stands for, so the stream and the commit fill it in place,
  // and it stands down once that reply is there, even from a run that ended
  // before the snapshot showed its prompt.
  const lastTurn = turns[turns.length - 1];
  const showModelPending =
    (running || showPending) &&
    lastTurn?.key !== replyKey &&
    !(running && lastTurn?.kind === "model");
  const placeholder = useMemo<ModelTurn>(
    () => ({
      kind: "model",
      key: replyKey,
      blocks: NO_BLOCKS,
      durationMs: null,
      messageIndex: null,
    }),
    [replyKey],
  );
  const rows = showModelPending ? [...turns, placeholder] : turns;

  const { openThread } = useInsightsNavigation();
  // Opening a snapshot points the panel at that run's revision rather than at
  // the working tree: the run is what the badge describes, and the tree has
  // usually moved on — or been committed — since.
  const focusRevision = useCallback(
    (revision: number) => {
      selectRevision(revision);
      onFocusPanel("files");
    },
    [onFocusPanel, selectRevision],
  );
  const focusRevisionFile = useCallback(
    (revision: number, path: string) => {
      selectRevision(revision);
      selectFile(path);
      onFocusPanel("files");
    },
    [onFocusPanel, selectFile, selectRevision],
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
    [sessionId, panel, selectedFile, selectedRevision, focusRevisionFile, focusRevision],
  );

  // A session nobody has written to yet offers starter prompts in place of the
  // transcript, and they are centred in the space the messages would fill.
  // Emptiness is measured in turns rather than in the message page: every
  // session opens with a system prompt, which the page counts and the
  // transcript does not show.
  const showInitialPrompts = Boolean(snapshot && turns.length === 0 && !running && !showPending);

  const runError = error && !running ? error : null;
  const durableFailure = !running
    ? (liveFailure ?? snapshot?.run_failure ?? goal?.last_failure ?? null)
    : null;
  const latestUser = [...turns].reverse().find((turn) => turn.kind === "user" && !turn.pending);
  const resumeGoal = () => {
    if (!goal) return;
    void updateGoal
      .mutateAsync({
        sessionId,
        goalId: goal.goal_id,
        payload: { expected_version: goal.version, status: "active" },
      })
      .catch((err) =>
        toast.error(`Failed to resume goal: ${humanErrorText(toRunError(err), backend)}`),
      );
  };
  // Prefer the session notice when both fire; a broken config already explains
  // why the run could not continue.
  const notice = durableFailure
    ? null
    : (errorNotice ?? (runError && !authErrorSuppressed ? toNotice(runError) : null));

  // Nothing is worth revealing before the snapshot lands, unless the reason it
  // never will is the notice standing in its place.
  const revealed = useTranscriptReveal(sessionId, Boolean(snapshot) || errorNotice !== null);
  // A load ends in a fade; a reveal that only turns the loader off would flash
  // the gap between the two. Sliding the whole tree in and out of view on the
  // same duration crossfades them instead.
  const fade = revealed
    ? "opacity-100 transition-opacity duration-300 ease-in-out"
    : "opacity-0 transition-opacity duration-300 ease-in-out";

  return (
    <div className="relative flex-1 min-h-0">
      {/* Rows the size of the messages they stand in for, over the space those
          messages will fill. Laid out on top rather than in the flow, so the
          transcript can already be mounted underneath — hidden, but measured,
          which is what lets it open at its own bottom edge.
          Coming in is delayed and going out is not, so a conversation that is
          served from the cache, or simply arrives quickly, is swapped in over a
          blank moment instead of behind rows nobody had time to read. */}
      <div
        role="status"
        aria-label={revealed ? undefined : "Loading conversation"}
        className={cn(
          "pointer-events-none absolute inset-x-0 top-[96px] px-4 transition-opacity duration-150 ease-in-out md:top-[90px] md:px-0",
          revealed ? "opacity-0" : "opacity-100 delay-200",
        )}
      >
        <div className="mx-auto w-full max-w-[640px]">
          <ShimmerLoader rows={3} rowClassName="h-[48px]" />
        </div>
      </div>
      {/* The starter prompts sit beside the transcript rather than inside it:
          the scroll region follows its own bottom edge, which would pin a
          column of prompts under the composer and cut off the first ones. */}
      {showInitialPrompts ? (
        <div
          className={cn(
            "absolute inset-x-0 top-[96px] flex overflow-auto px-4 md:top-[90px] md:px-0",
            isMobile ? "bottom-[128px]" : "bottom-[136px]",
            fade,
          )}
        >
          <div className="m-auto w-full max-w-[640px]">
            <InitialPrompts />
          </div>
        </div>
      ) : null}
      <div ref={scrollRef} className={cn("h-full overflow-auto", fade, !revealed && "invisible")}>
        {/* The phone has the fixed top bar over this scroll region, so its
            first message has to clear it. Wider layouts float the session
            header over this scroll, and the first message starts under it. */}
        <div
          ref={contentRef}
          className={cn(
            "flex flex-col pt-[96px] md:pt-[90px] [&>*]:shrink-0 px-4 md:px-0",
            // The phone's input is a bare pill rather than a padded card, so
            // the run-out under the last message shrinks with it.
            isMobile ? "pb-[180px]" : "pb-[320px] mx-auto max-w-[640px]",
          )}
        >
          {snapshot?.message_page?.has_older ? (
            <div className="mb-4 flex flex-col items-start gap-2">
              <Button
                variant={ButtonVariant.Ghost}
                size={ButtonSize.Small}
                content={ButtonContent.Text}
                disabled={olderMessages.isPending}
                onClick={loadOlderMessages}
              >
                {olderMessages.isPending ? "Loading…" : "Load older"}
              </Button>
              {olderMessages.isError ? (
                <div role="alert" className="flex items-center gap-2 text-basic-muted label-small">
                  <span>Couldn’t load older messages.</span>
                  <Button
                    variant={ButtonVariant.Ghost}
                    size={ButtonSize.Small}
                    content={ButtonContent.Text}
                    onClick={loadOlderMessages}
                  >
                    Try again
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <PerfProfiler id="turns">
            {rows.map((turn, index) => {
              if (turn.kind === "delegated-completion") {
                return <DelegatedCompletionCard key={turn.key} turn={turn} />;
              }
              if (turn.kind === "user") {
                const command = (snapshot?.shell_commands ?? []).find(
                  (candidate) =>
                    candidate.transcript_index === turn.messageIndex &&
                    turn.text.startsWith("<human_shell_result>\n") &&
                    turn.text.includes(`"operation_id":"${candidate.operation_id}"`),
                );
                if (command)
                  return (
                    <CommandCard
                      key={turn.key}
                      sessionId={sessionId}
                      command={command}
                      readOnly={readOnly}
                    />
                  );
                return (
                  <UserMessage
                    key={turn.key}
                    text={turn.text}
                    sessionId={sessionId}
                    pending={turn.pending}
                    terminalSelection={
                      (turn.pending
                        ? submitted?.terminal_selection
                        : snapshot?.terminal_selection_attributions?.find(
                            (reference) => reference.message_index === turn.messageIndex,
                          )?.evidence) ?? undefined
                    }
                    invokedSkills={turn.invokedSkills}
                    timestamp={turn.createdAt ? formatStoreTime(turn.createdAt) : null}
                    messageIndex={turn.pending ? undefined : turn.messageIndex}
                    actionsDisabled={actionsBusy}
                    readOnly={readOnly}
                    onRefresh={!readOnly && refreshIndex === index ? resend : null}
                    onRevert={readOnly ? null : openRevert}
                  />
                );
              }

              // Regenerate / revert on a model turn address the user prompt it
              // answered — same messageIdx as the bubble above.
              let precedingUserIndex: number | null = null;
              let precedingUser: Extract<TranscriptTurn, { kind: "user" }> | null = null;
              for (let prior = index - 1; prior >= 0; prior -= 1) {
                const candidate = rows[prior];
                if (candidate?.kind === "delegated-completion") break;
                if (candidate?.kind === "user") {
                  precedingUserIndex = prior;
                  precedingUser = candidate;
                  break;
                }
              }

              // A prompt sent ahead of the snapshot is drawn under the previous
              // reply, so only the last row can be this run's.
              const lastIsThisRun = index === rows.length - 1;
              return (
                <ModelMessage
                  key={turn.key}
                  turn={turn}
                  model={model}
                  active={(running || turn === placeholder) && lastIsThisRun}
                  isLast={lastIsThisRun}
                  activity={running && lastIsThisRun ? activity : undefined}
                  selectedThreadEpisode={panel === "insights" ? selectedThreadEpisode : null}
                  selectedGroupId={panel === "insights" ? selectedGroupId : null}
                  onSelectThread={openThread}
                  userMessageIndex={
                    precedingUser?.pending ? undefined : precedingUser?.messageIndex
                  }
                  userText={precedingUser?.text}
                  actionsDisabled={actionsBusy}
                  readOnly={readOnly}
                  onRefresh={
                    !readOnly && precedingUserIndex != null && refreshIndex === precedingUserIndex
                      ? resend
                      : null
                  }
                  onRevert={readOnly ? null : openRevert}
                  onFork={readOnly ? null : createFork}
                  forks={
                    readOnly || turn.messageIndex == null
                      ? undefined
                      : forksAt.get(turn.messageIndex)
                  }
                  onOpenFork={openFork}
                  onDismissFork={dismissForkMarker}
                  snapshotRevision={
                    turn.messageIndex != null
                      ? (turnRevisions.get(turn.messageIndex) ?? null)
                      : null
                  }
                  filesPanel={filesPanel}
                />
              );
            })}
          </PerfProfiler>

          {notice ? (
            <ChatSessionMessage
              role="alert"
              variant={ChatSessionMessageVariant.Error}
              title={notice.title}
              action={notice.action}
            >
              {notice.description}
            </ChatSessionMessage>
          ) : null}

          {running && modelRetryAttempt ? (
            <ChatSessionMessage
              role="status"
              variant={ChatSessionMessageVariant.Info}
              title={`Connection interrupted; retrying model response (attempt ${modelRetryAttempt})`}
            >
              The abandoned partial stream was cleared before this attempt began.
            </ChatSessionMessage>
          ) : null}

          {durableFailure ? (
            <RunFailureRecovery
              failure={durableFailure}
              goal={goal}
              backend={backend}
              onResumeGoal={resumeGoal}
              onOpenSettings={() => sessionActions.settings(sessionId)}
              onRegenerate={
                latestUser?.kind === "user" ? () => resend(latestUser.messageIndex) : null
              }
            />
          ) : null}

          {(snapshot?.shell_commands ?? [])
            .filter((command) => command.state === "accepted" || command.state === "started")
            .map((command) => (
              <CommandCard
                key={command.operation_id}
                sessionId={sessionId}
                command={command}
                readOnly={readOnly}
              />
            ))}
          <TranscriptRecoveryNotice warning={snapshot?.transcript_recovery_warning} />
        </div>
      </div>

      <JumpToLatest visible={showJumpButton} onJump={jumpToLatest} />

      <RevertModal
        open={revertTarget !== null}
        onClose={closeRevert}
        sessionId={sessionId}
        messageIdx={revertTarget?.messageIdx ?? null}
        prompt={revertTarget?.prompt ?? ""}
      />
    </div>
  );
}
