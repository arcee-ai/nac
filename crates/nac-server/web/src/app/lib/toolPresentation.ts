import type { AgentEvent, Message, SessionSnapshotResponse, ToolCall } from "@/app/types/api";

export type ToolPresentationStatus =
  | "pending"
  | "running"
  | "success"
  | "error"
  | "timed-out"
  | "cancelled"
  | "interrupted";

export interface ToolPresentation {
  callId: string;
  /** Bounded transport name retained for diagnostics and safe fallbacks. */
  name: string;
  /** Product vocabulary shown as the primary label. */
  label: string;
  /** Backend-owned bounded key argument; never reconstructed from raw arguments. */
  summary: string | null;
  /** Backend-owned bounded result preview; never the durable raw tool body. */
  resultPreview: string | null;
  status: ToolPresentationStatus;
  statusLabel: string;
}

type ToolStarted = Extract<AgentEvent, { type: "tool_call_started" }>;
type ToolFinished = Extract<AgentEvent, { type: "tool_call_finished" }>;

export interface ToolEventPair {
  started?: ToolStarted;
  finished?: ToolFinished;
}

export interface ToolResultRecord {
  text: string;
  hasImage: boolean;
}

function toolResultRecord(
  content: Extract<Message, { role: "tool" }>["content"],
): ToolResultRecord {
  if (typeof content === "string") return { text: content, hasImage: false };
  return {
    text: content
      .map((part) => (part.type === "text" ? part.text : `[Image: ${part.image.mime_type}]`))
      .join("\n\n"),
    hasImage: content.some((part) => part.type === "image"),
  };
}

/** Collect only the contiguous result rows owned by one assistant turn. */
export function collectToolResults(
  messages: SessionSnapshotResponse["messages"],
  assistantIndex: number,
): Map<string, ToolResultRecord> {
  const results = new Map<string, ToolResultRecord>();
  for (let index = assistantIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "tool") {
      results.set(message.tool_call_id, toolResultRecord(message.content));
      continue;
    }
    if (message.role === "assistant" || message.role === "user") break;
  }
  return results;
}

export function assistantTurnCancelled(
  messages: SessionSnapshotResponse["messages"],
  assistantIndex: number,
  cancellationMarker: string,
): boolean {
  for (let index = assistantIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "tool") continue;
    if (message.role === "assistant") {
      return typeof message.content === "string" && message.content.trim() === cancellationMarker;
    }
    return false;
  }
  return false;
}

const TOOL_LABELS: Record<string, string> = {
  read: "Read file",
  write: "Write file",
  edit: "Edit file",
  glob: "Find files",
  grep: "Search files",
  exec_command: "Run command",
  write_stdin: "Use terminal",
  read_command_output: "Read command output",
  web_search: "Search web",
  web_fetch: "Fetch web page",
  create_goal: "Create goal",
  get_goal: "Read goal",
  update_goal: "Update goal",
  workset_define: "Workset",
  thread_delete: "Delete thread",
  session_spawn: "Start session",
  session_status: "Check session",
  session_steer: "Steer session",
  session_read: "Read session",
  session_wait: "Wait for session",
  session_cancel: "Cancel session",
};

const STATUS_LABELS: Record<ToolPresentationStatus, string> = {
  pending: "Pending",
  running: "Running",
  success: "Succeeded",
  error: "Failed",
  "timed-out": "Timed out",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

const CANCELLED_MARKER = "[tool call cancelled by user]";
const INTERRUPTED_MARKER = "Tool execution was interrupted; no result was recorded.";
const NAME_LIMIT = 160;
const PREVIEW_LIMIT = 180;

function bounded(value: string | null | undefined, limit: number): string {
  const safe = [...(value ?? "")]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127 ? " " : character;
    })
    .join("")
    .trim();
  if ([...safe].length <= limit) return safe;
  return `${[...safe].slice(0, limit - 1).join("")}…`;
}

function humanize(value: string): string {
  const words = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Tool call";
}

function toolLabel(name: string): string {
  const known = TOOL_LABELS[name];
  if (known) return known;
  if (name.startsWith("mcp__")) {
    const parts = name.split("__").filter(Boolean);
    const leaf = parts.at(-1) ?? "tool";
    return `MCP · ${humanize(leaf)}`;
  }
  return humanize(name || "tool call");
}

function statusFromFinished(event: ToolFinished): ToolPresentationStatus {
  if (event.command_status === "timed_out") return "timed-out";
  if (event.command_status === "cancelled") return "cancelled";
  if (event.command_status === "spawn_error") return "error";
  if (event.is_error || (event.exit_code != null && event.exit_code !== 0)) return "error";
  return "success";
}

/**
 * Pair sanitized durable and live lifecycle events by call id. Later events
 * win, so an SSE finish can settle a durable start and the canonical snapshot
 * can replace the overlay without changing semantic identity.
 */
export function indexToolEvents(events: AgentEvent[]): Map<string, ToolEventPair> {
  const byCall = new Map<string, ToolEventPair>();
  for (const event of events) {
    if (event.type !== "tool_call_started" && event.type !== "tool_call_finished") continue;
    if (event.thread_name) continue;
    const pair = byCall.get(event.call_id) ?? {};
    if (event.type === "tool_call_started") pair.started = event;
    else pair.finished = event;
    byCall.set(event.call_id, pair);
  }
  return byCall;
}

export function presentToolCall({
  call,
  events,
  hasResult,
  resultText,
  resultHasImage,
  active,
  turnCancelled,
}: {
  call: ToolCall;
  events?: ToolEventPair;
  hasResult: boolean;
  /** Used only for fixed cancellation/interruption markers, never displayed. */
  resultText: string | null;
  resultHasImage: boolean;
  active: boolean;
  turnCancelled: boolean;
}): ToolPresentation {
  const rawName = events?.started?.name ?? events?.finished?.name ?? call.function?.name ?? "tool";
  const name = bounded(rawName, NAME_LIMIT) || "tool";
  let status: ToolPresentationStatus;
  if (events?.finished) status = statusFromFinished(events.finished);
  else if (resultText?.startsWith(CANCELLED_MARKER) || (turnCancelled && !hasResult)) {
    status = "cancelled";
  } else if (resultText?.trim() === INTERRUPTED_MARKER) status = "interrupted";
  else if (hasResult) status = "success";
  else if (active && events?.started) status = "running";
  else if (active) status = "pending";
  else status = "interrupted";

  let resultPreview = bounded(events?.finished?.content_preview, PREVIEW_LIMIT) || null;
  if (!resultPreview && resultHasImage) resultPreview = "Image result";
  if (!resultPreview && status === "cancelled") resultPreview = "No result was retained.";
  if (!resultPreview && status === "interrupted") resultPreview = "No result was recorded.";

  return {
    callId: call.id,
    name,
    label: toolLabel(name),
    summary: bounded(events?.started?.key_arg_preview, PREVIEW_LIMIT) || null,
    resultPreview,
    status,
    statusLabel: STATUS_LABELS[status],
  };
}
