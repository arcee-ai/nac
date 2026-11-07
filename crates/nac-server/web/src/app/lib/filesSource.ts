// Which source the Files panel's rows come from, and whether the rows on
// screen are that source's yet. Kept apart from the panel so the label is
// derived from the data drawn rather than from the selection alone.

import { revisionOrdinal } from "@/app/lib/revisions";
import type {
  WorkspaceFileList,
  WorkspaceRevision,
  WorkspaceRevisionChanges,
} from "@/app/types/api";

/**
 * The live checkout, named for everything it holds: edits made before the
 * session, by a person, or by any run all show up here alike.
 */
export const WORKING_TREE_LABEL = "Working tree — all checkout changes";

/** A captured revision, as the list of revisions numbers and records it. */
export interface RevisionCapture {
  ordinal: number;
  record: WorkspaceRevision;
}

/**
 * Where the Files rows come from. A revision's capture is null while the list
 * of revisions it is described by has not arrived.
 */
export type FilesSource =
  | { kind: "working-tree" }
  | { kind: "revision"; id: number; capture: RevisionCapture | null };

/**
 * Whether the rows on screen are this source's. Anything short of `ready`
 * draws no rows at all, so a source is never named over another one's data.
 */
export type FilesSourceState =
  | { status: "ready" }
  | { status: "pending" }
  | { status: "unavailable"; reason: string };

/** The selected source, numbered the way the revision pickers number it. */
export function describeFilesSource(
  revision: number | null,
  revisions: WorkspaceRevision[] | undefined,
): FilesSource {
  if (revision == null) return { kind: "working-tree" };
  const all = revisions ?? [];
  const index = all.findIndex((item) => item.id === revision);
  return {
    kind: "revision",
    id: revision,
    capture:
      index >= 0 ? { ordinal: revisionOrdinal(index, all.length), record: all[index] } : null,
  };
}

/**
 * Whether the rows the Files panel would draw belong to the selected source. Query
 * placeholders keep the previous answer while a new key is fetched, and for a
 * switch of source that answer is the other source's.
 */
export function filesSourceState({
  revision,
  listing,
  listingHeldOver,
  error,
  snapshotLoaded,
  changes,
  changesHeldOver,
  captureMissing,
}: {
  revision: number | null;
  listing: WorkspaceFileList | undefined;
  listingHeldOver: boolean;
  /** Why this source could not be read, if it could not. */
  error: string | null;
  snapshotLoaded: boolean;
  changes: WorkspaceRevisionChanges | undefined;
  changesHeldOver: boolean;
  captureMissing: boolean;
}): FilesSourceState {
  if (revision != null) {
    if (error) return { status: "unavailable", reason: error };
    if (captureMissing) {
      return {
        status: "unavailable",
        reason: "This session no longer records that snapshot.",
      };
    }
    if (changes?.error && !changesHeldOver) {
      return {
        status: "unavailable",
        reason: `Its changes could not be read: ${changes.error}`,
      };
    }
    if (!changes || changesHeldOver) return { status: "pending" };
  } else if (!snapshotLoaded) {
    // The working tree's changes come with the session snapshot.
    return { status: "pending" };
  }
  if (!listing || listingHeldOver) return { status: "pending" };
  return { status: "ready" };
}
