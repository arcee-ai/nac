import type { SessionSnapshotResponse } from "../../../types/api";
export interface InsightsViewProps {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
}
/**
 * The Insights panel: what the session did, grouped by the prompt that asked
 * for it, beside the detail of the picked action. Until a row is picked the
 * detail follows the newest action.
 */
export declare function InsightsView({ sessionId, snapshot }: InsightsViewProps): import("react").JSX.Element;
