import { memo } from "react";

import {
  ButtonSize,
  ButtonVariant,
  ChatSessionMessage,
  ChatSessionMessageVariant,
  CopyButton,
  ForkSessionItem,
  Icon,
  IconName,
  SessionType,
  SessionTypeAvatar,
  sessionTypeIconName,
  TooltipPosition,
} from "@/app/atoms";
import { ChatBadge } from "@/app/components/inspector/ChatBadge";
import { MessageActionIcon } from "@/app/components/inspector/MessageActionIcon";
import { AgentToolsGroupButton } from "@/app/components/inspector/agent-segments/AgentToolsGroupButton";
import { SnapshotBadge, type FilesPanelLink } from "@/app/components/inspector/SnapshotBadge";
import { SpawnedSessionCard } from "@/app/components/inspector/SpawnedSessionCard";
import { ThreadWave } from "@/app/components/inspector/ThreadWave";
import { ToolCallDetail } from "@/app/components/inspector/ToolCallDetail";
import { cn } from "@/app/lib/cn";
import { formatDurationShort, formatSeconds } from "@/app/lib/format";
import { Markdown } from "@/app/lib/markdown";
import { perfRender } from "@/app/lib/perfDebug";
import { DELEGATED_READONLY_HINT } from "@/app/lib/sessionBehavior";
import { partitionAgentTranscript, turnOriginKey } from "@/app/lib/agentSegments";
import { RUN_CANCELLED_MARKER, type ModelTurn, type TranscriptBlock } from "@/app/lib/transcript";
import type { SessionForkLink, WorkspaceRevision } from "@/app/types/api";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

/**
 * "Thinking" for reasoning that is still arriving, so the badge names what the
 * model is doing rather than what it produced. Once it is over the badge carries
 * how long the model spent on it, whenever the backend timed the call.
 */
function thoughtsLabel(block: { streaming: boolean; durationMs: number | null }): string {
  if (block.streaming) return "Thinking";
  if (block.durationMs == null) return "Thoughts";
  return `Thoughts, ${formatSeconds(block.durationMs)}`;
}

/** Visible prose from the turn — what Copy puts on the clipboard. */
function modelCopyText(turn: ModelTurn): string {
  return turn.blocks
    .filter((block) => block.kind === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

interface ModelMessageProps {
  turn: ModelTurn;
  model: string;
  /** Agent vs Orchestrator mark beside the model name. */
  sessionType?: `${SessionType}`;
  /** Shimmers the session avatar while this turn is still producing output. */
  active: boolean;
  /**
   * What the run is doing right now. Only the active turn is given it, so the
   * finished ones are not re-rendered every time the line changes.
   */
  activity?: string;
  /** Stretches the last bubble so stick-to-bottom lands below the fold. */
  isLast?: boolean;
  /** Episode key of the thread card the panels are pointing at, if any. */
  selectedThreadEpisode: string | null;
  selectedWorkset: string | null;
  /** Spawned child the Related Sessions panel is pointing at, if any. */
  selectedSpawn?: string | null;
  /** Thoughts & tools group the side panel is pointing at, if any. */
  selectedAgentSegment?: string | null;
  onSelectThread: (name: string, episodeKey: string) => void;
  onSelectWorkset: (id: string) => void;
  onSelectAgentSegment?: (id: string, childSessionId?: string | null) => void;
  /**
   * Snapshot index of the user prompt this model turn answers. Resend and
   * revert address that prompt — same endpoints as the user bubble above.
   */
  userMessageIndex?: number;
  /** Prompt text handed to revert so the confirm modal can quote it. */
  userText?: string;
  /**
   * Answer the preceding prompt again. Only the model turn that answered the
   * newest user message gets this — older turns keep revert + copy only, and a
   * newest prompt nothing answered keeps the action on its own bubble.
   */
  onRefresh?: ((messageIndex: number) => void) | null;
  /** Restore the session to the snapshot at the preceding prompt. */
  onRevert?: ((messageIndex: number, text: string) => void) | null;
  /** Clone this turn into a new chat. */
  onFork?: ((messageIndex: number) => void) | null;
  /** Open an idle chat of the other type from this turn. */
  onContinue?: ((messageIndex: number) => void) | null;
  continueLabel?: string;
  /** Forks created from this model turn. */
  forks?: SessionForkLink[];
  onOpenFork?: (sessionId: string) => void;
  onDismissFork?: (forkId: string) => void;
  /** Disable destructive / network actions while a run is in flight. */
  actionsDisabled?: boolean;
  /** Parent-owned or frozen delegated turns keep mutation actions visible but inert. */
  readOnly?: boolean;
  /** Why mutation actions are locked. Shown on disabled action tooltips. */
  readOnlyReason?: string | null;
  /**
   * The revision captured for the run behind this turn, when that run changed
   * anything. Absent on a turn whose run is still going, was cancelled, or
   * touched no files.
   */
  snapshotRevision?: WorkspaceRevision | null;
  /** Where a click on the snapshot or one of its files should land. */
  filesPanel?: FilesPanelLink | null;
  /** Inert copy: no hover actions, forks, or spawn controls. */
  preview?: boolean;
  /** Parent session that owns `session_spawn` cards in this turn. */
  spawnParentSessionId?: string;
}

/**
 * Everything the orchestrator did for one prompt, in the order it happened:
 * reasoning, prose, the worksets it defined and the waves of threads it ran.
 */
export const ModelMessage = memo(function ModelMessage({
  turn,
  model,
  sessionType = SessionType.Agent,
  active,
  activity,
  isLast = false,
  selectedThreadEpisode,
  selectedWorkset,
  selectedSpawn = null,
  selectedAgentSegment = null,
  onSelectThread,
  onSelectWorkset,
  onSelectAgentSegment,
  userMessageIndex,
  userText = "",
  onRefresh = null,
  onRevert = null,
  onFork = null,
  onContinue = null,
  continueLabel = "Continue",
  forks = [],
  onOpenFork,
  onDismissFork,
  actionsDisabled = false,
  readOnly = false,
  readOnlyReason = null,
  snapshotRevision = null,
  filesPanel = null,
  preview = false,
  spawnParentSessionId,
}: ModelMessageProps) {
  perfRender("ModelMessage");
  const lockHint = readOnly ? (readOnlyReason ?? DELEGATED_READONLY_HINT) : undefined;
  const actionLocked = actionsDisabled || readOnly;
  const showResend = readOnly || (onRefresh != null && userMessageIndex != null);
  const canRevert = onRevert != null && userMessageIndex != null;
  const forkIndex = turn.messageIndex;
  const showFork = readOnly || (onFork != null && forkIndex != null);
  const showContinue = readOnly || (onContinue != null && forkIndex != null);
  const copyText = modelCopyText(turn);
  // The stop applies to the whole turn, including the files its runs had
  // already written, so it closes the turn below the snapshot rather than
  // sitting wherever the marker happens to fall between the blocks.
  const cancelled = turn.blocks.some(
    (block) => block.kind === "text" && block.text.trim() === RUN_CANCELLED_MARKER,
  );
  const isMobile = useIsMobile();
  const renderTranscriptBlock = (block: TranscriptBlock) => {
    switch (block.kind) {
      case "thoughts":
        // Empty reasoning (e.g. stripped tool-call markup, or a bare
        // thinking signal with no text) should not leave a hollow badge.
        if (!block.text.trim()) return null;
        return (
          <ChatBadge
            key={block.key}
            label={thoughtsLabel(block)}
            pending={block.streaming}
            body={block.text}
          />
        );
      case "text":
        if (block.text.trim() === RUN_CANCELLED_MARKER) return null;
        return (
          <Markdown key={block.key} streaming={active}>
            {block.text}
          </Markdown>
        );
      case "workset":
        return (
          <ChatBadge
            key={block.key}
            label={
              block.worksetId
                ? `Worksets_${block.worksetId}`
                : block.pending
                  ? "Defining worksets…"
                  : "Worksets"
            }
            pending={block.pending}
            active={selectedWorkset === block.worksetId}
            onClick={() => {
              onSelectAgentSegment?.(`${turnOriginKey(turn)}:workset-${block.key}`);
              onSelectWorkset(block.worksetId);
            }}
          />
        );
      case "tool":
        return (
          <ChatBadge
            key={block.key}
            label={block.pending ? `${block.name}…` : block.name}
            pending={block.pending}
          />
        );
      case "tool-detail":
        return <ToolCallDetail key={block.key} tool={block.presentation} />;
      case "wave":
        return (
          <ThreadWave
            key={block.key}
            rows={block.rows}
            selected={selectedThreadEpisode}
            onSelect={onSelectThread}
          />
        );
      default:
        return null;
    }
  };
  return (
    <div
      className={cn(
        "group/model-msg flex gap-1 items-start w-full max-w-full py-8 relative",
        isLast && "min-h-[calc(70vh-316px)]",
      )}
    >
      <div className="flex flex-col flex-grow gap-1 pt-2 md:max-w-[calc(100%-36px)] min-w-0">
        <div className="flex gap-3 items-center mb-4 min-w-0">
          <SessionTypeAvatar sessionType={sessionType} running={active} className="shrink-0" />
          <span className="label-small text-basic-primary truncate">{model}</span>
          {/* The header carries whichever of the two is available: what the run
              is doing now, or how long it took once it is over. */}
          {active && activity ? (
            <>
              {" "}
              {/*<span className="label-micro text-shimmer-basic min-w-0 truncate max-w-[120px]">
              {activity}
            </span>*/}
            </>
          ) : turn.durationMs != null ? (
            <span className="label-micro text-basic-muted shrink-0 fade">
              {formatDurationShort(turn.durationMs)}
            </span>
          ) : null}
        </div>

        <div
          className={cn(
            "chat-response chat-response-content paragraph-medium text-basic-secondary relative w-full min-w-0 md:pl-3",
            active && "streaming",
          )}
        >
          {partitionAgentTranscript(turn, active).map((item) => {
            if (item.kind === "group") {
              return (
                <AgentToolsGroupButton
                  key={item.group.id}
                  group={item.group}
                  active={selectedAgentSegment === item.group.id}
                  onSelect={onSelectAgentSegment ?? (() => undefined)}
                />
              );
            }
            if (item.kind === "spawn") {
              if (!spawnParentSessionId) return null;
              return (
                <SpawnedSessionCard
                  key={item.group.id}
                  group={item.group}
                  parentSessionId={spawnParentSessionId}
                  active={selectedAgentSegment === item.group.id}
                  selectedChildId={selectedSpawn}
                  inert={preview}
                  onSelect={onSelectAgentSegment}
                />
              );
            }
            return renderTranscriptBlock(item.block);
          })}
          {snapshotRevision && filesPanel ? (
            <SnapshotBadge revision={snapshotRevision} panel={filesPanel} />
          ) : null}
          {cancelled ? (
            <ChatSessionMessage
              variant={ChatSessionMessageVariant.Danger}
              title="Run cancelled by user"
            />
          ) : null}
        </div>

        {!preview && !readOnly && forks.length > 0 ? (
          <div className="flex flex-col gap-2 pt-4 md:pl-3 [&>*]:shrink-0">
            {forks.map((fork) => (
              <ForkSessionItem
                key={fork.session_id}
                sessionId={fork.session_id}
                title={fork.title}
                deleted={fork.deleted}
                onOpen={onOpenFork ? () => onOpenFork(fork.session_id) : undefined}
                onDismiss={
                  onDismissFork && fork.deleted ? () => onDismissFork(fork.session_id) : undefined
                }
              />
            ))}
          </div>
        ) : null}

        {/* Same resend / revert endpoints as the user bubble above — they always
            address that prompt. Hidden while this turn is still streaming. */}
        {!preview && !active ? (
          <div
            className={cn(
              "flex items-center justify-start gap-3 pt-4 md:pl-3",
              "opacity-0 pointer-events-none transition-opacity duration-150",
              "group-hover/model-msg:opacity-100 group-hover/model-msg:pointer-events-auto",
              "group-focus-within/model-msg:opacity-100 group-focus-within/model-msg:pointer-events-auto",
              // Nothing hovers on a touch screen, so the row simply stays out.
              "[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto",
            )}
          >
            {showResend ? (
              <MessageActionIcon
                title="Resend"
                disabled={actionLocked || userMessageIndex == null}
                disabledReason={lockHint}
                position={TooltipPosition.BottomRight}
                isMobile={isMobile}
                onClick={
                  userMessageIndex != null && onRefresh
                    ? () => onRefresh(userMessageIndex)
                    : undefined
                }
              >
                <Icon iconName={IconName.Refresh} size={16} />
              </MessageActionIcon>
            ) : null}

            <MessageActionIcon
              title="Revert to this snapshot"
              disabled={actionLocked || !canRevert}
              disabledReason={
                lockHint ?? (canRevert ? null : "This message is not in the transcript yet")
              }
              position={TooltipPosition.BottomRight}
              isMobile={isMobile}
              onClick={
                onRevert != null && userMessageIndex != null
                  ? () => onRevert(userMessageIndex, userText)
                  : undefined
              }
            >
              <Icon iconName={IconName.TurnLeft} size={16} />
            </MessageActionIcon>

            {showFork ? (
              <MessageActionIcon
                title="Create fork"
                disabled={actionLocked || forkIndex == null}
                disabledReason={lockHint}
                position={TooltipPosition.BottomRight}
                isMobile={isMobile}
                onClick={forkIndex != null && onFork ? () => onFork(forkIndex) : undefined}
              >
                <Icon iconName={IconName.Scheme} size={16} />
              </MessageActionIcon>
            ) : null}

            {showContinue ? (
              <MessageActionIcon
                title={continueLabel}
                disabled={actionLocked || forkIndex == null}
                disabledReason={lockHint}
                position={TooltipPosition.BottomRight}
                isMobile={isMobile}
                onClick={forkIndex != null && onContinue ? () => onContinue(forkIndex) : undefined}
              >
                <Icon
                  iconName={sessionTypeIconName(
                    sessionType === SessionType.Orchestrator
                      ? SessionType.Agent
                      : SessionType.Orchestrator,
                  )}
                  size={16}
                />
              </MessageActionIcon>
            ) : null}

            <CopyButton
              value={copyText}
              size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
              variant={isMobile ? ButtonVariant.Ghost : ButtonVariant.Tertiary}
              title="Copy message"
              position={TooltipPosition.BottomRight}
              className="md:!h-4 md:!min-h-4 md:!p-0"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
});
