import { useId, useMemo, useState } from "react";

import { Icon, IconName } from "@/app/atoms";
import { SnapshotFiles } from "@/app/components/inspector/SnapshotFiles";
import { cn } from "@/app/lib/cn";
import { useWorkspaceRevisionChanges } from "@/app/services/queries";
import type { WorkspaceRevision } from "@/app/types/api";

/**
 * Everything the badge needs from the files panel. One object shared by every
 * turn, so a memoized message is not re-rendered for carrying it.
 */
export interface FilesPanelLink {
  sessionId: string;
  /** Where the files panel is pointing, when it is the open one. */
  selectedFile: string | null;
  selectedRevision: number | null;
  onOpenFile: (revision: number, path: string) => void;
  onOpenPanel: (revision: number) => void;
}

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus-outline)]";

/**
 * What one run changed, as one quiet line under its answer: "Changed 3 files
 * +12 −3", which opens the run's revision in Changes. The chevron beside it
 * lists the files in place, each opening on its own. The revision is a commit
 * nac captured on the side when the run finished, so this keeps describing
 * that run after the checkout moves on — including after the work is committed.
 */
export function SnapshotBadge({
  revision,
  panel,
}: {
  revision: WorkspaceRevision;
  panel: FilesPanelLink;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const { data } = useWorkspaceRevisionChanges(panel.sessionId, revision.id);
  // Git reports an untracked directory as one entry; the panel spreads it over
  // the files inside, so the directory itself has no row to open.
  const files = useMemo(
    () => (data?.changed_files ?? []).filter((file) => !file.path.endsWith("/")),
    [data],
  );
  const pointedAt = panel.selectedRevision === revision.id;
  const count = files.length;
  const summary = count ? `Changed ${count} ${count === 1 ? "file" : "files"}` : "Changed files";

  return (
    <div className="flex w-full min-w-0 flex-col items-start">
      <div className="flex min-w-0 items-center gap-0.5">
        <button
          type="button"
          aria-pressed={pointedAt || undefined}
          aria-label={`${summary}, ${revision.additions} added, ${revision.deletions} removed. Open in Changes`}
          onClick={() => panel.onOpenPanel(revision.id)}
          className={cn(
            "-ml-1.5 inline-flex h-8 min-w-0 items-center gap-2 rounded-md px-1.5 max-md:min-h-11",
            "type-body-chrome transition-colors duration-150 ease-out hover:bg-[var(--f-wash-1)] hover:text-basic-primary",
            pointedAt ? "text-basic-primary" : "text-basic-tertiary",
            FOCUS_RING,
          )}
        >
          <Icon iconName={IconName.Edit} size={16} aria-hidden className="shrink-0 !text-current" />
          <span className="truncate">{summary}</span>
          <span className="flex shrink-0 items-center gap-1.5 type-meta tabular">
            <span className="text-success-primary">+{revision.additions}</span>
            <span className="text-error-primary">−{revision.deletions}</span>
          </span>
        </button>
        {count > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-label={open ? "Hide changed files" : "Show changed files"}
            onClick={() => setOpen((value) => !value)}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-md text-basic-muted hover:bg-[var(--f-wash-1)] hover:text-basic-primary max-md:size-11",
              FOCUS_RING,
            )}
          >
            <Icon
              iconName={IconName.Down}
              size={14}
              aria-hidden
              className={cn(
                "!text-current transition-transform duration-150 ease-out motion-reduce:transition-none",
                open && "rotate-180",
              )}
            />
          </button>
        ) : null}
      </div>
      {open ? (
        <div id={listId} className="w-full min-w-0 pl-5">
          <SnapshotFiles
            files={files}
            selected={pointedAt ? panel.selectedFile : null}
            onOpen={(path) => panel.onOpenFile(revision.id, path)}
            onOpenAll={() => panel.onOpenPanel(revision.id)}
          />
        </div>
      ) : null}
    </div>
  );
}
