import type React from "react";

import { cn } from "../../lib/cn";
import FileIcon from "../file-icon";
import GitStatusLabel, { GIT_STATUS_TONE, type GitStatus } from "../git-status-label";
import { codeChangesLabel } from "../file-button/CodeChangesBadge";
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
   * The design's `GH State`. A changed name reads in full ink (a deleted one
   * struck through); a file adds the coloured status letter.
   */
  status?: GitStatus | null;
  /** The design's `isActive`: the file that is open, or a folder that is expanded. */
  active?: boolean;
  /** Lines the change added, drawn as a tabular `+N` before the status letter. */
  additions?: number | null;
  /** Lines the change removed, drawn as a tabular `−N`. */
  deletions?: number | null;
}

const SIZE_STYLE: Record<FileListTabButtonSize, { box: string; label: string; icon: number }> = {
  [FileListTabButtonSize.Small]: { box: "h-7 gap-2 px-2", label: "type-body-chrome", icon: 16 },
  [FileListTabButtonSize.Large]: { box: "h-12 gap-3 px-3", label: "label-medium", icon: 20 },
};

/** Focus rows: ink on paper, an alpha wash on hover and for the open file. */
const TONE = {
  regular: cn(
    "text-basic-secondary",
    "enabled:hover:bg-[var(--f-wash-1)] enabled:hover:text-basic-primary",
    "enabled:active:bg-[var(--f-wash-2)]",
    "disabled:text-basic-muted",
  ),
  highlighted: cn(
    "bg-[var(--f-wash-2)] text-basic-primary",
    "enabled:hover:bg-[var(--f-wash-3)]",
    "disabled:text-basic-muted",
  ),
};

/** The chevron stays quiet; it follows the label through the button's states. */
const CHEVRON_TONE = cn(
  "text-fill-basic-muted",
  "group-hover/file-list-tab-button:text-fill-basic-secondary",
  "group-disabled/file-list-tab-button:opacity-50",
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
  additions,
  deletions,
  disabled = false,
  className,
  ...props
}) => {
  const counted =
    variant !== FileListTabButtonVariant.Folder &&
    (typeof additions === "number" || typeof deletions === "number");
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
      aria-description={counted ? codeChangesLabel(additions, deletions) : undefined}
      className={cn(
        "group/file-list-tab-button flex w-full min-w-0 items-center rounded-md",
        "transition-colors duration-150 ease-out disabled:cursor-not-allowed",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]",
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
            // A folder only leads to its changes; its name carries them.
            CHEVRON_TONE,
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
        {tone ? <span className="sr-only">, {tone.title}</span> : null}
      </span>
      {counted ? (
        <span
          aria-hidden
          className={cn(
            "flex shrink-0 items-center gap-1.5 type-meta tabular",
            DIMMED_WHEN_DISABLED,
          )}
        >
          {typeof additions === "number" && additions > 0 ? (
            <span className="text-[var(--f-green-text)]">+{additions}</span>
          ) : null}
          {typeof deletions === "number" && deletions > 0 ? (
            <span className="text-[var(--f-red-text)]">−{deletions}</span>
          ) : null}
        </span>
      ) : null}
      {status && !folder ? (
        <GitStatusLabel status={status} className={DIMMED_WHEN_DISABLED} />
      ) : null}
    </button>
  );
};

export default FileListTabButton;
