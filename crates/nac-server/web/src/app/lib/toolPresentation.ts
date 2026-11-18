import { isJsonObject, type JsonObject, type JsonValue } from "@/app/lib/json";
import { isNumber, isString } from "@/app/lib/primitive";
import type { AgentEvent, Message, SessionSnapshotResponse, ToolCall } from "@/app/types/api";

export type ToolPresentationStatus =
  | "pending"
  | "running"
  | "awaiting-approval"
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
  /** Native-owned historical invocation outcome, absent for legacy events. */
  delegationOutcome?: NonNullable<ToolFinished["delegation_outcome"]>;
  delegationIntent?: NonNullable<ToolStarted["delegation_intent"]>;
  /**
   * Execution time from the call's finish event. Absent when the call never
   * ran, or when no finish event reports one.
   */
  durationMs?: number;
  /**
   * Session a `subagent` or `orchestrator_launch` call started or continued.
   * An identity hint for delegated-session links that is never displayed:
   * consumers must resolve it against the delegation queries before trusting it.
   */
  spawnedSessionId?: string;
  /** Native launch identity hint; consumers validate it against passive session inventory. */
  launchedTask?: { sessionId: string; projectId: string; callerId: string; title: string };
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
  find_tasks: "Find tasks",
  read_task: "Read task",
  subagent: "Subagent",
  list_projects: "Find saved projects",
  launch_task: "Start separate task",
  task_launch_status: "Read task preparation",
  subagent_status: "Check subagent",
  subagent_cancel: "Cancel subagent",
  orchestrator_launch: "Start NAC orchestrator",
  orchestrator_status: "Check NAC orchestrator",
  orchestrator_steer: "Steer NAC orchestrator",
  orchestrator_read: "Read NAC orchestrator",
  orchestrator_wait: "Wait for NAC orchestrator",
  orchestrator_cancel: "Cancel NAC orchestrator",
};

const STATUS_LABELS: Record<ToolPresentationStatus, string> = {
  pending: "Pending",
  running: "Running",
  "awaiting-approval": "Awaiting approval",
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
/** Launch tools name their session with the same field in arguments and results. */
const SPAWNED_SESSION_FIELDS = new Map([
  ["subagent", "child_session_id"],
  ["orchestrator_launch", "orchestrator_session_id"],
]);
const SESSION_ID = /^[^\s\p{Cc}]+$/u;

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

function parseObject(text: string | null | undefined): JsonObject | null {
  if (!text) return null;
  try {
    // SAFETY: JSON.parse only ever yields JSON values.
    const parsed = JSON.parse(text) as JsonValue;
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sessionId(value: JsonValue | undefined): string | null {
  if (!isString(value) || !SESSION_ID.test(value) || [...value].length > NAME_LIMIT) return null;
  return value;
}

function spawnedSession(name: string, call: ToolCall, resultText: string | null): string | null {
  const field = SPAWNED_SESSION_FIELDS.get(name);
  if (!field) return null;
  const continued = sessionId(parseObject(call.function?.arguments)?.[field]);
  if (continued) return continued;
  // Both the foreground record and the background acknowledgement carry these.
  const result = parseObject(resultText);
  if (!result || !isNumber(result.generation) || !isString(result.status)) return null;
  return sessionId(result[field]);
}

function launchedTask(name: string, text: string | null): ToolPresentation["launchedTask"] {
  if (name !== "launch_task" && name !== "task_launch_status") return undefined;
  const result = parseObject(text);
  const launch = result?.launch;
  if (launch === undefined || !isJsonObject(launch)) return undefined;
  const id = launch.session_id;
  const caller = launch.caller_session_id;
  const project = launch.project_id;
  const request = launch.request;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (
    !isString(id) ||
    !uuid.test(id) ||
    result?.navigation !== `/session/${id}` ||
    !isString(caller) ||
    !isString(project) ||
    request === undefined ||
    !isJsonObject(request) ||
    !isString(request.request_id) ||
    !uuid.test(request.request_id) ||
    !isString(request.title)
  )
    return undefined;
  return {
    sessionId: id,
    callerId: caller,
    projectId: project,
    title: bounded(request.title, 120),
  };
}

// Earlier native control results marked a confirmed cancelled child as a
// cancelled request. Only native typed outcome establishes this legacy case.
function isLegacyConfirmedCancellation(event: ToolFinished): boolean {
  return (
    event.name === "subagent_cancel" &&
    event.is_error &&
    event.completion_status === "cancelled" &&
    event.delegation_outcome === "cancelled"
  );
}

function statusFromFinished(event: ToolFinished): ToolPresentationStatus {
  if (isLegacyConfirmedCancellation(event)) return "success";
  if (event.completion_status === "timed_out") return "timed-out";
  if (event.completion_status === "cancelled") return "cancelled";
  if (event.completion_status === "error") return "error";
  if (event.completion_status === "success") return "success";
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

function subagentLabel(
  status: ToolPresentationStatus,
  outcome: ToolFinished["delegation_outcome"],
  intent: ToolStarted["delegation_intent"],
): string {
  if (status === "pending") return "Subagent pending";
  if (status === "awaiting-approval") return "Subagent awaiting approval";
  if (status === "running") {
    if (intent === "background_launch") return "Starting subagent…";
    if (intent) return "Working with subagent…";
    return "Subagent request in progress";
  }
  if (status === "timed-out") return "Subagent request timed out";
  if (status === "cancelled" && outcome !== "cancelled") return "Subagent request cancelled";
  if (outcome === "failed") return "Subagent failed";
  if (outcome === "cancelled") return "Subagent cancelled";
  if (outcome === "interrupted") return "Subagent interrupted";
  if (status === "cancelled") return "Subagent request cancelled";
  if (status === "interrupted") return "Subagent request interrupted";
  if (status === "error") return "Subagent request failed";
  if (outcome === "background_started") return "Subagent started";
  if (outcome === "background_continued") return "Instructions sent to subagent";
  if (outcome === "completed") return "Subagent completed";
  return "Subagent request finished";
}

export function presentToolCall({
  call,
  events,
  hasResult,
  resultText,
  resultHasImage,
  active,
  awaitingApproval,
  turnCancelled,
}: {
  call: ToolCall;
  events?: ToolEventPair;
  hasResult: boolean;
  /** Read only for fixed cancellation/interruption markers and launch records; never displayed. */
  resultText: string | null;
  resultHasImage: boolean;
  active: boolean;
  /** Canonical pending permission state correlated by the backend call id. */
  awaitingApproval?: boolean;
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
  else if (active && awaitingApproval) status = "awaiting-approval";
  else if (active && events?.started) status = "running";
  else if (active) status = "pending";
  else status = "interrupted";

  let resultPreview = bounded(events?.finished?.content_preview, PREVIEW_LIMIT) || null;
  // Older traditional-child events have no exact-value redaction provenance.
  // Native outcome/summary facts are stripped at untrusted worker ingress.
  if (
    ["subagent", "subagent_status", "subagent_cancel"].includes(name) &&
    !events?.finished?.delegation_outcome &&
    !events?.finished?.delegation_summary
  ) {
    resultPreview = null;
  }
  // Durable legacy previews may predate typed request timeout/cancel wording.
  // Reconstruct only fixed text from the authoritative status; never raw output.
  if (events?.finished) {
    const request =
      name === "subagent"
        ? "Subagent request"
        : name === "subagent_status"
          ? "Subagent status request"
          : name === "subagent_cancel"
            ? "Subagent cancellation request"
            : null;
    if (isLegacyConfirmedCancellation(events.finished))
      resultPreview = "Subagent cancellation request finished";
    if (request && events.finished.completion_status === "timed_out")
      resultPreview = `${request} timed out`;
    if (
      request &&
      events.finished.completion_status === "cancelled" &&
      !(name === "subagent" && events.finished.delegation_outcome === "cancelled") &&
      !isLegacyConfirmedCancellation(events.finished)
    )
      resultPreview = `${request} cancelled`;
  }
  if (!resultPreview && resultHasImage) resultPreview = "Image result";
  if (!resultPreview && status === "cancelled") resultPreview = "No result was retained.";
  if (!resultPreview && status === "interrupted") resultPreview = "No result was recorded.";

  const spawnedSessionId = spawnedSession(name, call, resultText);
  const summary =
    bounded(
      name === "subagent"
        ? (events?.started?.delegation_summary_verified || events?.started?.delegation_intent
            ? events.started.key_arg_preview
            : null) || events?.finished?.delegation_summary
        : events?.started?.key_arg_preview,
      PREVIEW_LIMIT,
    ) || null;
  // Prior candidate events could certify a continuation's ID as its summary.
  // Suppress canonical IDs even when only a finish event remains in the window.
  const provenBackgroundLaunch =
    events?.started?.delegation_intent === "background_launch" ||
    events?.finished?.delegation_outcome === "background_started";
  const idOnlySummary =
    name === "subagent" &&
    summary &&
    (summary === spawnedSessionId ||
      (!provenBackgroundLaunch &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(summary)));

  const presentation: ToolPresentation = {
    callId: call.id,
    name,
    label:
      name === "subagent"
        ? subagentLabel(
            status,
            events?.finished?.delegation_outcome,
            events?.started?.delegation_intent,
          )
        : toolLabel(name),
    summary: idOnlySummary ? null : summary,
    resultPreview,
    status,
    statusLabel:
      name === "subagent" &&
      events?.finished?.delegation_outcome === "background_started" &&
      status === "success"
        ? "Running in background"
        : STATUS_LABELS[status],
  };
  if (name === "subagent" && events?.started?.delegation_intent) {
    presentation.delegationIntent = events.started.delegation_intent;
  }
  if (name === "subagent" && events?.finished?.delegation_outcome) {
    presentation.delegationOutcome = events.finished.delegation_outcome;
  }
  const durationMs = events?.finished?.execution_duration_ms;
  if (durationMs != null && Number.isFinite(durationMs) && durationMs >= 0) {
    presentation.durationMs = durationMs;
  }
  if (spawnedSessionId) presentation.spawnedSessionId = spawnedSessionId;
  const task = launchedTask(name, resultText);
  if (task) presentation.launchedTask = task;
  return presentation;
}
