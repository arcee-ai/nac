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
    name: "text-basic-primary",
    fill: "text-fill-danger-primary",
    letter: "text-danger-primary",
  },
  [GitStatus.Added]: {
    title: "Added",
    name: "text-basic-primary",
    fill: "text-fill-success-primary",
    letter: "text-success-primary",
  },
  [GitStatus.Deleted]: {
    title: "Deleted",
    name: "text-basic-tertiary line-through decoration-[var(--f-ink-5)]",
    fill: "text-fill-error-primary",
    letter: "text-error-primary",
  },
  [GitStatus.ChangedName]: {
    title: "Renamed",
    name: "text-basic-primary",
    fill: "text-fill-basic-secondary",
    letter: "text-basic-secondary",
  },
  [GitStatus.Copied]: {
    title: "Copied",
    name: "text-basic-primary",
    fill: "text-fill-basic-secondary",
    letter: "text-basic-secondary",
  },
  [GitStatus.ChangedType]: {
    title: "Type changed",
    name: "text-basic-primary",
    fill: "text-fill-danger-primary",
    letter: "text-danger-primary",
  },
  [GitStatus.Conflict]: {
    title: "Conflict",
    name: "text-error-primary",
    fill: "text-fill-error-primary",
    letter: "text-error-primary",
  },
  [GitStatus.NotTracked]: {
    title: "Untracked",
    name: "text-basic-primary",
    fill: "text-fill-success-primary",
    letter: "text-success-primary",
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
        "code text-[11px] font-semibold !leading-4 inline-flex size-4 shrink-0 items-center justify-center",
        tone.letter,
        className,
      )}
    >
      {status}
    </span>
  );
}
