import { IconName } from "@/app/atoms/icon";
import { formatSeconds } from "@/app/lib/format";
import type { ToolPresentation } from "@/app/lib/toolPresentation";
import type {
  ModelTurn,
  TranscriptBlock,
  TranscriptTurn,
} from "@/app/lib/transcript";

/** Consecutive thoughts and tool calls collapsed into one pill tray. */
export interface AgentToolsGroup {
  id: string;
  turnKey: string;
  label: string;
  segments: AgentSegment[];
  inProgress: boolean;
  durationMs: number | null;
}

export type AgentSegment =
  | {
      kind: "thinking";
      key: string;
      text: string;
      durationMs: number | null;
      streaming: boolean;
    }
  | {
      kind: "tool";
      key: string;
      presentation: ToolPresentation;
    };

export type AgentTranscriptItem =
  | { kind: "group"; group: AgentToolsGroup }
  | { kind: "spawn"; group: AgentToolsGroup }
  | { kind: "block"; block: TranscriptBlock };

export interface SegmentDisplayConfig {
  id: string;
  icon: IconName;
  regularLabel: string;
  inProgressLabel: string;
}

const REASONING_CONFIG: SegmentDisplayConfig = {
  id: "reasoning",
  icon: IconName.Brain,
  regularLabel: "Thoughts",
  inProgressLabel: "Thinking…",
};

const FALLBACK_TOOL_CONFIG: SegmentDisplayConfig = {
  id: "tool",
  icon: IconName.Toolbox,
  regularLabel: "Tool",
  inProgressLabel: "Working…",
};

const TOOL_CONFIGS: Record<string, SegmentDisplayConfig> = {
  read: {
    id: "read",
    icon: IconName.ReadFile,
    regularLabel: "Read file",
    inProgressLabel: "Reading file…",
  },
  write: {
    id: "write",
    icon: IconName.FileUpload,
    regularLabel: "Write file",
    inProgressLabel: "Writing file…",
  },
  edit: {
    id: "edit",
    icon: IconName.Edit,
    regularLabel: "Edit file",
    inProgressLabel: "Editing file…",
  },
  glob: {
    id: "glob",
    icon: IconName.SearchFiles,
    regularLabel: "Find files",
    inProgressLabel: "Finding files…",
  },
  grep: {
    id: "grep",
    icon: IconName.SearchFile,
    regularLabel: "Search files",
    inProgressLabel: "Searching files…",
  },
  exec_command: {
    id: "exec_command",
    icon: IconName.Terminal,
    regularLabel: "Run command",
    inProgressLabel: "Running command…",
  },
  write_stdin: {
    id: "write_stdin",
    icon: IconName.WriteCommand,
    regularLabel: "Write command",
    inProgressLabel: "Writing command…",
  },
  read_command_output: {
    id: "read_command_output",
    icon: IconName.ScreenView,
    regularLabel: "Read command output",
    inProgressLabel: "Reading output…",
  },
  web_search: {
    id: "web_search",
    icon: IconName.Globe,
    regularLabel: "Search web",
    inProgressLabel: "Searching the web…",
  },
  web_fetch: {
    id: "web_fetch",
    icon: IconName.SearchPage,
    regularLabel: "Fetch web page",
    inProgressLabel: "Fetching the page…",
  },
  create_goal: {
    id: "create_goal",
    icon: IconName.Flag,
    regularLabel: "Create goal",
    inProgressLabel: "Creating goal…",
  },
  get_goal: {
    id: "get_goal",
    icon: IconName.Important,
    regularLabel: "Read goal",
    inProgressLabel: "Reading goal…",
  },
  update_goal: {
    id: "update_goal",
    icon: IconName.Checklist,
    regularLabel: "Update goal",
    inProgressLabel: "Updating goal…",
  },
  session_spawn: {
    id: "session_spawn",
    icon: IconName.Plane,
    regularLabel: "Start session",
    inProgressLabel: "Starting session…",
  },
  session_status: {
    id: "session_status",
    icon: IconName.Info,
    regularLabel: "Check session",
    inProgressLabel: "Checking session…",
  },
  session_steer: {
    id: "session_steer",
    icon: IconName.AddChat,
    regularLabel: "Steer session",
    inProgressLabel: "Steering session…",
  },
  session_read: {
    id: "session_read",
    icon: IconName.Eye,
    regularLabel: "Read session",
    inProgressLabel: "Reading session…",
  },
  session_wait: {
    id: "session_wait",
    icon: IconName.Timelaps,
    regularLabel: "Wait for session",
    inProgressLabel: "Waiting for session…",
  },
  session_cancel: {
    id: "session_cancel",
    icon: IconName.Trash,
    regularLabel: "Cancel session",
    inProgressLabel: "Cancelling session…",
  },
  workset_define: {
    id: "workset_define",
    icon: IconName.Checklist,
    regularLabel: "Workset",
    inProgressLabel: "Defining workset…",
  },
  thread_delete: {
    id: "thread_delete",
    icon: IconName.Trash,
    regularLabel: "Delete thread",
    inProgressLabel: "Deleting thread…",
  },
};

/** Spawned sessions stay out of the ToolsSegments tray and get their own row. */
const STANDALONE_TOOL_NAMES = new Set(["session_spawn"]);

export function isStandaloneToolName(name: string): boolean {
  return STANDALONE_TOOL_NAMES.has(name);
}

export function getReasoningConfig(): SegmentDisplayConfig {
  return REASONING_CONFIG;
}

export function getSegmentConfig(toolName: string): SegmentDisplayConfig {
  const known = TOOL_CONFIGS[toolName];
  if (known) return known;
  if (toolName.startsWith("mcp__")) {
    return {
      ...FALLBACK_TOOL_CONFIG,
      id: toolName,
      icon: IconName.Toolbox,
      regularLabel: "MCP tool",
      inProgressLabel: "Running MCP tool…",
    };
  }
  return { ...FALLBACK_TOOL_CONFIG, id: toolName || FALLBACK_TOOL_CONFIG.id };
}

export function configForSegment(segment: AgentSegment): SegmentDisplayConfig {
  if (segment.kind === "thinking") return REASONING_CONFIG;
  const named = TOOL_CONFIGS[segment.presentation.name];
  if (named) return named;
  return {
    ...getSegmentConfig(segment.presentation.name),
    regularLabel: segment.presentation.label,
    inProgressLabel: `${segment.presentation.label}…`,
  };
}

function toolNameOf(block: TranscriptBlock): string | null {
  if (block.kind === "tool-detail") return block.presentation.name;
  if (block.kind === "tool") return block.name;
  if (block.kind === "workset") return "workset_define";
  return null;
}

function isStandaloneBlock(block: TranscriptBlock): boolean {
  const name = toolNameOf(block);
  return name != null && isStandaloneToolName(name);
}

function isGroupable(block: TranscriptBlock): boolean {
  if (isStandaloneBlock(block)) return false;
  return (
    block.kind === "thoughts" ||
    block.kind === "tool-detail" ||
    block.kind === "tool"
  );
}

function segmentFromBlock(block: TranscriptBlock): AgentSegment | null {
  if (block.kind === "thoughts") {
    if (!block.text.trim()) return null;
    return {
      kind: "thinking",
      key: block.key,
      text: block.text,
      durationMs: block.durationMs,
      streaming: block.streaming,
    };
  }
  if (block.kind === "tool-detail") {
    return { kind: "tool", key: block.key, presentation: block.presentation };
  }
  if (block.kind === "tool") {
    return {
      kind: "tool",
      key: block.key,
      presentation: {
        callId: block.key,
        name: block.name,
        label: getSegmentConfig(block.name).regularLabel,
        summary: null,
        resultPreview: null,
        status: block.pending ? "running" : "success",
        statusLabel: block.pending ? "Running" : "Succeeded",
      },
    };
  }
  if (block.kind === "workset") {
    const label = block.worksetId
      ? `Worksets_${block.worksetId}`
      : getSegmentConfig("workset_define").regularLabel;
    return {
      kind: "tool",
      key: block.key,
      presentation: {
        callId: block.key,
        name: "workset_define",
        label,
        summary: block.worksetId || null,
        resultPreview: null,
        status: block.pending ? "running" : "success",
        statusLabel: block.pending ? "Running" : "Succeeded",
      },
    };
  }
  return null;
}

export function standaloneGroupFromBlock(
  turnKey: string,
  block: TranscriptBlock,
): AgentToolsGroup | null {
  if (!isStandaloneBlock(block)) return null;
  const segment = segmentFromBlock(block);
  if (!segment) return null;
  return {
    id: `${turnKey}:spawn-${segment.key}`,
    turnKey,
    label:
      segment.kind === "tool"
        ? (segment.presentation.summary ?? segment.presentation.label)
        : groupLabel([segment]),
    segments: [segment],
    inProgress: segmentIsLive(segment),
    durationMs: null,
  };
}

const TOOL_TRAILING: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  glob: "glob",
  grep: "Grep",
  exec_command: "Exec",
  write_stdin: "write",
  read_command_output: "Read",
  create_goal: "create",
  get_goal: "Read",
  update_goal: "edit",
  session_status: "Check",
  session_steer: "Steer",
  session_read: "Read",
  session_wait: "Wait",
  session_cancel: "Delete",
  session_spawn: "Spawn",
  workset_define: "Workset",
  thread_delete: "Delete",
};

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function readyActionListLabel(group: AgentToolsGroup): string {
  const labels = uniqueInOrder(
    group.segments.map((segment) => configForSegment(segment).regularLabel),
  );
  if (labels.length === 0) return group.label;
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]}, ${labels[1]}`;
  return `${labels[0]}, ${labels[1]} and more`;
}

export function actionListLabel(group: AgentToolsGroup): string {
  if (!group.inProgress) return readyActionListLabel(group);
  if (actionListIsThoughtsOnly(group)) return REASONING_CONFIG.inProgressLabel;
  if (group.segments.length === 1)
    return configForSegment(group.segments[0]).inProgressLabel;
  return `${readyActionListLabel(group)}...`;
}

/** Action list row: thoughts duration sits in the label, not the trailing badge. */
export function actionButtonLabel(group: AgentToolsGroup): string {
  const label = actionListLabel(group);
  if (group.inProgress || !actionListIsThoughtsOnly(group)) return label;
  const duration = formatSeconds(group.durationMs);
  return duration ? `${label}, ${duration}` : label;
}

const FAILED_TOOL_STATUSES = new Set([
  "error",
  "cancelled",
  "timed-out",
  "interrupted",
]);

export function toolSegmentFailed(segment: AgentSegment): boolean {
  return (
    segment.kind === "tool" &&
    FAILED_TOOL_STATUSES.has(segment.presentation.status)
  );
}

export function actionListFailed(group: AgentToolsGroup): boolean {
  return group.segments.some(toolSegmentFailed);
}

export function actionListTrailing(group: AgentToolsGroup): string | undefined {
  if (group.inProgress || actionListIsThoughtsOnly(group)) {
    return undefined;
  }
  const tools = group.segments.filter((segment) => segment.kind === "tool");
  const thoughts = group.segments.some(
    (segment) => segment.kind === "thinking",
  );
  if (!thoughts && tools.length === 1) {
    return TOOL_TRAILING[tools[0].presentation.name];
  }
  return String(group.segments.length);
}

export function actionListIcon(group: AgentToolsGroup): IconName {
  if (actionListIsSegmentsGroup(group)) return IconName.MenuHorizontal;
  const tools = group.segments.filter((segment) => segment.kind === "tool");
  if (tools.length === 0) return IconName.Brain;
  return configForSegment(tools[0]).icon;
}

/**
 * A tools-group row that collapses several thoughts/tools into one button.
 * Single-tool and thoughts-only rows are not this type and have no children.
 */
export function actionListIsSegmentsGroup(group: AgentToolsGroup): boolean {
  const tools = group.segments.filter((segment) => segment.kind === "tool");
  const thoughts = group.segments.some(
    (segment) => segment.kind === "thinking",
  );
  if (tools.length === 0) return false;
  return thoughts || tools.length > 1;
}

export function actionListIsThoughtsOnly(group: AgentToolsGroup): boolean {
  return (
    group.segments.length > 0 &&
    group.segments.every((segment) => segment.kind === "thinking")
  );
}

export function segmentIsLive(segment: AgentSegment): boolean {
  if (segment.kind === "thinking") return segment.streaming;
  return (
    segment.presentation.status === "pending" ||
    segment.presentation.status === "running"
  );
}

/** Nested action-list row under an expanded tools group. */
export function actionChildLabel(segment: AgentSegment): string {
  const config = configForSegment(segment);
  if (segmentIsLive(segment)) return config.inProgressLabel;
  if (segment.kind === "thinking") {
    const duration = formatSeconds(segment.durationMs);
    return duration ? `${config.regularLabel}, ${duration}` : config.regularLabel;
  }
  return config.regularLabel;
}

function groupLabel(segments: AgentSegment[]): string {
  const hasThoughts = segments.some((segment) => segment.kind === "thinking");
  const tools = segments.filter((segment) => segment.kind === "tool");
  if (hasThoughts && tools.length === 0) return "Thoughts";
  if (!hasThoughts && tools.length === 1) return tools[0].presentation.label;
  if (!hasThoughts) return "Tools";
  return "Thoughts & tools";
}

function groupDurationMs(segments: AgentSegment[]): number | null {
  let total = 0;
  let any = false;
  for (const segment of segments) {
    if (segment.kind !== "thinking" || segment.durationMs == null) continue;
    total += segment.durationMs;
    any = true;
  }
  return any ? total : null;
}

function closeGroup(
  originKey: string,
  seq: number,
  segments: AgentSegment[],
  liveTail: boolean,
): AgentToolsGroup {
  return {
    id: `${originKey}:tools-${seq}`,
    turnKey: originKey,
    label: groupLabel(segments),
    segments,
    inProgress: liveTail || segments.some(segmentIsLive),
    durationMs: groupDurationMs(segments),
  };
}

export function turnOriginKey(turn: ModelTurn): string {
  return turn.originKey || turn.key;
}

/** Collapse consecutive thoughts / tool calls; leave prose and orchestrator cards alone. */
export function partitionAgentTranscript(
  turn: ModelTurn,
  live = false,
): AgentTranscriptItem[] {
  const items: AgentTranscriptItem[] = [];
  const originKey = turnOriginKey(turn);
  let pending: AgentSegment[] = [];
  let toolsSeq = 0;

  const flush = (liveTail = false) => {
    if (pending.length === 0) return;
    items.push({
      kind: "group",
      group: closeGroup(originKey, toolsSeq, pending, liveTail),
    });
    toolsSeq += 1;
    pending = [];
  };

  for (const block of turn.blocks) {
    if (!isGroupable(block)) {
      flush();
      const spawn = standaloneGroupFromBlock(originKey, block);
      if (spawn) {
        items.push({ kind: "spawn", group: spawn });
        continue;
      }
      items.push({ kind: "block", block });
      continue;
    }
    const segment = segmentFromBlock(block);
    if (!segment) continue;
    pending.push(segment);
  }
  flush(live);
  return items;
}

export function collectAgentToolsGroups(
  turns: TranscriptTurn[],
): AgentToolsGroup[] {
  const groups: AgentToolsGroup[] = [];
  for (const turn of turns) {
    if (turn.kind !== "model") continue;
    for (const item of partitionAgentTranscript(turn)) {
      if (item.kind === "group" || item.kind === "spawn") groups.push(item.group);
    }
  }
  return groups;
}

export enum ToolCallLabelState {
  Active = "active",
  Default = "default",
}

export interface ToolsSegmentItem {
  id: string;
  icon: IconName;
  failed?: boolean;
}

export function toolsItemsFromGroup(
  group: AgentToolsGroup,
): ToolsSegmentItem[] {
  return group.segments.map((segment) => ({
    id: segment.key,
    icon: configForSegment(segment).icon,
    failed: toolSegmentFailed(segment),
  }));
}

export function visibleToolsItems(
  items: ToolsSegmentItem[],
  maxPills: number,
): { items: ToolsSegmentItem[]; overflowCount: number } {
  const overflowCount = Math.max(0, items.length - maxPills);
  return {
    items: overflowCount > 0 ? items.slice(-maxPills) : items,
    overflowCount,
  };
}

export const MAX_PILLS_DESKTOP = 8;
export const MAX_PILLS_MOBILE = 4;
export const COUPLER_WIDTH_PX = 8;
export const PILL_SIZE_MEDIUM_PX = 36;
export const PILL_SIZE_SMALL_PX = 28;
export const PILL_SLOT_PX = COUPLER_WIDTH_PX + PILL_SIZE_SMALL_PX;
export const PILL_LINGER_MS = 350;
export const PILL_TRANSITION_MS = 300;
