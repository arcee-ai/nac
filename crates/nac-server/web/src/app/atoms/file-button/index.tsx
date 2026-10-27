import type React from "react";

import { cn } from "../../lib/cn";
import FileIcon from "../file-icon";
import CodeChangesBadge, { CodeChangesBadgeSize, codeChangesLabel } from "./CodeChangesBadge";

export enum FileButtonSize {
  Small = "small",
  Medium = "medium",
  Large = "large",
}

interface FileButtonProps {
  ref?: React.Ref<HTMLButtonElement>;
  /** Picks the icon and is shown whole in the tooltip. */
  path: string;
  /** Defaults to the path's base name. */
  label?: string;
  size?: FileButtonSize;
  /** The design's `isActive`: highlights the file that is open, for example. */
  active?: boolean;
  disabled?: boolean;
  /** Either count adds the change badge after the label. */
  additions?: number | null;
  deletions?: number | null;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  className?: string;
}

interface SizeStyle {
  box: string;
  label: string;
  icon: number;
  badge: CodeChangesBadgeSize;
}

const SIZE_STYLE: Record<FileButtonSize, SizeStyle> = {
  [FileButtonSize.Small]: {
    box: "gap-1.5 py-1 pl-1 pr-3",
    label: "label-micro",
    icon: 16,
    badge: CodeChangesBadgeSize.Small,
  },
  [FileButtonSize.Medium]: {
    box: "gap-1.5 py-2 pl-2 pr-4",
    label: "label-small",
    icon: 20,
    badge: CodeChangesBadgeSize.Medium,
  },
  [FileButtonSize.Large]: {
    box: "gap-2 py-3 pl-3 pr-6",
    label: "label-medium",
    icon: 24,
    badge: CodeChangesBadgeSize.Large,
  },
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
    "enabled:hover:bg-btn-ghost-highlighted-hovered enabled:hover:text-btn-secondary-hovered-highlighted",
    "enabled:active:bg-btn-ghost-highlighted-pressed enabled:active:text-btn-secondary-pressed-highlighted",
    "disabled:bg-btn-ghost-highlighted-disabled disabled:text-btn-secondary-disabled",
  ),
};

const DIMMED_WHEN_DISABLED = "group-disabled/file-button:opacity-50";

const baseName = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;

/**
 * A file as a ghost button: its type icon, its name and, when known, how many
 * lines the change added and removed. The name truncates with an ellipsis
 * once the button runs out of room; the icon and the counts keep their width.
 * It is as wide as its content, so a caller that lines several up stretches
 * it with `w-full`.
 *
 * The accessible name is the label followed by the spelled-out counts
 * ("index.tsx, 279 additions, 84 deletions"), so it starts with the visible
 * text, and the full path in the tooltip becomes its description. The focus
 * ring is the one `.btn:focus-visible` draws for every other button.
 */
const FileButton: React.FC<FileButtonProps> = ({
  ref,
  path,
  label,
  size = FileButtonSize.Small,
  active = false,
  disabled = false,
  additions,
  deletions,
  onClick,
  className,
}) => {
  const style = SIZE_STYLE[size];
  const shownLabel = label || baseName(path);
  const accessibleName = [shownLabel, codeChangesLabel(additions, deletions)]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      ref={ref}
      type="button"
      title={path}
      aria-label={accessibleName}
      aria-current={active || undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group/file-button inline-flex min-w-0 max-w-full items-center rounded-[4px]",
        "transition-colors duration-150 ease-out disabled:cursor-not-allowed",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]",
        style.box,
        active ? TONE.highlighted : TONE.regular,
        className,
      )}
    >
      <FileIcon
        path={path}
        size={style.icon}
        className={active ? undefined : DIMMED_WHEN_DISABLED}
      />
      <span className={cn("min-w-0 truncate", style.label)}>{shownLabel}</span>
      <CodeChangesBadge
        additions={additions}
        deletions={deletions}
        size={style.badge}
        className={DIMMED_WHEN_DISABLED}
      />
    </button>
  );
};

export default FileButton;
