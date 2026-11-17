import { segmentAction } from "@/app/features/insights/model/actionKinds";
import { segmentDurationMs } from "@/app/features/insights/model/durations";
import { segmentStatus } from "@/app/features/insights/model/status";
import type {
  ActionKind,
  ActionStatus,
  InsightSegment,
  ModelTurnItem,
} from "@/app/features/insights/model/types";

import { formatWorkDuration } from "./foldLayout";

/** What one fold row says: a verb, the argument it acted on, and how long it took. */
export interface StepLabel {
  verb: string;
  /** Path, command, pattern or host; null when the call has none worth naming. */
  argument: string | null;
  /** Full argument for the row's tooltip, when the shown one is shortened. */
  title: string | null;
  duration: string | null;
  status: ActionStatus;
}

const VERBS: Record<ActionKind, { done: string; live: string }> = {
  reasoning: { done: "Thought", live: "Thinking" },
  thread: { done: "Ran thread", live: "Running thread" },
  "define-workset": { done: "Defined workset", live: "Defining workset" },
  "delete-thread": { done: "Deleted thread", live: "Deleting thread" },
  "read-file": { done: "Read", live: "Reading" },
  "write-file": { done: "Created", live: "Creating" },
  "edit-file": { done: "Edited", live: "Editing" },
  glob: { done: "Found files", live: "Finding files" },
  grep: { done: "Searched", live: "Searching" },
  "run-command": { done: "Ran", live: "Running" },
  "write-command": { done: "Wrote to terminal", live: "Writing to terminal" },
  "read-command-output": { done: "Read output", live: "Reading output" },
  "web-search": { done: "Searched the web", live: "Searching the web" },
  "web-fetch": { done: "Fetched", live: "Fetching" },
  "create-goal": { done: "Set goal", live: "Setting goal" },
  "get-goal": { done: "Read goal", live: "Reading goal" },
  "update-goal": { done: "Updated goal", live: "Updating goal" },
  "spawn-agent": { done: "Started subagent", live: "Starting subagent" },
  "spawn-orchestrator": { done: "Started orchestrator", live: "Starting orchestrator" },
  "session-status": { done: "Checked subagent", live: "Checking subagent" },
  "session-steer": { done: "Steered subagent", live: "Steering subagent" },
  "session-read": { done: "Read subagent", live: "Reading subagent" },
  "session-wait": { done: "Waited for subagent", live: "Waiting for subagent" },
  "session-cancel": { done: "Cancelled subagent", live: "Cancelling subagent" },
  other: { done: "Used", live: "Using" },
};

const FILE_ACTIONS: ReadonlySet<ActionKind> = new Set(["read-file", "write-file", "edit-file"]);

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || path;
}

function host(value: string): string {
  try {
    return new URL(value).host || value;
  } catch {
    return value;
  }
}

function argumentOf(segment: InsightSegment, action: ActionKind): string | null {
  if (segment.kind === "workset") return segment.worksetId || null;
  if (segment.kind !== "tool") return null;
  if (action === "other") return segment.presentation?.label ?? segment.name;
  const summary = segment.presentation?.summary?.replace(/\s+/g, " ").trim();
  if (!summary) return null;
  // A command preview without a command names only its directory.
  if (action === "run-command" && summary.startsWith("(in ")) return null;
  if (FILE_ACTIONS.has(action)) return basename(summary);
  if (action === "web-fetch") return host(summary);
  return summary;
}

/** Steps under a second are most of them, so only the longer ones name a time. */
function rowDuration(ms: number | null): string | null {
  return ms !== null && ms >= 1000 ? formatWorkDuration(ms) : null;
}

/** The row a fold draws for one step. */
export function stepLabel(segment: InsightSegment): StepLabel {
  const action = segmentAction(segment);
  const status = segmentStatus(segment);
  const verbs = VERBS[action];
  const argument = argumentOf(segment, action);
  const full = segment.kind === "tool" ? (segment.presentation?.summary?.trim() ?? null) : argument;
  return {
    verb: status === "running" ? `${verbs.live}…` : verbs.done,
    argument,
    title: full && full !== argument ? full : null,
    duration: rowDuration(segmentDurationMs(segment)),
    status,
  };
}

/**
 * What the live status line says about a running turn, read off whatever it
 * produced last: its newest step, a subagent it is starting, threads it
 * dispatched, or the prose it is writing.
 */
export function liveTurnLabel(items: readonly ModelTurnItem[]): string {
  const last = items.at(-1);
  if (!last) return "Thinking…";
  if (last.kind === "group") return liveStepLabel(last.group.segments.at(-1));
  if (last.kind === "session") {
    return last.status === "running" || last.status === "pending"
      ? `${VERBS[last.action].live}…`
      : "Thinking…";
  }
  if ("block" in last && last.block.kind === "wave") return "Running threads…";
  return "Writing…";
}

/**
 * What the live status line says about the newest step: "Reading index.tsx…",
 * "Running npm test…", "Thinking…".
 */
export function liveStepLabel(segment: InsightSegment | undefined): string {
  if (!segment) return "Thinking…";
  const action = segmentAction(segment);
  const status = segmentStatus(segment);
  if (status === "pending") return "Waiting for approval…";
  // Between two steps the model is deciding what to do next.
  if (status !== "running") return "Thinking…";
  const verbs = VERBS[action];
  const argument = argumentOf(segment, action);
  const shown = argument && argument.length > 48 ? `${argument.slice(0, 47)}…` : argument;
  if (action === "reasoning" || !shown) return `${verbs.live}…`;
  return `${verbs.live} ${shown.replace(/…+$/u, "")}…`;
}
