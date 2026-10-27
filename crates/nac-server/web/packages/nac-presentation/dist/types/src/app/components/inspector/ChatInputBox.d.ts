import type { ManagedSessionSummary, SessionSnapshotResponse } from "../../types/api";
interface ChatInputBoxProps {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    entry: ManagedSessionSummary | null;
}
/**
 * Message pill plus the row of session controls under it: model, settings and
 * permissions, and on a phone, which has no session header, the usage readings.
 */
export declare function ChatInputBox({ sessionId, snapshot, entry }: ChatInputBoxProps): import("react").JSX.Element;
export {};
