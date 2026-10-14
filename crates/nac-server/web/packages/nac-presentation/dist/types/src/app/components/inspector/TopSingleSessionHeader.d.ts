import type { ManagedSessionView as ManagedSessionSummary } from "../../features/public-native/collectionViews.js";
import type { SessionSnapshotResponse } from "../../types/api.js";
/**
 * The single-session bar above the transcript: title and behavior, the live
 * token and cost reading, then the checkout the chat is working in.
 */
export declare function TopSingleSessionHeader({ sessionId, snapshot, entry, onShowPanel, }: {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    entry: ManagedSessionSummary | null;
    /** Restores the side panel while it is slid away. */
    onShowPanel?: () => void;
}): import("react").JSX.Element;
