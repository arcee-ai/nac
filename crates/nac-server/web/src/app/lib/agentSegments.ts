import { IconName } from "@/app/atoms/icon";
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
    icon: IconName.BookOpen,
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
    icon: IconName.Folders,
    regularLabel: "Find files",
    inProgressLabel: "Finding files…",
  },
  grep: {
    id: "grep",
    icon: IconName.Search,
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
    icon: IconName.Terminal,
    regularLabel: "Use terminal",
    inProgressLabel: "Writing to terminal…",
  },
  read_command_output: {
    id: "read_command_output",
    icon: IconName.Eye,
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
    icon: IconName.Flag,
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
    icon: IconName.People,
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
    icon: IconName.Coursor,
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
    icon: IconName.Stop,
    regularLabel: "Cancel session",
    inProgressLabel: "Cancelling session…",
  },
};

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

function isGroupable(block: TranscriptBlock): boolean {
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
  return null;
}

function toolIsLive(segment: AgentSegment): boolean {
  if (segment.kind === "thinking") return segment.streaming;
  return (
    segment.presentation.status === "pending" ||
    segment.presentation.status === "running"
  );
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
  turnKey: string,
  seq: number,
  segments: AgentSegment[],
): AgentToolsGroup {
  return {
    id: `${turnKey}:tools-${seq}`,
    turnKey,
    label: groupLabel(segments),
    segments,
    inProgress: segments.some(toolIsLive),
    durationMs: groupDurationMs(segments),
  };
}

/** Collapse consecutive thoughts / tool calls; leave prose and orchestrator cards alone. */
export function partitionAgentTranscript(
  turn: ModelTurn,
): AgentTranscriptItem[] {
  const items: AgentTranscriptItem[] = [];
  let pending: AgentSegment[] = [];
  let toolsSeq = 0;

  const flush = () => {
    if (pending.length === 0) return;
    items.push({
      kind: "group",
      group: closeGroup(turn.key, toolsSeq, pending),
    });
    toolsSeq += 1;
    pending = [];
  };

  for (const block of turn.blocks) {
    if (!isGroupable(block)) {
      flush();
      items.push({ kind: "block", block });
      continue;
    }
    const segment = segmentFromBlock(block);
    if (!segment) continue;
    pending.push(segment);
  }
  flush();
  return items;
}

export function collectAgentToolsGroups(
  turns: TranscriptTurn[],
): AgentToolsGroup[] {
  const groups: AgentToolsGroup[] = [];
  for (const turn of turns) {
    if (turn.kind !== "model") continue;
    for (const item of partitionAgentTranscript(turn)) {
      if (item.kind === "group") groups.push(item.group);
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
}

export function toolsItemsFromGroup(
  group: AgentToolsGroup,
): ToolsSegmentItem[] {
  return group.segments.map((segment) => ({
    id: segment.key,
    icon: configForSegment(segment).icon,
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
export const COUPLER_WIDTH_PX = 12;
export const PILL_SIZE_MEDIUM_PX = 36;
export const PILL_SIZE_SMALL_PX = 24;
export const PILL_SLOT_PX = COUPLER_WIDTH_PX + PILL_SIZE_MEDIUM_PX;
export const PILL_LINGER_MS = 350;
export const PILL_TRANSITION_MS = 300;
