// A thread's command log, as read from either source it arrives on.
//
// The SSE stream carries the commands of a running thread, and the snapshot
// carries the same events once they are persisted. Both are folded into the
// same line shape here so the card tail and the side panel show one log rather
// than two half-logs, and so the copies of one event collapse into one line.

import type { AgentEvent, ThreadEventPage } from "@/app/types/api";

export interface ThreadLogLine {
  /**
   * Identifies the event behind the line. The live and the persisted copy of
   * one event share it, which is what keeps the merge below from repeating it.
   */
  key: string;
  text: string;
  /**
   * The same line without the tool's name. The card tail has room for one
   * truncated line, where the name costs more than the command it hides.
   */
  bare: string;
  /** Leading glyph, for the views that colour it apart from the command. */
  mark: string | null;
  /** Tool the line belongs to, when it names one. */
  name: string | null;
  /** What is left of the line once the glyph and the name are taken out. */
  body: string;
  isError: boolean;
}

/** Opening of the legacy preview a command killed by its own timeout returned. */
const TIMED_OUT_PREVIEW = "Command timed out after";

/** Whether a finished tool call should read as a failure. */
export function toolCallFailed(event: {
  is_error: boolean;
  content_preview: string;
  command_status?: "completed" | "timed_out" | "cancelled" | "spawn_error";
}): boolean {
  if (event.command_status !== undefined) {
    return event.is_error || event.command_status !== "completed";
  }
  return event.is_error || event.content_preview.startsWith(TIMED_OUT_PREVIEW);
}

/**
 * How one of a thread's events reads in a log, or null for an event that says
 * nothing about what the thread is doing.
 *
 * The tool calls are the substance of it, and their call id gives those lines an
 * identity that survives being persisted. `seq` stands in for the events that
 * carry no id of their own; only the worker's own output does, and that is never
 * persisted, so a counter from the live stream is identity enough.
 */
export function threadLogLine(event: AgentEvent, seq: number): ThreadLogLine | null {
  switch (event.type) {
    case "tool_call_started": {
      // The server reduces the arguments to the one worth reading; the full
      // preview is JSON, which a single truncated line cannot carry anyway.
      const command = event.key_arg_preview || event.args_preview;
      return {
        key: `call-${event.call_id}`,
        text: `▸ ${event.name}: ${command}`,
        bare: `▸ ${command}`,
        mark: "▸",
        name: event.name,
        body: command,
        isError: false,
      };
    }
    case "tool_call_finished": {
      const failed = toolCallFailed(event);
      const mark = failed ? "✕" : "✓";
      return {
        key: `result-${event.call_id}`,
        text: `${mark} ${event.name}: ${event.content_preview}`,
        bare: `${mark} ${event.content_preview}`,
        mark,
        name: event.name,
        body: event.content_preview,
        isError: failed,
      };
    }
    case "thread_log":
      return {
        key: `log-${seq}`,
        text: event.line,
        bare: event.line,
        mark: null,
        name: null,
        body: event.line,
        isError: false,
      };
    case "mcp_server_skipped": {
      const line = `⚠ MCP server "${event.server_name}" skipped: ${event.reason}`;
      return {
        key: `log-${seq}`,
        text: line,
        bare: line,
        mark: null,
        name: null,
        body: line,
        isError: false,
      };
    }
    default:
      return null;
  }
}

/** The log a snapshot persisted for one thread, oldest first. */
export function persistedThreadLog(events: AgentEvent[] | undefined): ThreadLogLine[] {
  const lines: ThreadLogLine[] = [];
  (events ?? []).forEach((event, index) => {
    const line = threadLogLine(event, index);
    if (line) lines.push(line);
  });
  return lines;
}

/**
 * The persisted log with the stream spliced around it.
 *
 * The snapshot is only refetched at message boundaries while tool calls arrive
 * between them, so the two overlap by however much of the run is already on
 * disk; the shared line keys are what tells that overlap apart.
 *
 * The overlap is a range rather than a suffix, because the persisted side is a
 * page of the newest events while the live side reaches back to the dispatch —
 * so a thread that issues more commands than one page holds has live lines on
 * both sides of the window. Both sides are chronological, which is what lets
 * the two ends be placed around it: appending everything the window lacks
 * would drop the older half of the run behind the newer one, and a call whose
 * result ended up on the far side of that seam then reads as a command still
 * in flight.
 */
export function mergeThreadLog(persisted: ThreadLogLine[], live: ThreadLogLine[]): ThreadLogLine[] {
  if (!live.length) return persisted;
  if (!persisted.length) return live;
  const seen = new Set(persisted.map((line) => line.key));
  let first = -1;
  let last = -1;
  live.forEach((line, index) => {
    if (!seen.has(line.key)) return;
    if (first < 0) first = index;
    last = index;
  });
  // Nothing shared: the live log either continues the window or belongs to a
  // dispatch the window predates, and in both readings it comes after.
  if (first < 0) return [...persisted, ...live];
  return [...live.slice(0, first), ...persisted, ...live.slice(last + 1)];
}

/** Chronological, ID-unique event history from newest-first cursor pages. */
export function mergeThreadEventPages(pages: ThreadEventPage[]): AgentEvent[] {
  const byId = new Map<number, AgentEvent>();
  for (const page of pages) {
    for (const record of page.events) byId.set(record.id, record.event);
  }
  return [...byId.entries()].sort(([left], [right]) => left - right).map(([, event]) => event);
}

// ---------------------------------------------------------------------------
// Paired tool-call / result grouping
//
// The flat log interleaves `call-` and `result-` lines for the same call id.
// Grouping them lets the panel render a call and its outcome as one entry,
// with the result indented beneath the call rather than separated by every
// other command the thread issued in between.
// ---------------------------------------------------------------------------

export interface ToolCallEntry {
  kind: "tool_call";
  callId: string;
  toolName: string;
  keyArg: string;
  status: "pending" | "success" | "error";
  resultPreview: string | null;
  isError: boolean;
}

export interface StandaloneLine {
  kind: "log";
  key: string;
  /** Leading glyph, kept apart so only it carries the outcome's colour. */
  mark: string | null;
  /** Tool the line names — an orphan result has no call line to name it. */
  name: string | null;
  body: string;
  isError: boolean;
}

export type LogEntry = ToolCallEntry | StandaloneLine;

/**
 * Folds a merged `ThreadLogLine[]` into `LogEntry[]`, pairing each tool-call
 * start with its matching finish. Lines whose key does not name a tool call
 * (worker log output) pass through as `StandaloneLine`.
 *
 * A `result-` line whose `call-` partner is missing — the persisted window was
 * trimmed, or the start arrived on a different channel — is emitted as a
 * standalone line so the outcome is not silently dropped.
 */
export function groupThreadLog(lines: ThreadLogLine[]): LogEntry[] {
  const entries: LogEntry[] = [];
  const byCallId = new Map<string, ToolCallEntry>();

  for (const line of lines) {
    if (line.key.startsWith("call-")) {
      const callId = line.key.slice("call-".length);
      const entry: ToolCallEntry = {
        kind: "tool_call",
        callId,
        toolName: line.name ?? "",
        keyArg: line.body,
        status: "pending",
        resultPreview: null,
        isError: false,
      };
      byCallId.set(callId, entry);
      entries.push(entry);
    } else if (line.key.startsWith("result-")) {
      const callId = line.key.slice("result-".length);
      const match = byCallId.get(callId);
      if (match) {
        match.status = line.isError ? "error" : "success";
        match.resultPreview = line.body;
        match.isError = line.isError;
      } else {
        // Orphan result — surface it rather than swallow it.
        entries.push({
          kind: "log",
          key: line.key,
          mark: line.mark,
          name: line.name,
          body: line.body,
          isError: line.isError,
        });
      }
    } else {
      entries.push({
        kind: "log",
        key: line.key,
        mark: line.mark,
        name: line.name,
        body: line.body,
        isError: line.isError,
      });
    }
  }

  return entries;
}

/**
 * Whether the command log should show a live "▸ Working…" line: the thread is
 * still working, but no tool call is in flight — so the model is between steps
 * (or preparing the next one). Without this the log looks stuck after a ✓.
 */
export function threadIsThinking(running: boolean, lines: ThreadLogLine[]): boolean {
  if (!running) return false;
  const finished = new Set<string>();
  for (const line of lines) {
    if (line.key.startsWith("result-")) {
      finished.add(line.key.slice("result-".length));
    }
  }
  for (const line of lines) {
    if (line.key.startsWith("call-") && !finished.has(line.key.slice("call-".length))) {
      return false;
    }
  }
  return true;
}
