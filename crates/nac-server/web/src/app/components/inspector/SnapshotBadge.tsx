import { useMemo } from "react";

import { CodeChangesBadge } from "@/app/components/inspector/ChatBadge";
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

/**
 * What one run changed: its totals, then its files. The revision is a commit
 * nac captured on the side when the run finished, so this keeps describing that
 * run after the checkout moves on — including after the work is committed.
 */
export function SnapshotBadge({
  revision,
  panel,
}: {
  revision: WorkspaceRevision;
  panel: FilesPanelLink;
}) {
  const { data } = useWorkspaceRevisionChanges(panel.sessionId, revision.id);
  // Git reports an untracked directory as one entry; the panel spreads it over
  // the files inside, so the directory itself has no row to open.
  const files = useMemo(
    () => (data?.changed_files ?? []).filter((file) => !file.path.endsWith("/")),
    [data],
  );
  const pointedAt = panel.selectedRevision === revision.id;

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col items-start border-l-2 border-solid transition-colors duration-150",
        pointedAt ? "border-primary" : "border-muted",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex max-w-full items-center gap-4 rounded-[4px] px-4 py-2",
          "-outline-offset-2 outline-[var(--color-border-focus-outline)] focus-visible:outline-2",
          pointedAt ? "btn-ghost-highlighted" : "btn-ghost",
        )}
        aria-pressed={pointedAt || undefined}
        onClick={() => panel.onOpenPanel(revision.id)}
      >
        <span className="label-small truncate text-btn-secondary">Snapshot</span>
        <CodeChangesBadge additions={revision.additions} deletions={revision.deletions} />
      </button>
      <SnapshotFiles
        files={files}
        selected={pointedAt ? panel.selectedFile : null}
        onOpen={(path) => panel.onOpenFile(revision.id, path)}
        onOpenAll={() => panel.onOpenPanel(revision.id)}
      />
    </div>
  );
}
