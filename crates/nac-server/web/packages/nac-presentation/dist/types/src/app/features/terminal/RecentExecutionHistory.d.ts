import type { ExecutionHistoryEntry, ExecutionStatus } from "../../../../packages/nac-client/src/types.js";
interface RecentExecutionHistoryProps {
    sessionId: string;
    /** Reuse the existing native observer/renderer owner with this read-only source. */
    onReopen: (source: ExecutionStatus, entry: ExecutionHistoryEntry) => void;
}
export declare function RecentExecutionHistory({ sessionId, onReopen }: RecentExecutionHistoryProps): import("react").JSX.Element;
export {};
