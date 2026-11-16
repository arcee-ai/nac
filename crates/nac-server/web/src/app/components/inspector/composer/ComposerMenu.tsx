import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { goalActionLabel } from "@/app/components/inspector/goalStatus";
import { cn } from "@/app/lib/cn";
import { useSessionGoal } from "@/app/services/queries";

/** The tokens the menu can start in the field; each opens its own suggestions. */
export type ComposerToken = "/" | "$" | "!";

export interface ComposerMenuProps {
  sessionId: string;
  compact: boolean;
  /** Goals, shell commands and terminal attachments exist only in direct sessions. */
  direct: boolean;
  /** A token that replaces the field (`/`, `!`) needs an empty field. */
  fieldEmpty: boolean;
  disabled: boolean;
  onInsert: (token: ComposerToken) => void;
  onGoal: () => void;
  /** Opens the terminal, where a reviewed selection is attached to a message. */
  onAttachSelection: (() => void) | null;
}

function Row({
  icon,
  label,
  hint,
  glyph,
  disabled,
  ariaLabel,
  onClick,
}: {
  icon: IconName;
  label: string;
  hint: string;
  glyph?: string;
  disabled?: boolean;
  ariaLabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      className="flex min-h-10 w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-150 ease-out hover:bg-[var(--f-wash-2)] focus-visible:bg-[var(--f-wash-2)] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45 max-md:min-h-11"
      onPointerDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon iconName={icon} size={16} className="shrink-0 text-basic-secondary" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-label text-basic-primary">{label}</span>
        <span className="type-meta text-basic-tertiary">{hint}</span>
      </span>
      {glyph ? (
        <kbd className="code shrink-0 rounded-xs border border-tertiary px-1.5 text-[12px] leading-5 text-basic-secondary">
          {glyph}
        </kbd>
      ) : null}
    </button>
  );
}

/**
 * The composer's `+`: the things that can go into a message besides text —
 * slash commands, skills, a shell command, the session goal, and terminal
 * output. Each starts the field's own machinery rather than duplicating it.
 */
export function ComposerMenu({
  sessionId,
  compact,
  direct,
  fieldEmpty,
  disabled,
  onInsert,
  onGoal,
  onAttachSelection,
}: ComposerMenuProps) {
  const [open, setOpen] = useState(false);
  const { data: goal } = useSessionGoal(sessionId, direct);
  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };
  const goalLabel = goalActionLabel(goal);

  const content = (
    <div className="flex flex-col gap-0.5 p-1" aria-label="Add to message" role="group">
      <Row
        icon={IconName.WriteCommand}
        label="Slash command"
        hint={fieldEmpty ? "Compact, goals and MCP prompts" : "Clear the field to start one"}
        glyph="/"
        disabled={!fieldEmpty}
        onClick={() => pick(() => onInsert("/"))}
      />
      <Row
        icon={IconName.Ai}
        label="Skill"
        hint="Reference a skill in the message"
        glyph="$"
        onClick={() => pick(() => onInsert("$"))}
      />
      {direct ? (
        <>
          <Row
            icon={IconName.Terminal}
            label="Shell command"
            hint={
              fieldEmpty ? "Run a command yourself, outside the agent" : "Clear the field first"
            }
            glyph="!"
            disabled={!fieldEmpty}
            onClick={() => pick(() => onInsert("!"))}
          />
          <Row
            icon={IconName.Flag}
            label={goal ? "Goal" : "Set a goal"}
            hint={goal ? goal.objective : "Work that continues across turns, with a token budget"}
            ariaLabel={goalLabel}
            onClick={() => pick(onGoal)}
          />
          {onAttachSelection ? (
            <Row
              icon={IconName.Attachment}
              label="Attach terminal output"
              hint="Select output in the terminal to review and attach"
              onClick={() => pick(onAttachSelection)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      content={content}
      placement={PopoverPlacement.TopRight}
      sticky
      size="w-[min(300px,calc(100vw-16px))]"
    >
      <Tooltip title="Add to message" position={TooltipPosition.TopCenter} disabled={open}>
        <Button
          type="button"
          size={ButtonSize.Medium}
          variant={open ? ButtonVariant.GhostHighlighted : ButtonVariant.Ghost}
          content={ButtonContent.Icon}
          className={cn("shrink-0", compact && "!size-11 !min-h-11 !min-w-11")}
          aria-label="Add to message"
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={disabled}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon iconName={IconName.Add} size={18} />
        </Button>
      </Tooltip>
    </Popover>
  );
}
