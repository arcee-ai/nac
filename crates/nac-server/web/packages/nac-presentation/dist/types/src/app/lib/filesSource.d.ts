import type { WorkspaceFileList, WorkspaceRevision, WorkspaceRevisionChanges } from "../types/api";
/**
 * The live checkout, named for everything it holds: edits made before the
 * session, by a person, or by any run all show up here alike.
 */
export declare const WORKING_TREE_LABEL = "Working tree \u2014 all checkout changes";
/** A captured revision, as the list of revisions numbers and records it. */
export interface RevisionCapture {
    ordinal: number;
    record: WorkspaceRevision;
}
/**
 * Where the Files rows come from. A revision's capture is null while the list
 * of revisions it is described by has not arrived.
 */
export type FilesSource = {
    kind: "working-tree";
} | {
    kind: "revision";
    id: number;
    capture: RevisionCapture | null;
};
/**
 * Whether the rows on screen are this source's. Anything short of `ready`
 * draws no rows at all, so a source is never named over another one's data.
 */
export type FilesSourceState = {
    status: "ready";
} | {
    status: "pending";
} | {
    status: "unavailable";
    reason: string;
};
/** The selected source, numbered the way the revision pickers number it. */
export declare function describeFilesSource(revision: number | null, revisions: WorkspaceRevision[] | undefined): FilesSource;
/**
 * Whether the rows the Files panel would draw belong to the selected source. Query
 * placeholders keep the previous answer while a new key is fetched, and for a
 * switch of source that answer is the other source's.
 */
export declare function filesSourceState({ revision, listing, listingHeldOver, error, snapshotLoaded, changes, changesHeldOver, captureMissing, }: {
    revision: number | null;
    listing: WorkspaceFileList | undefined;
    listingHeldOver: boolean;
    /** Why this source could not be read, if it could not. */
    error: string | null;
    snapshotLoaded: boolean;
    changes: WorkspaceRevisionChanges | undefined;
    changesHeldOver: boolean;
    captureMissing: boolean;
}): FilesSourceState;
