import { PanelEmpty } from "@/app/components/inspector/PanelSplit";
import { insightFilterEmptyCopy } from "@/app/features/insights/model/timeline";
import type { InsightsTopology } from "@/app/features/insights/model/types";
import type { SessionSnapshotResponse } from "@/app/types/api";

export interface InsightsViewProps {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  topology: InsightsTopology;
  /** Only a user-owned classic orchestrator may steer its workers from a thread. */
  canSteerWorkers: boolean;
}

/** The Insights panel: what the session did, grouped by the prompt that asked for it. */
export function InsightsView({ topology }: InsightsViewProps) {
  const empty = insightFilterEmptyCopy("all", topology);
  return <PanelEmpty title={empty.title}>{empty.body}</PanelEmpty>;
}
