import { segmentAction } from "@/app/features/insights/model/actionKinds";
import {
  formatBadgeDuration,
  formatListDuration,
  segmentDurationMs,
} from "@/app/features/insights/model/durations";
import { entryStatus, segmentStatus } from "@/app/features/insights/model/status";
import type {
  ActionKind,
  ActionStatus,
  InsightEntry,
  InsightGroup,
  InsightRow,
  InsightSegment,
} from "@/app/features/insights/model/types";

interface ActionCopy {
  /** Failed rows and group summaries. */
  type: string;
  /** Running rows of the list, which never show the argument. */
  running: string;
  /** Transcript badge while the argument is unknown. */
  live: string;
  meta: string | null;
}

const ACTION_COPY: Record<ActionKind, ActionCopy> = {
  reasoning: { type: "Thoughts", running: "Thinking…", live: "Thinking…", meta: null },
  thread: { type: "Thread", running: "Running thread…", live: "Running thread…", meta: "Thread" },
  "define-workset": {
    type: "Define Workset",
    running: "Defining Workset…",
    live: "Defining workset…",
    meta: "Workset",
  },
  "delete-thread": {
    type: "Delete thread",
    running: "Deleting…",
    live: "Deleting thread…",
    meta: null,
  },
  "read-file": { type: "Read File", running: "Reading File…", live: "Reading file…", meta: "Read" },
  "write-file": {
    type: "Create File",
    running: "Creating File…",
    live: "Writing file…",
    meta: "Write",
  },
  "edit-file": { type: "Edit File", running: "Editing File…", live: "Editing file…", meta: "Edit" },
  glob: { type: "Find files", running: "Find files…", live: "Finding files…", meta: "Glob" },
  grep: { type: "Search files", running: "Search files…", live: "Searching files…", meta: "Grep" },
  "run-command": {
    type: "Run command",
    running: "Running command…",
    live: "Running command…",
    meta: "Exec",
  },
  "write-command": {
    type: "Write command",
    running: "Write command…",
    live: "Writing to terminal…",
    meta: "Write",
  },
  "read-command-output": {
    type: "Read Output Command",
    running: "Read Output Command…",
    live: "Reading command output…",
    meta: "Read",
  },
  "web-search": {
    type: "Search",
    running: "Searching the web…",
    live: "Searching the web…",
    meta: "Search",
  },
  "web-fetch": { type: "Fetch", running: "Fetching…", live: "Fetching…", meta: "Fetch" },
  "create-goal": {
    type: "Create goal",
    running: "Creating goal…",
    live: "Creating goal…",
    meta: "Create",
  },
  "get-goal": { type: "Get goal", running: "Get goal…", live: "Reading goal…", meta: "Read" },
  "update-goal": {
    type: "Update goal",
    running: "Updating goal…",
    live: "Updating goal…",
    meta: "Edit",
  },
  "spawn-agent": {
    type: "Spawn Agent",
    running: "Spawn Agent…",
    live: "Starting agent…",
    meta: "Spawn",
  },
  "spawn-orchestrator": {
    type: "Spawn Orchestrator",
    running: "Spawn Orchestrator…",
    live: "Starting orchestrator…",
    meta: "Spawn",
  },
  "session-status": {
    type: "Check session status",
    running: "Checking session status…",
    live: "Checking session…",
    meta: "Check",
  },
  "session-steer": {
    type: "Steer session",
    running: "Steer session…",
    live: "Steering session…",
    meta: "Steer",
  },
  "session-read": {
    type: "Read session",
    running: "Reading session…",
    live: "Reading session…",
    meta: "Read",
  },
  "session-wait": {
    type: "Wait for session",
    running: "Wait for session…",
    live: "Waiting for session…",
    meta: "Wait",
  },
  "session-cancel": {
    type: "Cancel session",
    running: "Cancelling session…",
    live: "Cancelling session…",
    meta: "Cancel",
  },
  other: { type: "Tool", running: "Running tool…", live: "Running tool…", meta: "Tool" },
};

const LIVE_WITH_ARGUMENT: Partial<Record<ActionKind, (argument: string) => string>> = {
  "read-file": (file) => `Reading ${file}…`,
  "write-file": (file) => `Writing ${file}…`,
  "edit-file": (file) => `Editing ${file}…`,
  "run-command": (command) => `Running ${command}…`,
  "web-fetch": (host) => `Fetching ${host}…`,
};

const FILE_ACTIONS: ReadonlySet<ActionKind> = new Set(["read-file", "write-file", "edit-file"]);
const VERBATIM_ACTIONS: ReadonlySet<ActionKind> = new Set([
  "glob",
  "grep",
  "web-search",
  "spawn-agent",
  "spawn-orchestrator",
  "session-status",
  "session-steer",
  "session-read",
  "session-wait",
  "session-cancel",
]);
const COMMAND_LABEL_LIMIT = 40;
const TRAILING_ELLIPSIS = /\s*…+$/u;
const AWAITING_APPROVAL_LABEL = "Awaiting approval…";
const GROUP_RUNNING_LABEL = "Working…";

function basename(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || null;
}

function urlHost(value: string): string | null {
  try {
    return new URL(value).host || null;
  } catch {
    return null;
  }
}

function commandText(summary: string): string | null {
  // A preview without a command names only its working directory: `(in <dir>)`.
  if (summary.startsWith("(in ")) return null;
  return summary.replace(/\s+/g, " ").trim() || null;
}

/** Live labels end in an ellipsis of their own, which also marks a cut argument. */
function liveArgument(action: ActionKind, argument: string): string {
  const shown =
    action === "run-command" ? [...argument].slice(0, COMMAND_LABEL_LIMIT).join("") : argument;
  return shown.replace(TRAILING_ELLIPSIS, "").trimEnd();
}

function toolArgument(action: ActionKind, summary: string | null | undefined): string | null {
  if (!summary) return null;
  if (FILE_ACTIONS.has(action)) return basename(summary);
  if (action === "web-fetch") return urlHost(summary);
  if (action === "run-command") return commandText(summary);
  return VERBATIM_ACTIONS.has(action) ? summary : null;
}

/** Failed row label. */
export function actionTypeLabel(kind: ActionKind): string {
  return ACTION_COPY[kind].type;
}

/** Running row label of the list. */
export function actionRunningLabel(kind: ActionKind): string {
  return ACTION_COPY[kind].running;
}

/** Ready row meta; reasoning shows its duration, when known, instead of a word. */
export function actionMeta(kind: ActionKind, durationMs: number | null = null): string | null {
  if (kind === "reasoning") return durationMs === null ? null : formatListDuration(durationMs);
  return ACTION_COPY[kind].meta;
}

/** Type label of one segment; an unmapped tool reads as its product label. */
export function segmentTypeLabel(segment: InsightSegment): string {
  if (segment.kind === "tool" && segment.action === "other") {
    return segment.presentation?.label ?? segment.name;
  }
  return actionTypeLabel(segmentAction(segment));
}

/** Ready row label: the call's argument when it is known, else the type label. */
export function segmentTitle(segment: InsightSegment): string {
  if (segment.kind === "workset" && segment.worksetId) return `Worksets_${segment.worksetId}`;
  if (segment.kind === "tool") {
    const summary = segment.presentation?.summary;
    if (segment.action === "delete-thread" && summary) return `Deleted: ${summary}`;
    const argument = toolArgument(segment.action, summary);
    if (argument) return argument;
  }
  return segmentTypeLabel(segment);
}

export function segmentMeta(segment: InsightSegment): string | null {
  return actionMeta(segmentAction(segment), segmentDurationMs(segment));
}

/** Transcript badge label while the segment is live, with its argument when known. */
export function inProgressLabel(segment: InsightSegment): string {
  const action = segmentAction(segment);
  if (segment.kind === "tool") {
    if (action === "other") return `Running ${segmentTypeLabel(segment)}…`;
    const live = LIVE_WITH_ARGUMENT[action];
    const argument = toolArgument(action, segment.presentation?.summary);
    const shown = argument ? liveArgument(action, argument) : "";
    if (live && shown) return live(shown);
  }
  return ACTION_COPY[action].live;
}

/** The first two distinct type labels, e.g. "Thoughts, Read File and more". */
export function groupSummaryLabel(group: InsightGroup): string {
  const labels = [
    ...new Set(
      group.segments.map((segment) =>
        segment.kind === "workset" ? "Workset" : segmentTypeLabel(segment),
      ),
    ),
  ];
  const shown = labels.slice(0, 2).join(", ");
  return labels.length > 2 ? `${shown} and more` : shown;
}

/** Label of a settled group, on its transcript badge and its Insights row. */
export function doneLabel(group: InsightGroup): string {
  if (group.durationMs === null) return groupSummaryLabel(group);
  return `Worked for ${formatBadgeDuration(group.durationMs)}`;
}

/**
 * Transcript badge label while the group is live: its newest running segment,
 * else the approval it waits on. Null once nothing in it is live.
 */
export function groupLiveLabel(group: InsightGroup): string | null {
  for (let index = group.segments.length - 1; index >= 0; index -= 1) {
    const segment = group.segments[index];
    if (segmentStatus(segment) === "running") return inProgressLabel(segment);
  }
  return group.status === "pending" ? AWAITING_APPROVAL_LABEL : null;
}

/** Ready row meta of an entry. */
export function entryMeta(entry: InsightEntry): string | null {
  if (entry.kind === "thread") return `Thread, ${entry.episodes}`;
  if (entry.kind === "session") return actionMeta(entry.action);
  const { segments } = entry.group;
  return segments.length === 1 ? segmentMeta(segments[0]) : String(segments.length);
}

interface RowCopy {
  ready: string;
  meta: string | null;
  failed: string;
  running: string;
}

function stateRow(action: ActionKind | null, status: ActionStatus, copy: RowCopy): InsightRow {
  if (status === "running") return { action, label: copy.running, meta: null, status };
  if (status === "failed") return { action, label: copy.failed, meta: null, status };
  return { action, label: copy.ready, meta: copy.meta, status };
}

/** A group's child row. Running and failed rows drop the meta and show the type. */
export function segmentRow(segment: InsightSegment): InsightRow {
  const action = segmentAction(segment);
  const type = segmentTypeLabel(segment);
  return stateRow(action, segmentStatus(segment), {
    ready: segmentTitle(segment),
    meta: segmentMeta(segment),
    failed: type,
    running: action === "other" ? `${type}…` : actionRunningLabel(action),
  });
}

/** A top-level row. Thread rows keep their name and meta in every state. */
export function entryRow(entry: InsightEntry): InsightRow {
  if (entry.kind === "thread") {
    return {
      action: "thread",
      label: entry.thread.name,
      meta: entryMeta(entry),
      status: entryStatus(entry),
    };
  }
  if (entry.kind === "session") {
    return stateRow(entry.action, entry.status, {
      ready: entry.title,
      meta: entryMeta(entry),
      failed: actionTypeLabel(entry.action),
      running: actionRunningLabel(entry.action),
    });
  }
  const { group } = entry;
  if (group.segments.length === 1) return segmentRow(group.segments[0]);
  return stateRow(null, group.status, {
    ready: doneLabel(group),
    meta: entryMeta(entry),
    failed: groupSummaryLabel(group),
    running: GROUP_RUNNING_LABEL,
  });
}
