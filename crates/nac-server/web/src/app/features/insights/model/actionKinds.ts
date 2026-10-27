import type {
  ActionKind,
  InsightSegment,
  SpawnActionKind,
} from "@/app/features/insights/model/types";

const TOOL_ACTIONS = new Map<string, ActionKind>([
  ["thread", "thread"],
  ["workset_define", "define-workset"],
  ["thread_delete", "delete-thread"],
  ["read", "read-file"],
  ["write", "write-file"],
  ["edit", "edit-file"],
  ["glob", "glob"],
  ["grep", "grep"],
  ["exec_command", "run-command"],
  ["write_stdin", "write-command"],
  ["read_command_output", "read-command-output"],
  ["web_search", "web-search"],
  ["web_fetch", "web-fetch"],
  ["create_goal", "create-goal"],
  ["get_goal", "get-goal"],
  ["update_goal", "update-goal"],
  ["subagent", "spawn-agent"],
  ["orchestrator_launch", "spawn-orchestrator"],
  ["subagent_status", "session-status"],
  ["orchestrator_status", "session-status"],
  ["orchestrator_steer", "session-steer"],
  ["orchestrator_read", "session-read"],
  ["orchestrator_wait", "session-wait"],
  ["subagent_cancel", "session-cancel"],
  ["orchestrator_cancel", "session-cancel"],
]);

/** Unmapped tools, `list_executions` and MCP tools included, read as `other`. */
export function actionKindForTool(name: string): ActionKind {
  return TOOL_ACTIONS.get(name) ?? "other";
}

export function isSpawnAction(kind: ActionKind): kind is SpawnActionKind {
  return kind === "spawn-agent" || kind === "spawn-orchestrator";
}

export function segmentAction(segment: InsightSegment): ActionKind {
  if (segment.kind === "reasoning") return "reasoning";
  if (segment.kind === "workset") return "define-workset";
  return segment.action;
}
