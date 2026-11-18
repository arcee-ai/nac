import SessionNameDisclosure from "@/app/atoms/session-name-disclosure";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  ShimmerLoader,
} from "@/app/atoms";
import { ModelMessage } from "@/app/components/inspector/ModelMessage";
import { UserMessage } from "@/app/components/inspector/UserMessage";
import {
  keepTurnKeys,
  replyKey,
  type DrawnTurns,
} from "@/app/components/inspector/transcript/turnKeys";
import { DelegatedCompletionCard } from "@/app/features/delegation/presentation/DelegatedCompletionCard";
import { GoalContinuationCard } from "@/app/features/goals/presentation/GoalContinuationCard";
import { ChildTranscriptScope } from "@/app/features/insights/transcript/ChildTranscriptScope";
import { useDelegatedPreviewStream } from "@/app/hooks/useDelegatedPreviewStream";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useStickToBottom } from "@/app/hooks/useStickToBottom";
import { useTranscriptReveal } from "@/app/hooks/useTranscriptReveal";
import { cn } from "@/app/lib/cn";
import { displayPromptFromMessageText, invokedSkillNames } from "@/app/lib/format";
import { buildTranscript, withStreamedOutput, type TranscriptTurn } from "@/app/lib/transcript";
import {
  useLoadOlderMessages,
  useSessionPermissions,
  useSessionSnapshot,
} from "@/app/services/queries";

function ignoreThread(): void {}

/** Text of the newest user bubble, or null when the chat opens with the model. */
function lastUserText(turns: TranscriptTurn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.kind === "delegated-completion" || turn.kind === "goal-continuation") return null;
    if (turn.kind === "user") return turn.text;
  }
  return null;
}

/**
 * The subagent's own conversation, the same turns the chat transcript draws,
 * including the load shimmer and the live model pill. The parent's runtime
 * store is left alone: this view reads the child's snapshot and its own stream.
 */
export function SubagentPreview({
  sessionId,
  title,
  fallbackText,
  relationship,
  header = true,
  phoneHeaderInFlow = false,
  onOpen,
}: {
  sessionId: string;
  title: string;
  fallbackText: string | null;
  relationship?: { status: string; generation: number; runId: string | null };
  /** Below the desktop width the panel's own header names it and carries Open. */
  header?: boolean;
  /** The selected phone detail reserves its header outside this scroll viewport. */
  phoneHeaderInFlow?: boolean;
  /** Leaves for the session's own page. */
  onOpen: () => void;
}) {
  const isMobile = useIsMobile();
  const live = useDelegatedPreviewStream(sessionId);
  const snapshot = useSessionSnapshot(sessionId, {
    retry: false,
    refetchInterval: live.recovering && relationship?.status === "running" ? 1_000 : false,
  });
  const refreshSnapshot = snapshot.refetch;
  // Relationship polling supplies a separate settlement signal when a gap
  // also lost the child's terminal event. A generation/status change forces a
  // final read; active runs keep refreshing until that signal arrives.
  useEffect(() => {
    if (live.recovering) void refreshSnapshot();
  }, [
    live.recovering,
    relationship?.generation,
    relationship?.runId,
    relationship?.status,
    refreshSnapshot,
  ]);
  const older = useLoadOlderMessages(sessionId);
  const data = snapshot.data;
  const direct =
    data?.metadata.behavior === "direct" || data?.metadata.behavior === "direct-with-orchestrator";
  const { data: permissions } = useSessionPermissions(sessionId, direct);
  const pendingPermissionCallIds = useMemo(
    () =>
      new Set(
        (permissions?.requests ?? [])
          .map((request) => request.call_id)
          .filter((id): id is string => Boolean(id)),
      ),
    [permissions?.requests],
  );
  const hasOlder = Boolean(data?.message_page?.has_older);
  const windowStart = data?.message_page?.start ?? 0;
  const [olderFailed, setOlderFailed] = useState(false);
  const [seenSession, setSeenSession] = useState(sessionId);
  const loadingOlder = useRef(false);
  if (seenSession !== sessionId) {
    setSeenSession(sessionId);
    setOlderFailed(false);
  }
  const running = live.running || Boolean(data?.active_run);
  // Hold the shimmer until every earlier page is in, so the preview opens on
  // the whole conversation rather than on the newest window.
  const revealed = useTranscriptReveal(
    sessionId,
    (Boolean(data) && (!hasOlder || olderFailed)) || snapshot.isError,
  );
  const { scrollRef, contentRef } = useStickToBottom({ resetKey: sessionId });
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = prependAnchor.current;
    const scroller = scrollRef.current;
    if (!anchor || !scroller) return;
    scroller.scrollTop = anchor.top + (scroller.scrollHeight - anchor.height);
    prependAnchor.current = null;
  }, [scrollRef, windowStart]);

  const loadOlder = older.mutateAsync;
  useEffect(() => {
    loadingOlder.current = false;
  }, [sessionId]);
  useEffect(() => {
    if (!hasOlder || olderFailed || loadingOlder.current) return undefined;
    const scroller = scrollRef.current;
    if (scroller) {
      prependAnchor.current = { height: scroller.scrollHeight, top: scroller.scrollTop };
    }
    loadingOlder.current = true;
    let cancelled = false;
    void loadOlder()
      .then((accepted) => {
        // `false` is a settled no-op (generation moved or the page could not
        // merge), not a throw. Treat it as a failure so the shimmer cannot
        // wait forever on `has_older`.
        if (!cancelled && !accepted) setOlderFailed(true);
      })
      .catch(() => {
        if (!cancelled) setOlderFailed(true);
      })
      .finally(() => {
        loadingOlder.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [hasOlder, loadOlder, olderFailed, scrollRef, windowStart]);

  const built = useMemo(
    () => buildTranscript(data ?? null, {}, {}, live.toolEvents, pendingPermissionCallIds),
    [data, live.toolEvents, pendingPermissionCallIds],
  );
  const [drawn, setDrawn] = useState<
    (DrawnTurns & { sessionId: string; built: TranscriptTurn[]; turns: TranscriptTurn[] }) | null
  >(null);
  let current = drawn;
  if (current?.built !== built || current.sessionId !== sessionId) {
    current = {
      sessionId,
      built,
      windowStart,
      turns: keepTurnKeys(built, windowStart, current?.sessionId === sessionId ? current : null),
    };
    setDrawn(current);
  }
  const snapshotTurns = current.turns;
  const submitted = running ? data?.active_run?.submitted_user_message : undefined;
  const pendingText = submitted ? displayPromptFromMessageText(submitted.content) : "";
  const pendingSkills = submitted ? invokedSkillNames(submitted.content) : null;
  const showPending = Boolean(pendingText && lastUserText(snapshotTurns) !== pendingText);
  // A run that has started producing before its prompt is in the snapshot must
  // open a new turn. Appending those tokens to the previous reply is what made
  // the preview look like one summarizing message.
  const snapshotEnd = windowStart + (data?.messages.length ?? 0);
  const matchesRun =
    live.startedAt != null && data?.active_run?.started_at_epoch_ms === live.startedAt;
  const streamDetached =
    Boolean(live.text || live.reasoning) &&
    (live.startedAt != null
      ? !matchesRun &&
        (live.promptEnd != null
          ? snapshotEnd < live.promptEnd
          : live.baselineEnd != null
            ? snapshotEnd <= live.baselineEnd
            : true)
      : live.running && !data?.active_run);
  const streamKey =
    showPending || streamDetached
      ? `model-${windowStart + (data?.messages.length ?? 0) + 1}`
      : replyKey(snapshotTurns, windowStart);
  const turns = useMemo(
    () =>
      withStreamedOutput(
        snapshotTurns,
        { text: live.text, reasoning: live.reasoning, settled: live.settled },
        showPending || streamDetached,
        streamKey,
      ),
    [
      live.reasoning,
      live.text,
      live.settled,
      showPending,
      snapshotTurns,
      streamDetached,
      streamKey,
    ],
  );

  const lastTurn = turns[turns.length - 1];
  const liveTurn =
    running && lastTurn?.kind === "model" && (!showPending || lastTurn.key === streamKey);
  const showModelPending = running && !liveTurn;
  const streamingTurn = showPending && lastTurn?.key === streamKey;
  const model = data?.metadata.model ?? "";
  const fade = revealed
    ? "opacity-100 transition-opacity duration-300 ease-in-out"
    : "opacity-0 transition-opacity duration-300 ease-in-out";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header ? (
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-tertiary px-4">
          <SessionNameDisclosure
            key={sessionId}
            name={title}
            running={running}
            className={cn("type-strong min-w-0 flex-1 truncate text-left", "text-basic-primary")}
          />
          <Button
            size={ButtonSize.Small}
            variant={ButtonVariant.Secondary}
            content={ButtonContent.IconRight}
            aria-label="Open"
            aria-description="Open this child’s own Insights and Files"
            onClick={onOpen}
          >
            Open session
            <Icon iconName={IconName.External} />
          </Button>
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <div
          role="status"
          aria-label={revealed ? undefined : "Loading conversation"}
          className={cn(
            "pointer-events-none absolute inset-0 px-4 transition-opacity duration-150 ease-in-out",
            isMobile && !phoneHeaderInFlow ? "pt-18" : "pt-4",
            revealed ? "opacity-0" : "opacity-100 delay-200",
          )}
        >
          <ShimmerLoader rows={3} rowClassName="h-[48px]" />
        </div>
        <div
          ref={scrollRef}
          className={cn("h-full overflow-y-auto", fade, !revealed && "invisible")}
        >
          {/* Floating headers need top clearance; in-flow headers already
              reserve it. The composer still overlays the foot, so the run-out
              clears however tall it grows. */}
          <div
            ref={contentRef}
            className={cn(
              "flex flex-col px-4 pb-[calc(var(--composer-height,0px)_+_40px)] [&>*]:shrink-0",
              isMobile && !phoneHeaderInFlow ? "pt-16" : "pt-2",
            )}
          >
            <ChildTranscriptScope sessionId={sessionId} turns={snapshotTurns}>
              {snapshot.isError ? (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-2 py-4 type-body-chrome text-error-primary"
                >
                  <span>Couldn’t load the child conversation.</span>
                  <Button
                    size={ButtonSize.Medium}
                    variant={ButtonVariant.Ghost}
                    className="max-md:!min-h-11"
                    onClick={() => void snapshot.refetch()}
                  >
                    Try again
                  </Button>
                </div>
              ) : null}
              {olderFailed && hasOlder ? (
                <div role="alert" className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="type-meta text-basic-tertiary">
                    Couldn’t load older messages.
                  </span>
                  <Button
                    size={ButtonSize.Small}
                    variant={ButtonVariant.Ghost}
                    className="max-md:!min-h-11 max-md:!min-w-11"
                    onClick={() => setOlderFailed(false)}
                  >
                    Try again
                  </Button>
                </div>
              ) : null}
              {turns.map((turn, index) => {
                if (turn.kind === "delegated-completion") {
                  return <DelegatedCompletionCard key={turn.key} turn={turn} interactive={false} />;
                }
                if (turn.kind === "goal-continuation") {
                  return <GoalContinuationCard key={turn.key} sessionId={sessionId} turn={turn} />;
                }
                if (turn.kind === "user") {
                  return (
                    <UserMessage
                      key={turn.key}
                      text={turn.text}
                      invokedSkills={turn.invokedSkills}
                      messageIndex={turn.messageIndex}
                      readOnly
                    />
                  );
                }
                const lastIsThisRun = index === turns.length - 1;
                const row = (
                  <ModelMessage
                    key={turn.key}
                    turn={turn}
                    model={model}
                    active={running && lastIsThisRun}
                    isLast={false}
                    selectedThreadEpisode={null}
                    selectedGroupId={null}
                    onSelectThread={ignoreThread}
                    readOnly
                    interactive={false}
                  />
                );
                return streamingTurn && turn.key === streamKey ? (
                  <Fragment key={turn.key}>
                    <UserMessage
                      text={pendingText}
                      invokedSkills={pendingSkills}
                      pending
                      readOnly
                    />
                    {row}
                  </Fragment>
                ) : (
                  row
                );
              })}
              {showPending && !streamingTurn ? (
                <UserMessage text={pendingText} invokedSkills={pendingSkills} pending readOnly />
              ) : null}
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
                  isLast={false}
                  selectedThreadEpisode={null}
                  onSelectThread={ignoreThread}
                  readOnly
                  interactive={false}
                />
              ) : null}
              {turns.length === 0 && !running && fallbackText ? (
                <p className="type-body-chrome whitespace-pre-wrap py-4 text-basic-secondary">
                  {fallbackText}
                </p>
              ) : null}
            </ChildTranscriptScope>
          </div>
        </div>
      </div>
    </div>
  );
}
