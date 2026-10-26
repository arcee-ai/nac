import type { ManagedSessionSummary, SessionSnapshotResponse } from "../../types/api";
interface ChatInputBoxProps {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    entry: ManagedSessionSummary | null;
}
/**
 * Message field plus the run status bar that replaced the old metrics grid:
 * model, environment, cumulative token usage and the run timer.
 */
export declare function ChatInputBox({ sessionId, snapshot, entry }: ChatInputBoxProps): import("react").JSX.Element;
export {};
