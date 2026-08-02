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
import { buildTranscript } from "@/app/lib/transcript";
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
} from "@/app/store/runtimeStore";
import type { SessionSnapshotResponse } from "@/app/types/api";

interface TranscriptProps {
  snapshot: SessionSnapshotResponse | null;
  /** Brings the matching side panel forward when the chat points at a row. */
  onFocusPanel: (panel: SessionPanel) => void;
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
  const selectedThread = useSelectedThread();
  const { scrollRef, contentRef, showJumpButton, jumpToLatest } =
    useStickToBottom();

  const turns = useMemo(
    () => buildTranscript(snapshot, liveThreads),
    [snapshot, liveThreads],
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
  const last = turns[turns.length - 1];
  const showPending = Boolean(
    pendingText && !(last?.kind === "user" && last.text === pendingText),
  );

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
                selectedThread={selectedThread}
                onSelectThread={focusThread}
                onSelectWorkset={focusWorkset}
              />
            ),
          )}

          {showPending ? <UserMessage text={pendingText} pending /> : null}

          {running ? (
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
