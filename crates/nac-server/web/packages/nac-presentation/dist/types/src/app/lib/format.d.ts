import type { ActiveRunSnapshot, ManagedSessionSummary, SessionSnapshotResponse, SessionSummarySnapshot, TokenUsage } from "../types/api";
export declare function shortId(id: string | null | undefined): string;
export declare const INVOKED_SKILLS_OPEN = "<invoked_skills>";
export declare const INVOKED_SKILLS_CLOSE = "</invoked_skills>";
export declare const INVOKED_SKILLS_SEPARATOR = "\n\n<invoked_skills>\n";
export declare const INVOKED_MCP_PROMPT_SEPARATOR = "\n\n<invoked_mcp_prompt>\n";
export declare const INVOKED_MCP_PROMPT_CLOSE = "\n</invoked_mcp_prompt>";
/**
 * Names of the skills expanded into a stored user message, in block order —
 * null when the message is not a well-formed `$skillname` expansion. Parsed
 * from the same structural region the collapse recognizes, so the bubble's
 * indicator and its collapsed text always agree.
 */
export declare function invokedSkillNames(content: string | null | undefined): string[] | null;
/**
 * Collapse an expanded prompt back to its short human form: a `$skillname`
 * expansion first (matching the Rust collapse order), then a legacy `/plan`
 * or `/run` command message. Non-command text is returned unchanged.
 */
export declare function displayPromptFromMessageText(content: string | null | undefined): string;
/** Compact duration, e.g. 850 -> "0.9s", 62000 -> "1m 2s". */
export declare function formatDurationShort(ms: number | null | undefined): string;
/** Model-call time as the transcript spells it out, e.g. 12324 -> "12.32s". */
export declare function formatSeconds(ms: number | null | undefined): string;
/** What a session is called until something in it can name it. */
export declare const NEW_CHAT_TITLE = "New Session";
/** A chat nobody has named and nobody has said anything in yet. */
export declare function isUntitledSession(summary: SessionSummarySnapshot | null | undefined): boolean;
export declare function displaySessionTitle(summary: SessionSummarySnapshot | null | undefined): string;
/**
 * The label every list, search box and action should use: numbered untitled
 * chats when a map is supplied, otherwise the unnumbered display title.
 */
export declare function sessionTitle(summary: SessionSummarySnapshot | null | undefined, numbered: ReadonlyMap<string, string>): string;
/**
 * Tells the untitled chats apart, since they would otherwise all answer to the
 * same name: the oldest keeps the plain "New Session" and each later one takes
 * the next number.
 *
 * Counting restarts per project — and once more over the chats that belong to
 * none — so a project's tab strip reads 1, 2, 3 instead of skipping the numbers
 * another project happened to take. Deleting one does renumber the chats after
 * it, which is the price of naming them by their place rather than storing a
 * name nobody chose.
 *
 * Timestamps are compared as text: the store writes them zero-padded and in
 * UTC, so they sort correctly without being parsed into dates first.
 */
export declare function numberUntitledSessions(sessions: ManagedSessionSummary[]): Map<string, string>;
export declare function formatTokens(n: number | null | undefined): string;
/** Token counts for the chat input bar, e.g. 185000 -> "185K", 14.3e6 -> "14.3M". */
export declare function formatTokensCompact(n: number | null | undefined): string;
/**
 * Spend wherever it is shown — the chat input bar and the session cards.
 * Anything that is not a positive amount reads as "--": zero means the catalog
 * has no rates for the model, so naming a price would be a claim the backend
 * never made.
 *
 * A cent is the smallest figure worth printing, and a spend under one is
 * reported as the bound it is under. Rounding it to "$0.00" would read as free,
 * and spelling it out as "$0.00726" is more digits than a status bar can be
 * read at a glance for — neither says what the number is actually good for,
 * which is knowing the session has cost next to nothing so far.
 *
 * The space is non-breaking: the two halves say nothing apart, and the bar this
 * sits in is tight enough to wrap them.
 */
export declare function formatCostMicros(micros: number | null | undefined): string;
/** Clock for a running session card: MM:SS, widening to H:MM:SS past an hour. */
export declare function formatClock(ms: number | null | undefined): string;
/**
 * A store timestamp as epoch milliseconds, or NaN if it cannot be read.
 *
 * The store writes UTC as "YYYY-MM-DD HH:MM:SS" with no zone marker, which
 * `Date.parse` reads as local time. Left alone that shifts every timestamp by
 * the viewer's offset, which is enough to file a project made a minute ago
 * under yesterday. Anything that does name its zone is taken at its word.
 */
export declare function parseStoreTime(value: string | null | undefined): number;
/** A store timestamp as a short local date and time. */
export declare function formatStoreTime(value: string): string;
export declare function formatRuntime(ms: number | null | undefined): string;
export declare const ENV_LOCAL = "Local";
export declare const ENV_SSH = "SSH";
export declare const ENV_SANDBOX = "Sandbox";
export declare const SESSION_ENVS: readonly ["Local", "SSH", "Sandbox"];
export type SessionEnv = (typeof SESSION_ENVS)[number];
/**
 * Where the session runs. Sandbox and ssh are mutually exclusive in practice,
 * and sandbox wins because it is the more specific isolation.
 */
export declare function sessionEnvLabel(summary: SessionSummarySnapshot | null | undefined): SessionEnv;
/** A truthy active run without a terminal state still counts as running. */
export declare function isActiveRun(activeRun: (ActiveRunSnapshot & {
    state?: string;
    status?: string;
}) | null | undefined): boolean;
export interface DiffTotals {
    additions: number;
    deletions: number;
    error: string;
}
export declare function diffTotals(entry: ManagedSessionSummary | null | undefined, snapshot: SessionSnapshotResponse | null | undefined): DiffTotals;
export declare function tokenUsage(snapshot: SessionSnapshotResponse | null | undefined): TokenUsage | null;
/**
 * Sum the billable fields of two usages. `contextTokens` is passed in rather
 * than added, because `total_tokens` gauges how full the context window is —
 * adding two readings of it would be meaningless.
 */
export declare function addTokenUsage(base: TokenUsage | null | undefined, delta: TokenUsage, contextTokens: number): TokenUsage;
export declare function tokenUsageHasSpend(usage: TokenUsage | null | undefined): boolean;
/**
 * Session spend must never drop: take the higher billable reading of two
 * totals. Context-window `total_tokens` is a gauge, so the first argument
 * (live/persisted) wins when it is non-zero.
 */
export declare function maxBillableUsage(a: TokenUsage | null | undefined, b: TokenUsage | null | undefined): TokenUsage | null;
export interface SessionRunMetrics {
    model: string;
    /** Where the run executes, shown as the small uppercase label. */
    env: string;
    active: boolean;
    startedAt: number | null;
    lastResponseMs: number | null;
    usage: TokenUsage | null;
}
/**
 * The values the chat input bar reports underneath the message field.
 *
 * `runUsage` is the live delta the snapshot does not account for yet.
 * `sessionSpend` is a high-water total for this tab, so Stop cannot drop the
 * bar back to a zero snapshot before persist lands.
 */
export declare function runMetrics(snapshot: SessionSnapshotResponse | null | undefined, entry: ManagedSessionSummary | null | undefined, runUsage?: TokenUsage | null, sessionSpend?: TokenUsage | null): SessionRunMetrics;
