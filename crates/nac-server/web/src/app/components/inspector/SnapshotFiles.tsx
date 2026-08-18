import { FileIcon } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { fileLabel } from "@/app/lib/fileTree";
import type { ChangedFileStat } from "@/app/types/api";

/**
 * How many files the chat names before it defers to the panel. A large run can
 * touch dozens, and a wall of chips would bury the message they belong to.
 */
const MAX_FILES = 8;

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
        "flex items-center gap-[6px] max-w-full py-2 md:py-1 px-2 rounded-[4px] shrink-0",
        active ? "btn-ghost-highlighted" : "btn-ghost",
      )}
      aria-pressed={active}
      title={file.path}
      onClick={() => onOpen(file.path)}
    >
      <FileIcon path={file.path} />
      <span className="text-micro truncate">{fileLabel(file.path)}</span>
      {/* `git diff --numstat` covers only tracked files, so an untracked one
          arrives without counts and the chip simply carries none. */}
      {file.additions != null || file.deletions != null ? (
        <span className="flex items-center gap-1 shrink-0 code code-micro">
          <span className="text-success-primary">+{file.additions ?? 0}</span>
          <span className="text-error-primary">-{file.deletions ?? 0}</span>
        </span>
      ) : null}
    </button>
  );
}

/**
 * The files a snapshot touched, each opening in the files panel. Sits above the
 * snapshot badge so the turn says what it changed before it says how much.
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
    <div className="flex flex-col gap-1 md:gap-0 w-full pl-2 pr-4 pb-1 items-start">
      {shown.map((file) => (
        <FileChip key={file.path} file={file} active={selected === file.path} onOpen={onOpen} />
      ))}
      {rest > 0 ? (
        <button
          type="button"
          className="btn-ghost flex items-center shrink-0 py-1 px-2 rounded-[4px] label-micro text-basic-muted shrink-0"
          onClick={onOpenAll}
        >
          {`+${rest} more`}
        </button>
      ) : null}
    </div>
  );
}
