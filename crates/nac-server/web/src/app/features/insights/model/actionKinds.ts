import type {
  ActionKind,
  InsightSegment,
  SpawnActionKind,
} from "@/app/features/insights/model/types";

const TOOL_ACTIONS = new Map<string, ActionKind>([
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
  ["subagent_status", "session-status"],
  ["subagent_cancel", "session-cancel"],
]);

/** Unmapped tools, `list_executions` and MCP tools included, read as `other`. */
export function actionKindForTool(name: string): ActionKind {
  return TOOL_ACTIONS.get(name) ?? "other";
}

export function isSpawnAction(kind: ActionKind): kind is SpawnActionKind {
  return kind === "spawn-agent";
}

export function segmentAction(segment: InsightSegment): ActionKind {
  if (segment.kind === "reasoning") return "reasoning";
  return segment.action;
}
