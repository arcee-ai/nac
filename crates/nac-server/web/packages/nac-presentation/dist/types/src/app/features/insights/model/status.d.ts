import type { ActionStatus, InsightEntry, InsightSegment } from "./types";
import type { ToolPresentationStatus } from "../../../lib/toolPresentation";
export declare function toolActionStatus(status: ToolPresentationStatus): ActionStatus;
export declare function segmentStatus(segment: InsightSegment): ActionStatus;
/** The status a group of these reports: running, then pending, then failed, else ready. */
export declare function combineStatuses(statuses: Iterable<ActionStatus>): ActionStatus;
export declare function entryStatus(entry: InsightEntry): ActionStatus;
