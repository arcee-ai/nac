import type { SessionSnapshotResponse } from "../../types/api";
/**
 * The files of the checkout — either all of them as a folder tree or only what
 * git reports as changed — with the selected one shown beside the list: its
 * diff when it has changed, its contents when it has not.
 *
 * With a revision selected the same lists describe the checkout as it stood at
 * the end of that run, and "changed" means what that run changed.
 */
export declare function FilesView({ sessionId, snapshot, revision, readOnly, }: {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    revision?: number | null;
    readOnly?: boolean;
}): import("react").JSX.Element;
