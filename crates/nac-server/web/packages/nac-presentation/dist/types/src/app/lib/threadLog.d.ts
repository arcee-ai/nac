import type { AgentEvent, ThreadEventPage } from "../types/api";
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
/** Whether a finished tool call should read as a failure. */
export declare function toolCallFailed(event: {
    is_error: boolean;
    content_preview: string;
    completion_status?: "success" | "error" | "timed_out" | "cancelled" | null;
    command_status?: "completed" | "timed_out" | "cancelled" | "spawn_error" | null;
}): boolean;
/**
 * How one of a thread's events reads in a log, or null for an event that says
 * nothing about what the thread is doing.
 *
 * The tool calls are the substance of it, and their call id gives those lines an
 * identity that survives being persisted. `seq` stands in for the events that
 * carry no id of their own; only the worker's own output does, and that is never
 * persisted, so a counter from the live stream is identity enough.
 */
export declare function threadLogLine(event: AgentEvent, seq: number): ThreadLogLine | null;
/** The log a snapshot persisted for one thread, oldest first. */
export declare function persistedThreadLog(events: AgentEvent[] | undefined): ThreadLogLine[];
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
export declare function mergeThreadLog(persisted: ThreadLogLine[], live: ThreadLogLine[]): ThreadLogLine[];
/** Chronological, ID-unique event history from newest-first cursor pages. */
export declare function mergeThreadEventPages(pages: ThreadEventPage[]): AgentEvent[];
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
export declare function groupThreadLog(lines: ThreadLogLine[]): LogEntry[];
/**
 * Whether the command log should show a live "▸ Working…" line: the thread is
 * still working, but no tool call is in flight — so the model is between steps
 * (or preparing the next one). Without this the log looks stuck after a ✓.
 */
export declare function threadIsThinking(running: boolean, lines: ThreadLogLine[]): boolean;
