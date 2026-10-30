import { ActionListButtonStatus, IconName, InsightItemState } from "../../../atoms";
import type { ActionKind, ActionStatus } from "../model/types";
/** A null action is a group of two or more segments. */
export declare function rowIcon(action: ActionKind | null): IconName;
export declare function detailIcon(action: ActionKind): IconName;
export declare function rowStatus(status: ActionStatus): ActionListButtonStatus;
export declare function itemState(status: ActionStatus): InsightItemState;
