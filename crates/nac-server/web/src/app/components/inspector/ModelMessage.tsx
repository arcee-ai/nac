import { memo, useMemo } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  ChatSessionMessage,
  ChatSessionMessageVariant,
  CopyButton,
  ForkSessionItem,
  Icon,
  IconName,
  ToolsAndReasoningBadge,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { SnapshotBadge, type FilesPanelLink } from "@/app/components/inspector/SnapshotBadge";
import { ThreadWave, type SelectThread } from "@/app/components/inspector/ThreadWave";
import { partitionModelTurn } from "@/app/features/insights/model/segments";
import { formatMessageDate } from "@/app/features/insights/transcript/messageDate";
import { TranscriptGroupBadge } from "@/app/features/insights/transcript/TranscriptGroupBadge";
import { TranscriptSessionCard } from "@/app/features/insights/transcript/TranscriptSessionCard";
import {
  usePreviousTurn,
  usePromptCreatedAt,
} from "@/app/features/insights/transcript/transcriptTurns";
import { cn } from "@/app/lib/cn";
import { Markdown } from "@/app/lib/markdown";
import { perfRender } from "@/app/lib/perfDebug";
import { RUN_CANCELLED_MARKER, type ModelTurn, type TranscriptTurn } from "@/app/lib/transcript";
import type { SessionForkLink, WorkspaceRevision } from "@/app/types/api";

/** Visible prose from the turn — what Copy puts on the clipboard. */
function modelCopyText(turn: ModelTurn): string {
  return turn.blocks
    .filter((block) => block.kind === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

/** Must match the activity the runtime store sets when orchestrator compaction starts. */
const COMPACTION_ACTIVITY = "Compacting context…";

/** Dimmed at rest; keyboard focus lifts it so the focus ring keeps its contrast. */
const ACTION_CLASS =
  "opacity-75 hover:opacity-100 focus-visible:opacity-100 max-md:!size-11 max-md:!min-h-11";

/**
 * What the run is busy with when nothing in the turn shows it. The badge only
 * lends its look: with nothing to open it stays inert, and the status carries
 * the label.
 */
function RunStatusBadge({ label }: { label: string }) {
  return (
    <div role="status">
      <span className="sr-only">{label}</span>
      <div inert className="flex">
        <ToolsAndReasoningBadge label={label} inProgress />
      </div>
    </div>
  );
}

interface ModelMessageProps {
  turn: ModelTurn;
  model: string;
  /** This turn is the one still producing output, so it has no actions yet. */
  active: boolean;
  /**
   * What the run is doing right now, of which only the compaction status is
   * shown: live badges and thread waves already name tools and threads. Only
   * the active turn is given it, so the finished ones are not re-rendered every
   * time the line changes.
   */
  activity?: string;
  /** Stretches the last bubble so stick-to-bottom lands below the fold. */
  isLast?: boolean;
  /** Episode key of the thread card the panels are pointing at, if any. */
  selectedThreadEpisode: string | null;
  /** Id of the group the panels are pointing at, if any. */
  selectedGroupId?: string | null;
  onSelectThread: SelectThread;
  /**
   * Snapshot index of the user prompt this model turn answers. Regenerate and
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
  /** Forks created from this model turn. */
  forks?: SessionForkLink[];
  onOpenFork?: (sessionId: string) => void;
  onDismissFork?: (forkId: string) => void;
  /** Disable destructive / network actions while a run is in flight. */
  actionsDisabled?: boolean;
  /** Parent-owned delegated transcripts expose copy but no mutation affordances. */
  readOnly?: boolean;
  /**
   * The revision captured for the run behind this turn, when that run changed
   * anything. Absent on a turn whose run is still going, was cancelled, or
   * touched no files.
   */
  snapshotRevision?: WorkspaceRevision | null;
  /** Where a click on the snapshot or one of its files should land. */
  filesPanel?: FilesPanelLink | null;
  /**
   * Badges and cards open what they stand for. Off where the turns belong to
   * a transcript the session page is not showing, which they then only sum up.
   */
  interactive?: boolean;
}

interface ModelMessageBodyProps extends ModelMessageProps {
  previous: TranscriptTurn | undefined;
  date: string | null;
}

const ModelMessageBody = memo(function ModelMessageBody({
  turn,
  previous,
  date,
  active,
  activity,
  isLast = false,
  selectedThreadEpisode,
  selectedGroupId = null,
  onSelectThread,
  userMessageIndex,
  userText = "",
  onRefresh = null,
  onRevert = null,
  onFork = null,
  forks = [],
  onOpenFork,
  onDismissFork,
  actionsDisabled = false,
  readOnly = false,
  snapshotRevision = null,
  filesPanel = null,
  interactive = true,
}: ModelMessageBodyProps) {
  perfRender("ModelMessage");
  const items = useMemo(() => partitionModelTurn(turn, previous), [turn, previous]);
  const compacting = active && activity === COMPACTION_ACTIVITY;
  const canRefresh = !readOnly && onRefresh != null && userMessageIndex != null;
  const canRevert = !readOnly && onRevert != null && userMessageIndex != null;
  const forkIndex = turn.messageIndex;
  const copyText = modelCopyText(turn);
  // The stop applies to the whole turn, including the files its runs had
  // already written, so it closes the turn below the snapshot rather than
  // sitting wherever the marker happens to fall between the blocks.
  const cancelled = turn.blocks.some(
    (block) => block.kind === "text" && block.text.trim() === RUN_CANCELLED_MARKER,
  );
  const frame = cn(
    "flex flex-col items-start gap-6 w-full max-w-full min-w-0 py-6",
    isLast && "min-h-[calc(70vh-316px)]",
  );
  // Until the run shows anything, the reply is only the word that it is working.
  if (active && items.length === 0 && !compacting) {
    return (
      <div className={frame}>
        <p role="status" className="label-small text-shimmer-primary">
          Working…
        </p>
      </div>
    );
  }
  return (
    <div className={frame}>
      {/* Nothing in here clips: a badge's focus ring reaches 4px past it, which
          the inset keeps inside the chat's scroll area. */}
      <div className="flex flex-col items-start gap-6 w-full min-w-0 md:pl-2">
        {items.map((item, index) => {
          if (item.kind === "group") {
            return (
              <TranscriptGroupBadge
                key={item.id}
                group={item.group}
                active={active}
                trailing={!compacting && index === items.length - 1}
                selected={item.id === selectedGroupId}
                interactive={interactive}
              />
            );
          }
          if (item.kind === "session") {
            return <TranscriptSessionCard key={item.id} entry={item} interactive={interactive} />;
          }
          const { block } = item;
          if (block.kind === "wave") {
            return (
              <ThreadWave
                key={block.key}
                rows={block.rows}
                selected={selectedThreadEpisode}
                onSelect={interactive ? onSelectThread : undefined}
              />
            );
          }
          if (block.text.trim() === RUN_CANCELLED_MARKER) return null;
          return (
            <Markdown
              key={block.key}
              streaming={active}
              // The prose skin's paragraph margins would add to the gap between items.
              className="[&>:first-child]:!mt-0 [&>:last-child]:!mb-0"
            >
              {block.text}
            </Markdown>
          );
        })}
        {/* Compaction runs between model calls, so nothing above moves while it does. */}
        {compacting ? <RunStatusBadge label={COMPACTION_ACTIVITY} /> : null}
        {!active && snapshotRevision && filesPanel ? (
          <SnapshotBadge revision={snapshotRevision} panel={filesPanel} />
        ) : null}
        {cancelled ? (
          <ChatSessionMessage
            variant={ChatSessionMessageVariant.Danger}
            title="Run cancelled by user"
          />
        ) : null}
      </div>

      {!readOnly && forks.length > 0 ? (
        <div className="flex flex-col gap-2 w-full min-w-0 md:pl-2 [&>*]:shrink-0">
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
      {!active ? (
        <div className="flex items-center gap-6 w-full min-w-0">
          <div className="flex items-center gap-3 shrink-0">
            {canRefresh ? (
              <Tooltip
                title="Regenerate from the original prompt (rewinds later transcript and workspace changes)"
                position={TooltipPosition.BottomRight}
              >
                <Button
                  size={ButtonSize.Small}
                  variant={ButtonVariant.Ghost}
                  content={ButtonContent.Icon}
                  aria-label="Regenerate from original prompt"
                  disabled={actionsDisabled}
                  onClick={() => onRefresh(userMessageIndex)}
                  className={ACTION_CLASS}
                >
                  <Icon iconName={IconName.Refresh} size={16} />
                </Button>
              </Tooltip>
            ) : null}

            {canRevert ? (
              <Tooltip title="Revert to this snapshot" position={TooltipPosition.BottomRight}>
                <Button
                  size={ButtonSize.Small}
                  variant={ButtonVariant.Ghost}
                  content={ButtonContent.Icon}
                  aria-label="Revert to this snapshot"
                  disabled={actionsDisabled}
                  onClick={() => onRevert(userMessageIndex, userText)}
                  className={ACTION_CLASS}
                >
                  <Icon iconName={IconName.TurnLeft} size={16} />
                </Button>
              </Tooltip>
            ) : readOnly ? null : (
              <Tooltip
                title="This message is not in the transcript yet"
                position={TooltipPosition.BottomRight}
              >
                <span className="inline-flex">
                  <Button
                    size={ButtonSize.Small}
                    variant={ButtonVariant.Ghost}
                    content={ButtonContent.Icon}
                    aria-label="Revert to this snapshot"
                    disabled
                    className={ACTION_CLASS}
                  >
                    <Icon iconName={IconName.TurnLeft} size={16} />
                  </Button>
                </span>
              </Tooltip>
            )}

            {!readOnly && onFork != null && forkIndex != null ? (
              <Tooltip title="Create fork" position={TooltipPosition.BottomRight}>
                <Button
                  size={ButtonSize.Small}
                  variant={ButtonVariant.Ghost}
                  content={ButtonContent.Icon}
                  aria-label="Create fork"
                  disabled={actionsDisabled}
                  onClick={() => onFork(forkIndex)}
                  className={ACTION_CLASS}
                >
                  <Icon iconName={IconName.Scheme} size={16} />
                </Button>
              </Tooltip>
            ) : null}

            <CopyButton
              value={copyText}
              size={ButtonSize.Small}
              variant={ButtonVariant.Ghost}
              title="Copy message"
              position={TooltipPosition.BottomRight}
              iconSize={16}
              className={ACTION_CLASS}
            />
          </div>
          {date ? (
            <span className="min-w-0 truncate label-2xs text-basic-muted whitespace-nowrap">
              {date}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

/**
 * Everything the model did for one prompt, in the order it happened: groups of
 * reasoning and tool calls, prose, the sessions it launched and the waves of
 * threads it ran.
 */
export const ModelMessage = memo(function ModelMessage(props: ModelMessageProps) {
  const previous = usePreviousTurn(props.turn);
  const promptCreatedAt = usePromptCreatedAt(props.userMessageIndex);
  // The exchange is dated by what the turn answers: a prompt, or a completion.
  const createdAt = previous && previous.kind !== "model" ? previous.createdAt : promptCreatedAt;
  return <ModelMessageBody {...props} previous={previous} date={formatMessageDate(createdAt)} />;
});
