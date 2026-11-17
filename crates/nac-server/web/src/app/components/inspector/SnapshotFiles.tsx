import { FileIcon } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { fileLabel } from "@/app/lib/fileTree";
import type { ChangedFileStat } from "@/app/types/api";

/**
 * How many files the chat names before it defers to the panel. A large run can
 * touch dozens, and a wall of chips would bury the message they belong to.
 */
const MAX_FILES = 8;

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus-outline)]";

function FileChip({
  file,
  active,
  onOpen,
}: {
  file: ChangedFileStat;
  active: boolean;
  onOpen: (path: string) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-7 max-w-full shrink-0 items-center gap-2 rounded-md px-2 max-md:min-h-11",
        "transition-colors duration-150 ease-out hover:bg-[var(--f-wash-1)]",
        FOCUS_RING,
        active ? "bg-[var(--f-wash-2)] text-basic-primary" : "text-basic-secondary",
      )}
      aria-pressed={active}
      title={file.path}
      onClick={() => onOpen(file.path)}
    >
      <FileIcon path={file.path} />
      <span className="type-meta truncate">{fileLabel(file.path)}</span>
      {/* `git diff --numstat` covers only tracked files, so an untracked one
          arrives without counts and the chip simply carries none. */}
      {file.additions != null || file.deletions != null ? (
        <span className="flex shrink-0 items-center gap-1 type-meta tabular">
          <span className="text-success-primary">+{file.additions ?? 0}</span>
          <span className="text-error-primary">−{file.deletions ?? 0}</span>
        </span>
      ) : null}
    </button>
  );
}

/**
 * The files a snapshot touched, each opening in the files panel. Listed under
 * the snapshot's header, which carries their totals.
 */
export function SnapshotFiles({
  files,
  selected,
  onOpen,
  onOpenAll,
}: {
  files: ChangedFileStat[];
  /** Path the files panel is pointing at, when that panel is the open one. */
  selected: string | null;
  onOpen: (path: string) => void;
  /** Falls back to the panel for whatever did not fit here. */
  onOpenAll: () => void;
}) {
  if (!files.length) return null;
  const shown = files.slice(0, MAX_FILES);
  const rest = files.length - shown.length;

  return (
    <div className="flex w-full flex-col items-start pb-1">
      {shown.map((file) => (
        <FileChip key={file.path} file={file} active={selected === file.path} onOpen={onOpen} />
      ))}
      {rest > 0 ? (
        <button
          type="button"
          className={cn(
            "flex h-7 shrink-0 items-center rounded-md px-2 type-meta text-basic-muted hover:bg-[var(--f-wash-1)] hover:text-basic-primary max-md:min-h-11",
            FOCUS_RING,
          )}
          onClick={onOpenAll}
        >
          {`+${rest} more`}
        </button>
      ) : null}
    </div>
  );
}
