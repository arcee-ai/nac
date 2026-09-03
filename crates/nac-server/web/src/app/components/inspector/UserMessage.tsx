import { memo } from "react";

import {
  ButtonSize,
  ButtonVariant,
  CopyButton,
  Icon,
  IconName,
  TooltipPosition,
} from "@/app/atoms";
import { MessageActionIcon } from "@/app/components/inspector/MessageActionIcon";
import { cn } from "@/app/lib/cn";
import { DELEGATED_READONLY_HINT } from "@/app/lib/sessionBehavior";
import { perfRender } from "@/app/lib/perfDebug";
import { useIsMobile } from "@/app/hooks/useMediaQuery";

interface UserMessageProps {
  text: string;
  pending?: boolean;
  /**
   * Skills the stored message had expanded into the agent-facing prompt,
   * parsed from its invoked_skills wrapper. Shown as a small line under the
   * bubble so the injection is visible; null for an ordinary prompt.
   */
  invokedSkills?: string[] | null;
  /** Shown on hover when the message has a known time. */
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
  /** Parent-owned or frozen delegated turns keep mutation actions visible but inert. */
  readOnly?: boolean;
  /** Why mutation actions are locked. Shown on disabled action tooltips. */
  readOnlyReason?: string | null;
  /** Inert copy of the bubble: no hover actions. */
  preview?: boolean;
}

/** The prompt bubble. Pending ones are dimmed until the snapshot catches up. */
export const UserMessage = memo(function UserMessage({
  text,
  pending = false,
  invokedSkills = null,
  timestamp = null,
  messageIndex,
  onRefresh = null,
  onRevert = null,
  actionsDisabled = false,
  readOnly = false,
  readOnlyReason = null,
  preview = false,
}: UserMessageProps) {
  perfRender("UserMessage");
  const lockHint = readOnly ? (readOnlyReason ?? DELEGATED_READONLY_HINT) : undefined;
  const actionLocked = actionsDisabled || readOnly;
  const showResend = readOnly || (onRefresh != null && messageIndex != null);
  const canRevert = onRevert != null && messageIndex != null;
  const isMobile = useIsMobile();
  return (
    <div className="group/user-msg flex flex-col items-end w-full max-w-full pt-4 pb-8">
      <div
        className={cn(
          "py-3 px-5 rounded-[12px] bg-elevation-sublevel-variant-B shadow-convex",
          "label-small text-basic-primary whitespace-pre-wrap break-words",
          pending && "opacity-60",
        )}
      >
        {text}
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

      {!preview && !pending ? (
        <div
          className={cn(
            "flex items-center justify-end gap-3 pt-3",
            // Keep the row hittable while moving from the bubble to the actions.
            "opacity-0 pointer-events-none transition-opacity duration-150",
            "group-hover/user-msg:opacity-100 group-hover/user-msg:pointer-events-auto",
            "group-focus-within/user-msg:opacity-100 group-focus-within/user-msg:pointer-events-auto",
            // Nothing hovers on a touch screen, so the row simply stays out.
            "[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto",
          )}
        >
          {timestamp ? (
            <span className="label-micro text-basic-tertiary whitespace-nowrap truncate">
              {timestamp}
            </span>
          ) : null}

          {showResend ? (
            <MessageActionIcon
              title="Resend"
              disabled={actionLocked || messageIndex == null}
              disabledReason={lockHint}
              position={TooltipPosition.BottomLeft}
              isMobile={isMobile}
              onClick={
                messageIndex != null && onRefresh ? () => onRefresh(messageIndex) : undefined
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
            position={TooltipPosition.BottomLeft}
            isMobile={isMobile}
            onClick={
              onRevert != null && messageIndex != null
                ? () => onRevert(messageIndex, text)
                : undefined
            }
          >
            <Icon iconName={IconName.TurnLeft} size={16} />
          </MessageActionIcon>

          <CopyButton
            value={text}
            size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
            variant={isMobile ? ButtonVariant.Ghost : ButtonVariant.Tertiary}
            title="Copy message"
            position={TooltipPosition.BottomLeft}
            className="md:!h-4 md:!min-h-4 md:!p-0"
          />
        </div>
      ) : null}
    </div>
  );
});
