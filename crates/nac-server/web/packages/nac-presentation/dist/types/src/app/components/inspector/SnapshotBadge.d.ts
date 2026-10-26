import type { WorkspaceRevision } from "../../types/api";
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
 * What one run changed: its files, then its totals. The revision is a commit
 * nac captured on the side when the run finished, so this keeps describing that
 * run after the checkout moves on — including after the work is committed.
 */
export declare function SnapshotBadge({ revision, panel, }: {
    revision: WorkspaceRevision;
    panel: FilesPanelLink;
}): import("react").JSX.Element;
