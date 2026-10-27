import type { ActionListButtonStatus, IconName } from "../../../atoms";
import type { InsightEntry, InsightSegment } from "../model/types";
import { type SessionResolver } from "./useDelegatedSessions";
export interface RowView {
    icon: IconName;
    label: string;
    meta?: string;
    status: ActionListButtonStatus;
}
export interface RowSources {
    resolveSession: SessionResolver;
    /** `episode_count` of each thread the snapshot retains, by name. */
    episodeCounts: ReadonlyMap<string, number>;
}
export declare function segmentRowView(segment: InsightSegment, sources: RowSources): RowView;
export declare function entryRowView(entry: InsightEntry, sources: RowSources): RowView;
