import type { ManagedSessionSummary, SessionSnapshotResponse } from "../../types/api";
interface ChatInputBoxProps {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    entry: ManagedSessionSummary | null;
}
/**
 * The floating composer: the attention card stacked above it, the message
 * field, and one row of controls under it — `+`, model, permission mode and
 * Send in its context ring.
 */
export declare function ChatInputBox({ sessionId, snapshot, entry }: ChatInputBoxProps): import("react").JSX.Element;
export {};
