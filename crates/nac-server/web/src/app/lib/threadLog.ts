// A thread's command log, as read from either source it arrives on.
//
// The SSE stream carries the commands of a running thread, and the snapshot
// carries the same events once they are persisted. Both are folded into the
// same line shape here so the card tail and the side panel show one log rather
// than two half-logs, and so the copies of one event collapse into one line.

import type { AgentEvent } from "@/app/types/api";

export interface ThreadLogLine {
  /**
   * Identifies the event behind the line. The live and the persisted copy of
   * one event share it, which is what keeps the merge below from repeating it.
   */
  key: string;
  text: string;
  isError: boolean;
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
export function threadLogLine(
  event: AgentEvent,
  seq: number,
): ThreadLogLine | null {
  switch (event.type) {
    case "tool_call_started":
      // The server reduces the arguments to the one worth reading; the full
      // preview is JSON, which a single truncated line cannot carry anyway.
      return {
        key: `call-${event.call_id}`,
        text: `▸ ${event.name}: ${event.key_arg_preview || event.args_preview}`,
        isError: false,
      };
    case "tool_call_finished":
      return {
        key: `result-${event.call_id}`,
        text: `${event.is_error ? "✕" : "✓"} ${event.name}: ${event.content_preview}`,
        isError: event.is_error,
      };
    case "thread_log":
      return { key: `log-${seq}`, text: event.line, isError: false };
    default:
      return null;
  }
}

/** The log a snapshot persisted for one thread, oldest first. */
export function persistedThreadLog(
  events: AgentEvent[] | undefined,
): ThreadLogLine[] {
  const lines: ThreadLogLine[] = [];
  (events ?? []).forEach((event, index) => {
    const line = threadLogLine(event, index);
    if (line) lines.push(line);
  });
  return lines;
}

/**
 * The persisted log followed by whatever the stream has added on top of it.
 *
 * The snapshot is only refetched at message boundaries while tool calls arrive
 * between them, so the two overlap by however much of the run is already on
 * disk; the shared line keys are what tells that overlap apart.
 */
export function mergeThreadLog(
  persisted: ThreadLogLine[],
  live: ThreadLogLine[],
): ThreadLogLine[] {
  if (!live.length) return persisted;
  if (!persisted.length) return live;
  const seen = new Set(persisted.map((line) => line.key));
  return [...persisted, ...live.filter((line) => !seen.has(line.key))];
}
