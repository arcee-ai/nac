import { useMemo } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  ChatLoader,
  Icon,
  IconName,
  ModelPill,
} from "@/app/atoms";
import { ChatBadge, CodeChangesBadge } from "@/app/components/inspector/ChatBadge";
import { ModelMessage } from "@/app/components/inspector/ModelMessage";
import { UserMessage } from "@/app/components/inspector/UserMessage";
import { useStickToBottom } from "@/app/hooks/useStickToBottom";
import { displayPromptFromMessageText } from "@/app/lib/format";
import type { SessionPanel } from "@/app/lib/routes";
import { buildTranscript, type TranscriptTurn } from "@/app/lib/transcript";
import {
  selectThread,
  selectWorkset,
  useSelectedThread,
} from "@/app/store/sessionLayoutStore";
import {
  useActivity,
  useLiveThreads,
  useRunError,
  useRunning,
  useStreamReasoning,
  useStreamText,
} from "@/app/store/runtimeStore";
import type { SessionSnapshotResponse } from "@/app/types/api";

interface TranscriptProps {
  snapshot: SessionSnapshotResponse | null;
  /** Brings the matching side panel forward when the chat points at a row. */
  onFocusPanel: (panel: SessionPanel) => void;
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
export function Transcript({ snapshot, onFocusPanel }: TranscriptProps) {
  const running = useRunning();
  const activity = useActivity();
  const error = useRunError();
  const liveThreads = useLiveThreads();
  const streamText = useStreamText();
  const streamReasoning = useStreamReasoning();
  const selectedThread = useSelectedThread();
  const { scrollRef, contentRef, showJumpButton, jumpToLatest } =
    useStickToBottom();

  const turns = useMemo(
    () => buildTranscript(snapshot, liveThreads, { text: streamText, reasoning: streamReasoning }),
    [snapshot, liveThreads, streamText, streamReasoning],
  );

  const model = snapshot?.metadata.model ?? "";
  const workspace = snapshot?.workspace ?? null;
  const additions = workspace?.total_additions ?? 0;
  const deletions = workspace?.total_deletions ?? 0;

  // While a run is in flight the just-submitted user message may not be in the
  // persisted snapshot yet; surface it from active_run so the chat feels live.
  const submitted = running ? snapshot?.active_run?.submitted_user_message : undefined;
  const pendingText = submitted
    ? displayPromptFromMessageText(submitted.content)
    : "";
  // Compared against the last *user* turn rather than the last turn of any
  // kind: everything the run produces lands after the prompt it answers, so
  // once that prompt is in the snapshot the copy is a duplicate no matter how
  // many model turns have piled up on top of it.
  const showPending = Boolean(pendingText && lastUserText(turns) !== pendingText);

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

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} className="h-full overflow-auto">
        {/* The top bar is fixed over this scroll region, so the first message
            needs to clear it. */}
        <div
          ref={contentRef}
          className="flex flex-col gap-6 pt-[72px] pb-4 [&>*]:shrink-0"
        >
          {!snapshot ? (
            <div className="text-basic-muted label-small">Loading…</div>
          ) : null}

          {snapshot && turns.length === 0 && !running && !showPending ? (
            <div className="text-basic-muted label-small">
              No messages yet. Type something below.
            </div>
          ) : null}

          {turns.map((turn, index) =>
            turn.kind === "user" ? (
              <UserMessage key={turn.key} text={turn.text} />
            ) : (
              <ModelMessage
                key={turn.key}
                turn={turn}
                model={model}
                active={running && index === turns.length - 1}
                activity={activity}
                selectedThread={selectedThread}
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

          {error && !running ? (
            <div className="rounded-xl p-3 border border-error-primary bg-error-tertiary text-error-primary label-small">
              {error}
            </div>
          ) : null}
        </div>
      </div>

      {showJumpButton ? (
        <Button
          variant={ButtonVariant.Secondary}
          size={ButtonSize.Small}
          content={ButtonContent.IconLeft}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 fade shadow-xl"
          onClick={jumpToLatest}
        >
          <Icon iconName={IconName.Down} />
          Latest
        </Button>
      ) : null}
    </div>
  );
}
