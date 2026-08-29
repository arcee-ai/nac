import { useNavigate } from "react-router-dom";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  ChatSessionMessage,
  ChatSessionMessageVariant,
  Icon,
  IconName,
  ShimmerLoader,
} from "@/app/atoms";
import { InitialPrompts } from "@/app/components/inspector/InitialPrompts";
import { ModelMessage } from "@/app/components/inspector/ModelMessage";
import { UserMessage } from "@/app/components/inspector/UserMessage";
import { DelegatedCompletionEvent } from "@/app/features/delegation/presentation/DelegatedCompletionEvent";
import { useAuthErrorSuppressed } from "@/app/hooks/useAuthErrorSuppressed";
import { useErrorNotice, type ErrorNotice } from "@/app/hooks/useErrorNotice";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useStickToBottom } from "@/app/hooks/useStickToBottom";
import { useTranscriptReveal } from "@/app/hooks/useTranscriptReveal";
import { cn } from "@/app/lib/cn";
import { RevertModal } from "@/app/components/modals/RevertModal";
import { displayPromptFromMessageText, formatStoreTime, invokedSkillNames } from "@/app/lib/format";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { revisionsByTurn } from "@/app/lib/revisions";
import { routes, type SessionPanel } from "@/app/lib/routes";
import { PerfProfiler } from "@/app/lib/PerfProfiler";
import { perfMark, perfRender, perfTime } from "@/app/lib/perfDebug";
import {
  buildTranscript,
  withStreamedOutput,
  STREAMING_TURN_KEY,
  type TranscriptTurn,
} from "@/app/lib/transcript";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import {
  useDismissSessionFork,
  useForkSession,
  useLoadOlderMessages,
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
  useActivity,
  useFinishedToolCalls,
  useCancelArmed,
  useLiveThreads,
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
  /**
   * The failure the chat reports — a broken config, an unreadable snapshot, or
   * whatever the provider refused the run over — already put into words and
   * paired with whatever can be done about it.
   */
  errorNotice?: ErrorNotice | null;
}

export function TranscriptRecoveryNotice({ warning }: { warning?: string | null }) {
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
}

/**
 * Index of the user turn a resend addresses: the newest prompt, answered or
 * not. A run that failed before writing anything leaves its prompt as the last
 * turn, and that prompt is the one worth sending again — so the action sits on
 * its own bubble instead of on the reply to the prompt before it.
 */
function resendTargetIndex(turns: TranscriptTurn[]): number | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index]?.kind === "delegated-completion") return null;
    if (turns[index]?.kind === "user") return index;
  }
  return null;
}

/** Text of the newest user bubble, or null when the chat opens with the model. */
function lastUserText(turns: TranscriptTurn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.kind === "delegated-completion") return null;
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
  const running = useRunning(sessionId);
  const stopping = useCancelArmed(sessionId);
  const activity = useActivity();
  const error = useRunError();
  const liveThreads = useLiveThreads();
  const finishedToolCalls = useFinishedToolCalls();
  const streamText = useStreamText();
  const streamReasoning = useStreamReasoning();
  const optimisticPrompt = useOptimisticUserPrompt();
  const selectedThreadEpisode = useSelectedThreadEpisode();
  const selectedWorkset = useSelectedWorkset();
  const selectedFile = useSelectedFile();
  const selectedRevision = useSelectedRevision();
  const toast = useToast();
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

  // Split so a delta rebuilds only the turn it lands in: the snapshot half is
  // untouched between refetches, and the stream half hands its earlier turns
  // straight back, which is what keeps the memoized rows from re-rendering.
  const snapshotTurns = useMemo(
    () =>
      perfTime("buildTranscript", () => buildTranscript(snapshot, liveThreads, finishedToolCalls)),
    [snapshot, liveThreads, finishedToolCalls],
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

  const refreshIndex = useMemo(() => resendTargetIndex(turns), [turns]);
  const actionsBusy =
    running || stopping || submitRun.isPending || regenerateRun.isPending || forkSession.isPending;
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
          pushLocalEvent("run", `▶ resent: ${response.display_prompt.slice(0, 80)}`);
        } catch (err) {
          pushLocalEvent("error", `resend failed: ${errorMessage(toRunError(err))}`, true);
          toast.error(`Failed to resend: ${humanErrorText(toRunError(err), backend)}`);
        }
      })();
    },
    [actionsBusy, backend, regenerate, sessionId, toast],
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
  const turnRevisions = useMemo(() => revisionsByTurn(turns, revisions), [turns, revisions]);

  useEffect(() => {
    if (!showPending && optimisticPrompt) {
      setOptimisticUserPrompt(null);
    }
  }, [showPending, optimisticPrompt]);

  // Once *this* run has a model message of its own, that message carries the
  // liveness — its pill spins and its header names the activity. A standalone
  // row below would be a second pill for the same run. The last snapshot model
  // turn is the previous reply; treating it as live hid the pending pill and
  // left `isLast` min-height on the old bubble until the stream opened, so
  // Send glided twice (user bubble, then the min-height hop).
  const lastTurn = turns[turns.length - 1];
  const liveTurn =
    running && lastTurn?.kind === "model" && (!showPending || lastTurn.key === STREAMING_TURN_KEY);
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
    [sessionId, panel, selectedFile, selectedRevision, focusRevisionFile, focusRevision],
  );

  // A session nobody has written to yet offers starter prompts in place of the
  // transcript, and they are centred in the space the messages would fill.
  // Emptiness is measured in turns rather than in the message page: every
  // session opens with a system prompt, which the page counts and the
  // transcript does not show.
  const showInitialPrompts = Boolean(snapshot && turns.length === 0 && !running && !showPending);

  const runError = error && !running ? error : null;
  // Prefer the session notice when both fire; a broken config already explains
  // why the run could not continue.
  const notice = errorNotice ?? (runError && !authErrorSuppressed ? toNotice(runError) : null);

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
          "pointer-events-none absolute inset-x-0 top-[96px] px-4 transition-opacity duration-150 ease-in-out md:top-[72px] md:px-0",
          revealed ? "opacity-0" : "opacity-100 delay-200",
        )}
      >
        <div className="mx-auto w-full max-w-[840px]">
          <ShimmerLoader rows={3} rowClassName="h-[48px]" />
        </div>
      </div>
      {/* The starter prompts sit beside the transcript rather than inside it:
          the scroll region follows its own bottom edge, which would pin a
          column of prompts under the composer and cut off the first ones. */}
      {showInitialPrompts ? (
        <div
          className={cn(
            "absolute inset-x-0 top-[96px] flex overflow-auto px-4 md:top-[72px] md:px-0",
            isMobile ? "bottom-[128px]" : "bottom-[136px]",
            fade,
          )}
        >
          <div className="m-auto w-full max-w-[840px]">
            <InitialPrompts />
          </div>
        </div>
      ) : null}
      <div ref={scrollRef} className={cn("h-full overflow-auto", fade, !revealed && "invisible")}>
        {/* The phone has the fixed top bar over this scroll region, so its
            first message has to clear it. Wider layouts put the tab strip
            between the two, and only need breathing room under it. */}
        <div
          ref={contentRef}
          className={cn(
            "flex flex-col pt-[96px] md:pt-6 [&>*]:shrink-0 px-4 md:px-0",
            // The phone's input is a bare pill rather than a padded card, so
            // the run-out under the last message shrinks with it.
            isMobile ? "pb-[180px]" : "pb-[320px] mx-auto max-w-[840px]",
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
            {turns.map((turn, index) => {
              if (turn.kind === "delegated-completion") {
                return <DelegatedCompletionEvent key={turn.key} turn={turn} />;
              }
              if (turn.kind === "user") {
                return (
                  <UserMessage
                    key={turn.key}
                    text={turn.text}
                    invokedSkills={turn.invokedSkills}
                    timestamp={turn.createdAt ? formatStoreTime(turn.createdAt) : null}
                    messageIndex={turn.messageIndex}
                    actionsDisabled={actionsBusy}
                    readOnly={readOnly}
                    onRefresh={!readOnly && refreshIndex === index ? resend : null}
                    onRevert={readOnly ? null : openRevert}
                  />
                );
              }

              // Resend / revert on a model turn address the user prompt it
              // answered — same messageIdx as the bubble above.
              let precedingUserIndex: number | null = null;
              let precedingUser: Extract<TranscriptTurn, { kind: "user" }> | null = null;
              for (let prior = index - 1; prior >= 0; prior -= 1) {
                const candidate = turns[prior];
                if (candidate?.kind === "delegated-completion") break;
                if (candidate?.kind === "user") {
                  precedingUserIndex = prior;
                  precedingUser = candidate;
                  break;
                }
              }

              const lastIsThisRun =
                index === turns.length - 1 && !(showPending && turn.key !== STREAMING_TURN_KEY);
              const row = (
                <ModelMessage
                  key={turn.key}
                  turn={turn}
                  model={model}
                  active={running && lastIsThisRun}
                  // Pending model chrome below the optimistic bubble is the
                  // visual last row; leaving min-height on the previous reply
                  // made Send shrink-then-grow a frame later.
                  isLast={lastIsThisRun && !showModelPending}
                  activity={running && lastIsThisRun ? activity : undefined}
                  selectedThreadEpisode={panel === "threads" ? selectedThreadEpisode : null}
                  selectedWorkset={panel === "worksets" ? selectedWorkset : null}
                  onSelectThread={focusThread}
                  onSelectWorkset={focusWorkset}
                  userMessageIndex={precedingUser?.messageIndex}
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
                    readOnly
                      ? []
                      : (snapshot?.forks ?? []).filter(
                          (entry) => entry.source_message_idx === turn.messageIndex,
                        )
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

              // The prompt a streaming turn answers is not in the snapshot yet,
              // so its bubble is still the optimistic copy — which belongs
              // above the answer to it rather than after it.
              return streamingTurn && turn.key === STREAMING_TURN_KEY ? (
                <Fragment key={turn.key}>
                  <UserMessage text={pendingText} invokedSkills={pendingSkills} pending />
                  {row}
                </Fragment>
              ) : (
                row
              );
            })}
          </PerfProfiler>

          {showPending && !streamingTurn ? (
            <UserMessage text={pendingText} invokedSkills={pendingSkills} pending />
          ) : null}

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
              selectedThreadEpisode={panel === "threads" ? selectedThreadEpisode : null}
              selectedWorkset={panel === "worksets" ? selectedWorkset : null}
              onSelectThread={focusThread}
              onSelectWorkset={focusWorkset}
            />
          ) : null}

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

          <TranscriptRecoveryNotice warning={snapshot?.transcript_recovery_warning} />
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
