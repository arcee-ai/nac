import type { ManagedSessionSummary, SessionSnapshotResponse } from "../../types/api";
/**
 * The single-session bar above the transcript: the title with its behavior or
 * parent, the usage readings behind one button, then the checkout the chat is
 * working in.
 */
export declare function TopSingleSessionHeader({ sessionId, snapshot, entry, onShowPanel, }: {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    entry: ManagedSessionSummary | null;
    /** Restores the side panel while it is slid away. */
    onShowPanel?: () => void;
}): import("react").JSX.Element;
