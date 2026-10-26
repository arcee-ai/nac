import type { ActionKind, InsightSegment, SpawnActionKind } from "./types";
/** Unmapped tools, `list_executions` and MCP tools included, read as `other`. */
export declare function actionKindForTool(name: string): ActionKind;
export declare function isSpawnAction(kind: ActionKind): kind is SpawnActionKind;
export declare function segmentAction(segment: InsightSegment): ActionKind;
