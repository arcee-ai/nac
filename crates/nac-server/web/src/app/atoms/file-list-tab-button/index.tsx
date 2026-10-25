import type React from "react";

import { cn } from "../../lib/cn";
import FileIcon from "../file-icon";
import GitStatusLabel, { GIT_STATUS_TONE, type GitStatus } from "../git-status-label";
import Icon, { IconName } from "../icon";

/** The design's RWD: Small is the desktop row, Large the phone's touch row. */
export enum FileListTabButtonSize {
  Small = "small",
  Large = "large",
}

export enum FileListTabButtonVariant {
  File = "file",
  Folder = "folder",
}

interface FileListTabButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  ref?: React.Ref<HTMLButtonElement>;
  /** The row's text: a file's name, or a folder's (a merged chain keeps its slashes). */
  name: string;
  /** Picks a file's type icon; defaults to the name. */
  path?: string;
  variant?: FileListTabButtonVariant;
  size?: FileListTabButtonSize;
  /**
   * The design's `GH State`. It tints the name through every state; a file
   * adds the status letter, a folder tints its chevron instead.
   */
  status?: GitStatus | null;
  /** The design's `isActive`: the file that is open, or a folder that is expanded. */
  active?: boolean;
}

const SIZE_STYLE: Record<FileListTabButtonSize, { box: string; label: string; icon: number }> = {
  [FileListTabButtonSize.Small]: { box: "h-7 gap-1 p-1", label: "label-micro", icon: 16 },
  [FileListTabButtonSize.Large]: { box: "h-12 gap-3 px-3 py-2", label: "label-medium", icon: 24 },
};

const TONE = {
  regular: cn(
    "bg-btn-ghost text-btn-secondary",
    "enabled:hover:bg-btn-ghost-hovered enabled:hover:text-btn-secondary-hovered",
    "enabled:active:bg-btn-ghost-pressed enabled:active:text-btn-secondary-pressed",
    "disabled:bg-btn-ghost-disabled disabled:text-btn-secondary-disabled",
  ),
  highlighted: cn(
    "bg-btn-ghost-highlighted text-btn-secondary-highlighted",
    "enabled:hover:bg-btn-ghost-highlighted-hovered",
    "enabled:active:bg-btn-ghost-highlighted-pressed enabled:active:text-btn-secondary-pressed-highlighted",
    "disabled:bg-btn-ghost-highlighted-disabled disabled:text-btn-secondary-disabled-highlighted",
  ),
};

/** A chevron without a status follows the label through the button's states. */
const CHEVRON_TONE = cn(
  "[&_path]:fill-btn-secondary",
  "group-hover/file-list-tab-button:[&_path]:fill-btn-secondary-hovered",
  "group-active/file-list-tab-button:[&_path]:fill-btn-secondary-pressed",
  "group-disabled/file-list-tab-button:[&_path]:fill-btn-secondary-disabled",
);

const DIMMED_WHEN_DISABLED = "group-disabled/file-list-tab-button:opacity-50";

/**
 * A row of the Files panel's list: a file with its type icon, or a folder with
 * a chevron that turns once it is open. A git status keeps its colour on the
 * name whatever the row's state, so hovering or opening a file never washes it
 * out; a disabled row dims that colour rather than greying it.
 *
 * Only a file is ever highlighted. A folder's `active` opens it, which the
 * chevron shows, and reaches assistive technology as `aria-expanded`; a file's
 * is `aria-pressed`.
 */
const FileListTabButton: React.FC<FileListTabButtonProps> = ({
  ref,
  name,
  path,
  variant = FileListTabButtonVariant.File,
  size = FileListTabButtonSize.Small,
  status = null,
  active = false,
  disabled = false,
  className,
  ...props
}) => {
  const style = SIZE_STYLE[size];
  const tone = status ? GIT_STATUS_TONE[status] : null;
  const folder = variant === FileListTabButtonVariant.Folder;

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-pressed={folder ? undefined : active}
      aria-expanded={folder ? active : undefined}
      className={cn(
        "group/file-list-tab-button flex w-full min-w-0 items-center rounded-[4px]",
        "transition-colors duration-150 ease-out disabled:cursor-not-allowed",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]",
        style.box,
        active && !folder ? TONE.highlighted : TONE.regular,
        className,
      )}
      {...props}
    >
      {folder ? (
        <Icon
          iconName={IconName.Right}
          size={style.icon}
          className={cn(
            "shrink-0 transition-transform",
            active && "rotate-90",
            tone ? cn(tone.fill, DIMMED_WHEN_DISABLED) : CHEVRON_TONE,
          )}
        />
      ) : (
        <FileIcon path={path ?? name} size={style.icon} className={DIMMED_WHEN_DISABLED} />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-left",
          style.label,
          tone && cn(tone.name, DIMMED_WHEN_DISABLED),
        )}
      >
        {name}
      </span>
      {status && !folder ? (
        <GitStatusLabel status={status} className={DIMMED_WHEN_DISABLED} />
      ) : null}
    </button>
  );
};

export default FileListTabButton;
