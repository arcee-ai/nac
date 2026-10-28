import type React from "react";

import { cn } from "../../lib/cn";
import Badge, { BadgeColor } from "../badge";
import Icon, { IconName } from "../icon";

/** The design's RWD: Small is the desktop and tablet row, Large the phone's touch row. */
export enum TerminalTabButtonSize {
  Small = "small",
  Large = "large",
}

interface TerminalTabButtonProps {
  /** The terminal's name. */
  label: string;
  /** The design's `owner: Agent` tag: the agent runs the terminal or holds its input. */
  agent?: boolean;
  /** Spoken after the name and the tag, never drawn: the row's process state. */
  description?: string;
  size?: TerminalTabButtonSize;
  /** The design's `isActive`: the terminal that is open. */
  active?: boolean;
  disabled?: boolean;
  /** Full text for a pointer, when the label truncates. */
  title?: string;
  onClick?: () => void;
  /**
   * The design's trailing trash. A small row shows it on hover, or always on a
   * screen without hover, such as a touch tablet's; a phone's row always does.
   */
  remove?: { label: string; onClick: () => void; disabled?: boolean };
  className?: string;
}

const SIZE_STYLE: Record<
  TerminalTabButtonSize,
  { box: string; name: string; label: string; icon: number }
> = {
  [TerminalTabButtonSize.Small]: {
    box: "h-7 gap-1 p-1 pl-2",
    name: "gap-1",
    label: "label-micro",
    icon: 16,
  },
  [TerminalTabButtonSize.Large]: {
    box: "h-12 gap-3 px-3 py-2",
    name: "gap-2",
    label: "label-medium",
    icon: 20,
  },
};

const TONE = {
  regular: cn(
    "bg-btn-ghost text-btn-secondary",
    "hover:bg-btn-ghost-hovered hover:text-btn-secondary-hovered",
    "active:bg-btn-ghost-pressed active:text-btn-secondary-pressed",
  ),
  highlighted: cn(
    "bg-btn-ghost-highlighted text-btn-secondary-highlighted",
    "hover:bg-btn-ghost-highlighted-hovered",
    "active:bg-btn-ghost-highlighted-pressed active:text-btn-secondary-pressed-highlighted",
  ),
  disabled: "bg-btn-ghost-disabled text-btn-secondary-disabled",
  disabledHighlighted: "bg-btn-ghost-highlighted-disabled text-btn-secondary-disabled-highlighted",
};

const REMOVE_TONE = cn(
  "[&_path]:fill-btn-destructive",
  "hover:[&_path]:fill-btn-destructive-hovered",
  "active:[&_path]:fill-btn-destructive-pressed",
  "disabled:[&_path]:fill-btn-destructive-disabled",
);

/**
 * A row of the Terminal panel's list. The row is one control that opens the
 * terminal, with the trash beside it as a second, so the two never nest; the
 * opening control stretches under the whole row and the trash sits above it.
 *
 * The row draws the focus ring for its opening control, as the design does,
 * and the trash draws its own.
 */
const TerminalTabButton: React.FC<TerminalTabButtonProps> = ({
  label,
  agent = false,
  description,
  size = TerminalTabButtonSize.Small,
  active = false,
  disabled = false,
  title,
  onClick,
  remove,
  className,
}) => {
  const style = SIZE_STYLE[size];
  const small = size === TerminalTabButtonSize.Small;
  return (
    <div
      className={cn(
        "group/terminal-tab-button relative flex w-full min-w-0 items-center rounded-[4px]",
        "transition-colors duration-150 ease-out",
        style.box,
        disabled
          ? cn(active ? TONE.disabledHighlighted : TONE.disabled, "cursor-not-allowed")
          : active
            ? TONE.highlighted
            : TONE.regular,
        className,
      )}
    >
      <button
        type="button"
        data-terminal-tab=""
        aria-label={[label, agent && "Agent", description].filter(Boolean).join(", ")}
        aria-pressed={active}
        disabled={disabled}
        title={title}
        onClick={onClick}
        className={cn(
          "flex min-w-0 flex-1 items-center self-stretch text-left outline-none",
          "after:absolute after:inset-0 after:rounded-[4px] disabled:cursor-not-allowed",
          "before:pointer-events-none before:absolute before:-inset-1 before:hidden before:rounded-[6px] before:border-2 before:border-[var(--color-border-focus-outline)] focus-visible:before:block",
          style.name,
        )}
      >
        <span className={cn("min-w-0 truncate", style.label)}>{label}</span>
        {agent ? (
          <Badge text="Agent" color={BadgeColor.Blue} background={false} className="shrink-0" />
        ) : null}
      </button>
      {remove ? (
        <button
          type="button"
          aria-label={remove.label}
          title={remove.label}
          disabled={remove.disabled}
          onClick={remove.onClick}
          className={cn(
            "relative z-10 flex shrink-0 items-center justify-center rounded-[8px]",
            "transition-opacity duration-150 ease-out disabled:cursor-not-allowed",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]",
            small &&
              "opacity-0 group-hover/terminal-tab-button:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
            REMOVE_TONE,
          )}
        >
          <Icon iconName={IconName.Trash} size={style.icon} />
        </button>
      ) : null}
    </div>
  );
};

export default TerminalTabButton;
