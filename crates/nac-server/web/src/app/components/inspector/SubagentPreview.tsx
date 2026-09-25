import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

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
import { DelegatedCompletionEvent } from "@/app/features/delegation/presentation/DelegatedCompletionEvent";
import { useDelegatedPreviewStream } from "@/app/hooks/useDelegatedPreviewStream";
import { useStickToBottom } from "@/app/hooks/useStickToBottom";
import { useTranscriptReveal } from "@/app/hooks/useTranscriptReveal";
import { cn } from "@/app/lib/cn";
import { displayPromptFromMessageText, formatStoreTime, invokedSkillNames } from "@/app/lib/format";
import { routes } from "@/app/lib/routes";
import {
  STREAMING_TURN_KEY,
  buildTranscript,
  withStreamedOutput,
  type TranscriptTurn,
} from "@/app/lib/transcript";
import { useLoadOlderMessages, useSessionSnapshot } from "@/app/services/queries";

function ignoreThread(): void {}
function ignoreWorkset(): void {}

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
 * The subagent's own conversation, the same turns the chat transcript draws,
 * including the load shimmer and the live model pill. The parent's runtime
 * store is left alone: this view reads the child's snapshot and its own stream.
 */
export function SubagentPreview({
  sessionId,
  title,
  fallbackText,
  icon,
}: {
  sessionId: string;
  title: string;
  fallbackText: string | null;
  icon: IconName;
}) {
  const navigate = useNavigate();
  const snapshot = useSessionSnapshot(sessionId, { retry: false });
  const live = useDelegatedPreviewStream(sessionId);
  const older = useLoadOlderMessages(sessionId);
  const data = snapshot.data;
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

  const snapshotTurns = useMemo(() => buildTranscript(data ?? null, {}, {}, []), [data]);
  const submitted = running ? data?.active_run?.submitted_user_message : undefined;
  const pendingText = submitted ? displayPromptFromMessageText(submitted.content) : "";
  const pendingSkills = submitted ? invokedSkillNames(submitted.content) : null;
  const showPending = Boolean(pendingText && lastUserText(snapshotTurns) !== pendingText);
  // A run that has started producing before its prompt is in the snapshot must
  // open a new turn. Appending those tokens to the previous reply is what made
  // the preview look like one summarizing message.
  const streamDetached = live.running && !data?.active_run && Boolean(live.text || live.reasoning);
  const turns = useMemo(
    () =>
      withStreamedOutput(
        snapshotTurns,
        { text: live.text, reasoning: live.reasoning },
        showPending || streamDetached,
      ),
    [live.reasoning, live.text, showPending, snapshotTurns, streamDetached],
  );

  const lastTurn = turns[turns.length - 1];
  const liveTurn =
    running && lastTurn?.kind === "model" && (!showPending || lastTurn.key === STREAMING_TURN_KEY);
  const showModelPending = running && !liveTurn;
  const streamingTurn = showPending && lastTurn?.key === STREAMING_TURN_KEY;
  const model = data?.metadata.model ?? "";
  const fade = revealed
    ? "opacity-100 transition-opacity duration-300 ease-in-out"
    : "opacity-0 transition-opacity duration-300 ease-in-out";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-muted bg-elevation-level-1 px-4">
        <Icon iconName={icon} size={20} className="shrink-0 text-basic-secondary" />
        <p
          className={cn(
            "label-small min-w-0 flex-1 truncate",
            running ? "text-shimmer-basic" : "text-basic-primary",
          )}
        >
          {title}
        </p>
        <Button
          size={ButtonSize.Small}
          variant={ButtonVariant.Ghost}
          content={ButtonContent.IconRight}
          aria-label="Open"
          onClick={() => navigate(routes.session(sessionId))}
        >
          Open
          <Icon iconName={IconName.Right} />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          role="status"
          aria-label={revealed ? undefined : "Loading conversation"}
          className={cn(
            "pointer-events-none absolute inset-0 px-4 pt-4 transition-opacity duration-150 ease-in-out",
            revealed ? "opacity-0" : "opacity-100 delay-200",
          )}
        >
          <ShimmerLoader rows={3} rowClassName="h-[48px]" />
        </div>
        <div
          ref={scrollRef}
          className={cn("h-full overflow-y-auto", fade, !revealed && "invisible")}
        >
          <div ref={contentRef} className="flex flex-col px-4 pt-2 pb-6 [&>*]:shrink-0">
            {olderFailed && hasOlder ? (
              <div role="alert" className="mb-4 flex items-center gap-2">
                <span className="label-small text-basic-muted">Couldn’t load older messages.</span>
                <Button
                  size={ButtonSize.Small}
                  variant={ButtonVariant.Ghost}
                  onClick={() => setOlderFailed(false)}
                >
                  Try again
                </Button>
              </div>
            ) : null}
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
                  selectedWorkset={null}
                  onSelectThread={ignoreThread}
                  onSelectWorkset={ignoreWorkset}
                  readOnly
                />
              );
              return streamingTurn && turn.key === STREAMING_TURN_KEY ? (
                <Fragment key={turn.key}>
                  <UserMessage text={pendingText} invokedSkills={pendingSkills} pending readOnly />
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
                selectedWorkset={null}
                onSelectThread={ignoreThread}
                onSelectWorkset={ignoreWorkset}
                readOnly
              />
            ) : null}
            {turns.length === 0 && !running && fallbackText ? (
              <p className="label-small py-4 text-basic-secondary">{fallbackText}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
