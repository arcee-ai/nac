import { ActionListButtonStatus, IconName, InsightItemState } from "@/app/atoms";
import type { ActionKind, ActionStatus } from "@/app/features/insights/model/types";

const ROW_ICONS: Record<ActionKind, IconName> = {
  reasoning: IconName.Brain,
  thread: IconName.Chat,
  "define-workset": IconName.Checklist,
  "delete-thread": IconName.Trash,
  "read-file": IconName.ReadFile,
  "write-file": IconName.FileUpload,
  "edit-file": IconName.Edit,
  glob: IconName.SearchFiles,
  grep: IconName.SearchFile,
  "run-command": IconName.Terminal,
  "write-command": IconName.WriteCommand,
  "read-command-output": IconName.ScreenView,
  "web-search": IconName.Search,
  "web-fetch": IconName.Globe,
  "create-goal": IconName.Flag,
  "get-goal": IconName.Important,
  "update-goal": IconName.Checklist,
  "spawn-agent": IconName.Plane,
  "spawn-orchestrator": IconName.Orchestrator,
  "session-status": IconName.Info,
  "session-steer": IconName.AddChat,
  "session-read": IconName.Eye,
  "session-wait": IconName.Timelaps,
  "session-cancel": IconName.Close,
  other: IconName.Code,
};

/** The detail items draw a few types with a different glyph than their row. */
const DETAIL_ICONS: Partial<Record<ActionKind, IconName>> = {
  grep: IconName.SearchPage,
  "get-goal": IconName.Tag,
  "session-status": IconName.Eye,
};

const PROMINENT_ACTIONS: ReadonlySet<ActionKind> = new Set([
  "thread",
  "reasoning",
  "define-workset",
]);

const ROW_STATUS: Record<ActionStatus, ActionListButtonStatus> = {
  ready: ActionListButtonStatus.Ready,
  pending: ActionListButtonStatus.Pending,
  running: ActionListButtonStatus.Running,
  failed: ActionListButtonStatus.Failed,
};

const ITEM_STATE: Record<ActionStatus, InsightItemState> = {
  ready: InsightItemState.Default,
  pending: InsightItemState.Loading,
  running: InsightItemState.Loading,
  failed: InsightItemState.Error,
};

/** A null action is a group of two or more segments. */
export function rowIcon(action: ActionKind | null): IconName {
  return action === null ? IconName.MenuHorizontal : ROW_ICONS[action];
}

export function detailIcon(action: ActionKind): IconName {
  return DETAIL_ICONS[action] ?? ROW_ICONS[action];
}

export function isProminentAction(action: ActionKind | null): boolean {
  return action !== null && PROMINENT_ACTIONS.has(action);
}

export function rowStatus(status: ActionStatus): ActionListButtonStatus {
  return ROW_STATUS[status];
}

export function itemState(status: ActionStatus): InsightItemState {
  return ITEM_STATE[status];
}
