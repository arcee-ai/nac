import { IconName } from "@/app/atoms/icon";
import { formatSeconds } from "@/app/lib/format";
import type { ToolPresentation } from "@/app/lib/toolPresentation";
import type { ModelTurn, TranscriptBlock, TranscriptTurn } from "@/app/lib/transcript";

/** Consecutive reasoning and tool blocks projected into one presentation group. */
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

/**
 * Presentation-only mapping for the tool names the current transcript can
 * already expose. Unknown and MCP tools deliberately retain safe fallbacks.
 */
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
    regularLabel: "Use terminal",
    inProgressLabel: "Using terminal…",
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
  subagent: {
    id: "subagent",
    icon: IconName.Robot,
    regularLabel: "Start coding agent",
    inProgressLabel: "Starting coding agent…",
  },
  subagent_status: {
    id: "subagent_status",
    icon: IconName.Info,
    regularLabel: "Check coding agent",
    inProgressLabel: "Checking coding agent…",
  },
  subagent_cancel: {
    id: "subagent_cancel",
    icon: IconName.Trash,
    regularLabel: "Cancel coding agent",
    inProgressLabel: "Cancelling coding agent…",
  },
  orchestrator_launch: {
    id: "orchestrator_launch",
    icon: IconName.Orchestrator,
    regularLabel: "Start NAC orchestrator",
    inProgressLabel: "Starting NAC orchestrator…",
  },
  orchestrator_status: {
    id: "orchestrator_status",
    icon: IconName.Info,
    regularLabel: "Check NAC orchestrator",
    inProgressLabel: "Checking NAC orchestrator…",
  },
  orchestrator_steer: {
    id: "orchestrator_steer",
    icon: IconName.AddChat,
    regularLabel: "Steer NAC orchestrator",
    inProgressLabel: "Steering NAC orchestrator…",
  },
  orchestrator_read: {
    id: "orchestrator_read",
    icon: IconName.Eye,
    regularLabel: "Read NAC orchestrator",
    inProgressLabel: "Reading NAC orchestrator…",
  },
  orchestrator_wait: {
    id: "orchestrator_wait",
    icon: IconName.Timelaps,
    regularLabel: "Wait for NAC orchestrator",
    inProgressLabel: "Waiting for NAC orchestrator…",
  },
  orchestrator_cancel: {
    id: "orchestrator_cancel",
    icon: IconName.Trash,
    regularLabel: "Cancel NAC orchestrator",
    inProgressLabel: "Cancelling NAC orchestrator…",
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
      regularLabel: "MCP tool",
      inProgressLabel: "Running MCP tool…",
    };
  }
  return { ...FALLBACK_TOOL_CONFIG, id: toolName || FALLBACK_TOOL_CONFIG.id };
}

export function configForSegment(segment: AgentSegment): SegmentDisplayConfig {
  if (segment.kind === "thinking") return REASONING_CONFIG;
  const known = TOOL_CONFIGS[segment.presentation.name];
  if (known) return known;
  return {
    ...getSegmentConfig(segment.presentation.name),
    regularLabel: segment.presentation.label,
    inProgressLabel: `${segment.presentation.label}…`,
  };
}

function isGroupable(block: TranscriptBlock): boolean {
  return block.kind === "thoughts" || block.kind === "tool-detail" || block.kind === "tool";
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
    const config = getSegmentConfig(block.name);
    return {
      kind: "tool",
      key: block.key,
      presentation: {
        callId: block.key,
        name: block.name,
        label: config.regularLabel,
        summary: null,
        resultPreview: null,
        status: block.pending ? "running" : "success",
        statusLabel: block.pending ? "Running" : "Succeeded",
      },
    };
  }
  return null;
}

export function segmentIsLive(segment: AgentSegment): boolean {
  if (segment.kind === "thinking") return segment.streaming;
  return segment.presentation.status === "pending" || segment.presentation.status === "running";
}

const FAILED_TOOL_STATUSES = new Set<ToolPresentation["status"]>([
  "error",
  "timed-out",
  "cancelled",
  "interrupted",
]);

export function toolSegmentFailed(segment: AgentSegment): boolean {
  return segment.kind === "tool" && FAILED_TOOL_STATUSES.has(segment.presentation.status);
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

function closeGroup(turnKey: string, sequence: number, segments: AgentSegment[]): AgentToolsGroup {
  return {
    id: `${turnKey}:tools-${sequence}`,
    turnKey,
    label: groupLabel(segments),
    segments,
    inProgress: segments.some(segmentIsLive),
    durationMs: groupDurationMs(segments),
  };
}

/** Collapse only consecutive current transcript reasoning/tool blocks. */
export function partitionAgentTranscript(turn: ModelTurn): AgentTranscriptItem[] {
  const items: AgentTranscriptItem[] = [];
  let pending: AgentSegment[] = [];
  let sequence = 0;

  const flush = () => {
    if (pending.length === 0) return;
    items.push({ kind: "group", group: closeGroup(turn.key, sequence, pending) });
    sequence += 1;
    pending = [];
  };

  for (const block of turn.blocks) {
    if (!isGroupable(block)) {
      flush();
      items.push({ kind: "block", block });
      continue;
    }
    const segment = segmentFromBlock(block);
    if (segment) pending.push(segment);
  }
  flush();
  return items;
}

export function collectAgentToolsGroups(turns: TranscriptTurn[]): AgentToolsGroup[] {
  return turns.flatMap((turn) =>
    turn.kind === "model"
      ? partitionAgentTranscript(turn).flatMap((item) =>
          item.kind === "group" ? [item.group] : [],
        )
      : [],
  );
}

export enum ToolCallLabelState {
  Active = "active",
  Default = "default",
  Error = "error",
}

export interface ToolsSegmentItem {
  id: string;
  icon: IconName;
  label: string;
  statusLabel: string;
  live: boolean;
  failed: boolean;
}

export function toolsItemsFromGroup(group: AgentToolsGroup): ToolsSegmentItem[] {
  return group.segments.map((segment) => {
    const config = configForSegment(segment);
    if (segment.kind === "thinking") {
      return {
        id: segment.key,
        icon: config.icon,
        label: segment.streaming ? config.inProgressLabel : config.regularLabel,
        statusLabel: segment.streaming
          ? "Thinking"
          : formatSeconds(segment.durationMs) || "Complete",
        live: segment.streaming,
        failed: false,
      };
    }
    return {
      id: segment.key,
      icon: config.icon,
      label: segmentIsLive(segment) ? config.inProgressLabel : segment.presentation.label,
      statusLabel: segment.presentation.statusLabel,
      live: segmentIsLive(segment),
      failed: toolSegmentFailed(segment),
    };
  });
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

export function groupAriaLabel(group: AgentToolsGroup): string {
  const statuses = toolsItemsFromGroup(group)
    .map((item) => `${item.label}: ${item.statusLabel}`)
    .join(", ");
  return statuses ? `${group.label}. ${statuses}` : group.label;
}

export const MAX_PILLS_DESKTOP = 8;
export const MAX_PILLS_MOBILE = 4;
export const COUPLER_WIDTH_PX = 8;
export const PILL_SIZE_MEDIUM_PX = 36;
export const PILL_SIZE_SMALL_PX = 28;
export const PILL_SLOT_PX = COUPLER_WIDTH_PX + PILL_SIZE_SMALL_PX;
export const PILL_LINGER_MS = 350;
export const PILL_TRANSITION_MS = 300;
