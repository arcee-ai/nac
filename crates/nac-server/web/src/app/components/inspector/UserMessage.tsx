import { memo } from "react";
import { TerminalSelectionAttachment } from "@/app/features/terminal-selection/TerminalSelectionAttachment";
import type { TerminalSelectionEvidence } from "@/app/types/api";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  CopyButton,
  Icon,
  IconName,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { formatMessageDate } from "@/app/features/insights/transcript/messageDate";
import { usePromptCreatedAt } from "@/app/features/insights/transcript/transcriptTurns";
import { cn } from "@/app/lib/cn";
import { perfRender } from "@/app/lib/perfDebug";

interface UserMessageProps {
  text: string;
  terminalSelection?: TerminalSelectionEvidence;
  sessionId?: string;
  pending?: boolean;
  /**
   * Skills the stored message had expanded into the agent-facing prompt,
   * parsed from its invoked_skills wrapper. Shown as a small line under the
   * bubble so the injection is visible; null for an ordinary prompt.
   */
  invokedSkills?: string[] | null;
  /**
   * Shown when the transcript has no time of its own for the message. The
   * transcript's time for `messageIndex` wins, in the chat's English format.
   */
  timestamp?: string | null;
  /**
   * Raw snapshot index the actions address. Absent while the message is still
   * only in flight, which is what disables the revert affordance.
   */
  messageIndex?: number;
  /**
   * Answer this prompt again, discarding whatever reply it already produced.
   * Only for the newest prompt — older turns keep revert + copy only — and it
   * is the newest prompt's own bubble that carries the action when a failed run
   * left it unanswered.
   *
   * The handlers take the message they act on rather than closing over it, so
   * the transcript can pass the same function to every bubble and let the
   * memoized rows skip a render.
   */
  onRefresh?: ((messageIndex: number) => void) | null;
  /** Restore the session to the snapshot at this prompt. */
  onRevert?: ((messageIndex: number, text: string) => void) | null;
  /** Disable destructive / network actions while a run is in flight. */
  actionsDisabled?: boolean;
  /** Parent-owned delegated transcripts expose copy/time but no mutation affordances. */
  readOnly?: boolean;
}

type UserMessageBodyProps = Omit<UserMessageProps, "timestamp"> & { date: string | null };

const UserMessageBody = memo(function UserMessageBody({
  text,
  terminalSelection,
  sessionId,
  pending = false,
  invokedSkills = null,
  date,
  messageIndex,
  onRefresh = null,
  onRevert = null,
  actionsDisabled = false,
  readOnly = false,
}: UserMessageBodyProps) {
  perfRender("UserMessage");
  const canRefresh = !readOnly && onRefresh != null && messageIndex != null;
  const canRevert = !readOnly && onRevert != null && messageIndex != null;
  return (
    <div className="group/user-msg flex flex-col items-end w-full max-w-full py-6">
      <div
        className={cn(
          "min-w-0 max-w-full p-5 rounded-[12px] bg-elevation-sublevel-variant-B shadow-convex",
          "label-small text-basic-primary whitespace-pre-wrap break-words",
          "transition-opacity duration-150",
          pending && "opacity-60",
        )}
      >
        {terminalSelection ? (
          <TerminalSelectionAttachment
            evidence={terminalSelection}
            canonicalText={text}
            sessionId={sessionId}
          />
        ) : (
          text
        )}
      </div>

      {invokedSkills && invokedSkills.length > 0 ? (
        <div
          className="flex items-center gap-1 pt-1.5 pr-1 label-micro text-basic-tertiary"
          title="Skill content was expanded into the prompt sent to the agent"
        >
          <Icon iconName={IconName.Bolt} size={12} color="var(--color-fill-basic-tertiary)" />
          <span>
            {invokedSkills.length === 1 ? "Skill" : "Skills"} expanded:{" "}
            {invokedSkills.map((name) => `$${name}`).join(", ")}
          </span>
        </div>
      ) : null}

      {/* A pending bubble keeps the room of the actions it gains once stored,
          so nothing under it moves when the snapshot catches up. */}
      <div
        aria-hidden={pending || undefined}
        className={cn(
          "flex items-center justify-end gap-3 max-w-full min-w-0 pt-2",
          pending && "invisible",
          // Keep the row hittable while moving from the bubble to the actions.
          "opacity-0 pointer-events-none transition-opacity duration-150",
          "group-hover/user-msg:opacity-100 group-hover/user-msg:pointer-events-auto",
          "group-focus-within/user-msg:opacity-100 group-focus-within/user-msg:pointer-events-auto",
          // Nothing hovers on a touch screen, so the row simply stays out.
          "[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto",
        )}
      >
        {date ? (
          <span className="min-w-0 label-micro text-basic-muted whitespace-nowrap truncate">
            {date}
          </span>
        ) : null}

        {canRefresh ? (
          <Tooltip
            title="Regenerate from the original prompt (rewinds later transcript and workspace changes)"
            position={TooltipPosition.BottomLeft}
          >
            <Button
              size={ButtonSize.Small}
              variant={ButtonVariant.Ghost}
              content={ButtonContent.Icon}
              aria-label="Regenerate from original prompt"
              disabled={actionsDisabled}
              onClick={() => onRefresh(messageIndex)}
            >
              <Icon iconName={IconName.Refresh} size={16} />
            </Button>
          </Tooltip>
        ) : null}

        {canRevert ? (
          <Tooltip title="Revert to this snapshot" position={TooltipPosition.BottomLeft}>
            <Button
              size={ButtonSize.Small}
              variant={ButtonVariant.Ghost}
              content={ButtonContent.Icon}
              aria-label="Revert to this snapshot"
              disabled={actionsDisabled}
              onClick={() => onRevert(messageIndex, text)}
            >
              <Icon iconName={IconName.TurnLeft} size={16} />
            </Button>
          </Tooltip>
        ) : readOnly ? null : (
          <Tooltip
            title="This message is not in the transcript yet"
            position={TooltipPosition.BottomLeft}
          >
            <span className="inline-flex">
              <Button
                size={ButtonSize.Small}
                variant={ButtonVariant.Ghost}
                content={ButtonContent.Icon}
                aria-label="Revert to this snapshot"
                disabled
              >
                <Icon iconName={IconName.TurnLeft} size={16} />
              </Button>
            </span>
          </Tooltip>
        )}

        <CopyButton
          value={text}
          size={ButtonSize.Small}
          variant={ButtonVariant.Ghost}
          title={terminalSelection ? "Copy canonical message" : "Copy message"}
          position={TooltipPosition.BottomLeft}
        />
      </div>
    </div>
  );
});

/** The prompt bubble. Pending ones are dimmed until the snapshot catches up. */
export const UserMessage = memo(function UserMessage({ timestamp, ...props }: UserMessageProps) {
  const createdAt = usePromptCreatedAt(props.messageIndex);
  return <UserMessageBody {...props} date={formatMessageDate(createdAt) ?? timestamp ?? null} />;
});
