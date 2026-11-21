import type { InsightsTopology } from "../model/types";
import type { SessionSnapshotResponse } from "../../../types/api";
export interface InsightsViewProps {
    sessionId: string;
    snapshot: SessionSnapshotResponse | null;
    topology: InsightsTopology;
}
/**
 * The Insights panel: what the session did, grouped by the prompt that asked
 * for it, beside the detail of the picked action. Until a row is picked the
 * detail follows the newest action.
 */
export declare function InsightsView({ sessionId, snapshot, topology }: InsightsViewProps): import("react").JSX.Element;
