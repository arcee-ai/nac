import { cn } from "../../lib/cn";

/**
 * What git says about a path, named the way the design names its states. Each
 * value is the letter `git status --porcelain` reports for it.
 */
export enum GitStatus {
  Changed = "M",
  Added = "A",
  Deleted = "D",
  ChangedName = "R",
  Copied = "C",
  ChangedType = "T",
  Conflict = "U",
  NotTracked = "?",
  Ignored = "!",
}

interface GitStatusTone {
  /** Spelled out, as the letter's hover text. */
  title: string;
  /** The colour of the name the status belongs to. */
  name: string;
  /** The same colour from the fill tokens, for a glyph that sits beside the name. */
  fill: string;
  /** The letter's own colour; paths git leaves alone dim it below the name. */
  letter: string;
}

export const GIT_STATUS_TONE: Record<GitStatus, GitStatusTone> = {
  [GitStatus.Changed]: {
    title: "Modified",
    name: "text-danger-primary",
    fill: "text-fill-danger-primary",
    letter: "text-danger-primary",
  },
  [GitStatus.Added]: {
    title: "Added",
    name: "text-info-primary",
    fill: "text-fill-info-primary",
    letter: "text-info-primary",
  },
  [GitStatus.Deleted]: {
    title: "Deleted",
    name: "text-error-primary",
    fill: "text-fill-error-primary",
    letter: "text-error-primary",
  },
  [GitStatus.ChangedName]: {
    title: "Renamed",
    name: "text-accent-primary",
    fill: "text-fill-accent-primary",
    letter: "text-accent-primary",
  },
  [GitStatus.Copied]: {
    title: "Copied",
    name: "text-info-secondary",
    fill: "text-fill-info-secondary",
    letter: "text-info-secondary",
  },
  [GitStatus.ChangedType]: {
    title: "Type changed",
    name: "text-danger-secondary",
    fill: "text-fill-danger-secondary",
    letter: "text-danger-secondary",
  },
  [GitStatus.Conflict]: {
    title: "Conflict",
    name: "text-error-secondary",
    fill: "text-fill-error-secondary",
    letter: "text-error-secondary",
  },
  [GitStatus.NotTracked]: {
    title: "Untracked",
    name: "text-basic-tertiary",
    fill: "text-fill-basic-tertiary",
    letter: "text-basic-muted",
  },
  [GitStatus.Ignored]: {
    title: "Ignored",
    name: "text-basic-tertiary",
    fill: "text-fill-basic-tertiary",
    letter: "text-basic-muted",
  },
};

const STATUS_BY_LETTER = new Map<string, GitStatus>(
  Object.values(GitStatus).map((status) => [status, status]),
);

/**
 * The status behind a porcelain code. The server trims it to one letter; a
 * code this list does not know still means the path differs from HEAD, so it
 * reads as changed rather than as clean.
 */
export function gitStatusOf(code: string | null | undefined): GitStatus | null {
  const letter = code?.trim()[0];
  if (!letter) return null;
  return STATUS_BY_LETTER.get(letter) ?? GitStatus.Changed;
}

/**
 * The status letter at the end of a file row. The row's name already speaks
 * for the file, so the letter stays out of the accessible name and explains
 * itself on hover instead.
 */
export default function GitStatusLabel({
  status,
  className,
}: {
  status: GitStatus;
  className?: string;
}) {
  const tone = GIT_STATUS_TONE[status];
  return (
    <span
      aria-hidden
      title={tone.title}
      className={cn(
        "header-2xs inline-flex size-4 shrink-0 items-center justify-center",
        tone.letter,
        className,
      )}
    >
      {status}
    </span>
  );
}
