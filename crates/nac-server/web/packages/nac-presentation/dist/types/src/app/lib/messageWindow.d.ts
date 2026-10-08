import type { MessagesPageResponse, SessionSnapshotResponse } from "../types/api";
export declare const SNAPSHOT_MESSAGE_LIMIT = 24;
export declare const SNAPSHOT_THREAD_EVENT_LIMIT = 50;
export type MessageWindowMerge = {
    kind: "accepted";
    snapshot: SessionSnapshotResponse;
} | {
    kind: "snapshot-required";
};
export declare function validMessagesPage(page: MessagesPageResponse): boolean;
export declare function validSnapshotWindow(snapshot: SessionSnapshotResponse): boolean;
/**
 * Reconcile a newest-tail page into the focused snapshot cache.
 *
 * Previously loaded history is retained only when both ranges belong to the
 * same monotonically growing transcript. A shrink or gap requires a canonical
 * snapshot because a page alone cannot repair the other snapshot projections.
 */
export declare function mergeMessageTail(current: SessionSnapshotResponse, incoming: MessagesPageResponse): MessageWindowMerge;
/** Prepend one page only when it still joins the cursor that requested it. */
export declare function prependMessagePage(current: SessionSnapshotResponse, incoming: MessagesPageResponse, requestedStart: number): SessionSnapshotResponse | null;
/** Preserve a contiguous loaded prefix when a normal focused snapshot lands. */
export declare function mergeFocusedSnapshot(current: SessionSnapshotResponse | undefined, incoming: SessionSnapshotResponse, replace: boolean): SessionSnapshotResponse;
