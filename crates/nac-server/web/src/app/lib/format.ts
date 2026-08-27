// Presentation helpers ported from the legacy UI. Behaviour is intentionally
// identical, including the exact placeholder strings.

import type {
  ActiveRunSnapshot,
  ManagedSessionSummary,
  SessionSnapshotResponse,
  SessionSummarySnapshot,
  TokenUsage,
} from "@/app/types/api";

export function shortId(id: string | null | undefined): string {
  if (!id) return "--";
  return id.length > 13 ? `${id.slice(0, 8)}:${id.slice(-4)}` : id;
}

// The `$skillname` expansion wire format, pinned byte-for-byte with nac-core
// `commands.rs` by fixtures/invoked-skills-format.json at the repo root.
export const INVOKED_SKILLS_OPEN = "<invoked_skills>";
export const INVOKED_SKILLS_CLOSE = "</invoked_skills>";
export const INVOKED_SKILLS_SEPARATOR = "\n\n<invoked_skills>\n";
const SKILL_CONTENT_OPEN = '<skill_content name="';
const SKILL_CONTENT_CLOSE = "</skill_content>";

/** A stored user message recognized as a `$skillname`-expanded prompt. */
interface InvokedSkillsExpansion {
  /** The prompt as the user typed it: everything before the last separator. */
  head: string;
  /** The expanded skills' names, in block order. */
  names: string[];
}

/**
 * Parse one well-formed `<skill_content name="...">...</skill_content>` block
 * at the start of `text`. Mirrors `parse_skill_content_block` in nac-core
 * `commands.rs` byte-for-byte: the name runs to the next `"` and must be
 * non-empty with no `<` or `>` (a rendered name can never contain those —
 * `escape_xml` replaces them), and the block ends at the first
 * `</skill_content>` (rendered bodies have the tag neutralized, so the first
 * one closes the block).
 */
function parseSkillContentBlock(text: string): { name: string; rest: string } | null {
  if (!text.startsWith(SKILL_CONTENT_OPEN)) return null;
  const afterOpen = text.slice(SKILL_CONTENT_OPEN.length);
  const quote = afterOpen.indexOf('"');
  if (quote === -1) return null;
  const name = afterOpen.slice(0, quote);
  if (name === "" || name.includes("<") || name.includes(">")) return null;
  const afterQuote = afterOpen.slice(quote + 1);
  if (!afterQuote.startsWith(">")) return null;
  const body = afterQuote.slice(1);
  const close = body.indexOf(SKILL_CONTENT_CLOSE);
  if (close === -1) return null;
  return { name, rest: body.slice(close + SKILL_CONTENT_CLOSE.length) };
}

/**
 * Recognize a `$skillname`-expanded prompt structurally. Mirrors
 * `invoked_skills_display_prompt` in nac-core `commands.rs` byte-for-byte:
 * the message must end with `\n` + the closing tag, and the region between
 * the LAST separator and that final newline must be one or more well-formed
 * `<skill_content>` blocks joined by single `\n`s — exactly what the
 * expansion appends. Anything else (prose that happens to end with the
 * closing tag, a malformed tail) is user text and returns null.
 */
function parseInvokedSkillsExpansion(text: string): InvokedSkillsExpansion | null {
  if (!text.endsWith(INVOKED_SKILLS_CLOSE)) return null;
  const withoutClose = text.slice(0, text.length - INVOKED_SKILLS_CLOSE.length);
  if (!withoutClose.endsWith("\n")) return null;
  const tail = withoutClose.slice(0, -1);
  const index = tail.lastIndexOf(INVOKED_SKILLS_SEPARATOR);
  if (index === -1) return null;
  const head = tail.slice(0, index);
  let rest = tail.slice(index + INVOKED_SKILLS_SEPARATOR.length);
  const names: string[] = [];
  for (;;) {
    const block = parseSkillContentBlock(rest);
    if (block == null) return null;
    names.push(block.name);
    rest = block.rest;
    if (rest === "") return { head, names };
    if (!rest.startsWith("\n")) return null;
    rest = rest.slice(1);
    // A join newline with no block after it is not an expansion: real
    // expansions end the region with the last block, not a separator.
    if (rest === "") return null;
  }
}

function invokedSkillsDisplayPrompt(text: string): string | null {
  const expansion = parseInvokedSkillsExpansion(text);
  return expansion ? expansion.head : null;
}

/**
 * Names of the skills expanded into a stored user message, in block order —
 * null when the message is not a well-formed `$skillname` expansion. Parsed
 * from the same structural region the collapse recognizes, so the bubble's
 * indicator and its collapsed text always agree.
 */
export function invokedSkillNames(content: string | null | undefined): string[] | null {
  if (content == null) return null;
  const expansion = parseInvokedSkillsExpansion(String(content));
  return expansion ? expansion.names : null;
}

/**
 * Collapse an expanded prompt back to its short human form: a `$skillname`
 * expansion first (matching the Rust collapse order), then a legacy `/plan`
 * or `/run` command message. Non-command text is returned unchanged.
 */
export function displayPromptFromMessageText(content: string | null | undefined): string {
  const text = String(content ?? "");
  const collapsed = invokedSkillsDisplayPrompt(text);
  if (collapsed != null) return collapsed;
  const normalized = text.replaceAll("\r\n", "\n");
  const header = normalized.split("\n", 1)[0] ?? "";
  const match = /^# \/(plan|run)\s*:/.exec(header);
  if (!match) return text;
  const kind = match[1];
  const marker = kind === "run" ? "Workset id:\n" : "User instruction:\n";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) return text;
  const valueStart = markerIndex + marker.length;
  const valueEnd = normalized.indexOf("\n\n", valueStart);
  if (valueEnd === -1) return text;
  const value = normalized.slice(valueStart, valueEnd).trim();
  return value ? `/${kind} ${value}` : text;
}

/** Compact duration, e.g. 850 -> "0.9s", 62000 -> "1m 2s". */
export function formatDurationShort(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "--";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/** Model-call time as the transcript spells it out, e.g. 12324 -> "12.32s". */
export function formatSeconds(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  return `${(Math.round(ms / 10) / 100).toFixed(2)}s`;
}

/** What a chat is called until something in it can name it. */
export const NEW_CHAT_TITLE = "New Chat";

/** A chat nobody has named and nobody has said anything in yet. */
export function isUntitledSession(summary: SessionSummarySnapshot | null | undefined): boolean {
  if (!summary) return false;
  if (summary.title != null && summary.title.trim()) return false;
  return !(summary.last_user_prompt ?? "").trim();
}

export function displaySessionTitle(summary: SessionSummarySnapshot | null | undefined): string {
  if (!summary) return "";
  if (summary.title != null && summary.title.trim()) {
    return summary.title.trim();
  }
  const prompt = displayPromptFromMessageText(summary.last_user_prompt).trim();
  if (prompt) return prompt;
  return NEW_CHAT_TITLE;
}

/**
 * The label every list, search box and action should use: numbered untitled
 * chats when a map is supplied, otherwise the unnumbered display title.
 */
export function sessionTitle(
  summary: SessionSummarySnapshot | null | undefined,
  numbered: ReadonlyMap<string, string>,
): string {
  if (!summary) return "";
  return numbered.get(summary.session_id) ?? displaySessionTitle(summary);
}

/**
 * Tells the untitled chats apart, since they would otherwise all answer to the
 * same name: the oldest keeps the plain "New Chat" and each later one takes the
 * next number.
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
export function numberUntitledSessions(sessions: ManagedSessionSummary[]): Map<string, string> {
  const names = new Map<string, string>();
  const takenPerProject = new Map<string, number>();
  const untitled = sessions
    .filter((entry) => isUntitledSession(entry.summary))
    .sort((a, b) => a.summary.created_at.localeCompare(b.summary.created_at));
  for (const { summary } of untitled) {
    const project = summary.project_id ?? "";
    const taken = takenPerProject.get(project) ?? 0;
    takenPerProject.set(project, taken + 1);
    names.set(summary.session_id, taken === 0 ? NEW_CHAT_TITLE : `${NEW_CHAT_TITLE} ${taken}`);
  }
  return names;
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null) return "--";
  const v = Number(n);
  if (!Number.isFinite(v)) return "--";
  if (Math.abs(v) >= 1000) {
    return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  }
  return String(v);
}

/** Token counts for the chat input bar, e.g. 185000 -> "185K", 14.3e6 -> "14.3M". */
export function formatTokensCompact(n: number | null | undefined): string {
  if (n == null) return "--";
  const v = Number(n);
  if (!Number.isFinite(v)) return "--";
  const scale = (divisor: number, suffix: string) => {
    const scaled = v / divisor;
    return `${scaled.toFixed(Math.abs(scaled) >= 100 || v % divisor === 0 ? 0 : 1)}${suffix}`;
  };
  if (Math.abs(v) >= 1_000_000) return scale(1_000_000, "M");
  if (Math.abs(v) >= 1_000) return scale(1_000, "K");
  return String(v);
}

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
export function formatCostMicros(micros: number | null | undefined): string {
  if (micros == null) return "--";
  const value = Math.round(Number(micros));
  if (!Number.isFinite(value) || value <= 0) return "--";
  const dollars = value / 1_000_000;
  if (dollars < 0.01) return "<\u00a0$0.01";
  return `$${dollars.toFixed(2)}`;
}

/** Clock for a running session card: MM:SS, widening to H:MM:SS past an hour. */
export function formatClock(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "--:--";
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  const h = Math.floor(total / 3600);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${s}`;
  return `${String(m).padStart(2, "0")}:${s}`;
}

/**
 * A store timestamp as epoch milliseconds, or NaN if it cannot be read.
 *
 * The store writes UTC as "YYYY-MM-DD HH:MM:SS" with no zone marker, which
 * `Date.parse` reads as local time. Left alone that shifts every timestamp by
 * the viewer's offset, which is enough to file a project made a minute ago
 * under yesterday. Anything that does name its zone is taken at its word.
 */
export function parseStoreTime(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  const isoish = value.replace(" ", "T");
  return Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/.test(isoish) ? isoish : `${isoish}Z`);
}

/** A store timestamp as a short local date and time. */
export function formatStoreTime(value: string): string {
  const parsed = new Date(parseStoreTime(value));
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRuntime(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "--:--:--";
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export const ENV_LOCAL = "Local";
export const ENV_SSH = "SSH";
export const ENV_SANDBOX = "Sandbox";
export const SESSION_ENVS = [ENV_LOCAL, ENV_SSH, ENV_SANDBOX] as const;
export type SessionEnv = (typeof SESSION_ENVS)[number];

/**
 * Where the session runs. Sandbox and ssh are mutually exclusive in practice,
 * and sandbox wins because it is the more specific isolation.
 */
export function sessionEnvLabel(summary: SessionSummarySnapshot | null | undefined): SessionEnv {
  if (!summary) return ENV_LOCAL;
  if (summary.sandboxed) return ENV_SANDBOX;
  if (summary.ssh_host) return ENV_SSH;
  return ENV_LOCAL;
}

const TERMINAL_RUN_STATES = ["done", "completed", "cancelled", "canceled", "failed", "error"];

/** A truthy active run without a terminal state still counts as running. */
export function isActiveRun(
  activeRun: (ActiveRunSnapshot & { state?: string; status?: string }) | null | undefined,
): boolean {
  if (!activeRun) return false;
  const state = (activeRun.state ?? activeRun.status ?? "").toLowerCase();
  return !TERMINAL_RUN_STATES.includes(state);
}

export interface DiffTotals {
  additions: number;
  deletions: number;
  error: string;
}

export function diffTotals(
  entry: ManagedSessionSummary | null | undefined,
  snapshot: SessionSnapshotResponse | null | undefined,
): DiffTotals {
  const wd = snapshot?.workspace ?? entry?.workspace_diff;
  return {
    additions: wd?.total_additions ?? 0,
    deletions: wd?.total_deletions ?? 0,
    error: wd?.error ?? "",
  };
}

export function tokenUsage(
  snapshot: SessionSnapshotResponse | null | undefined,
): TokenUsage | null {
  const timing = snapshot?.response_timing;
  if (!timing) return null;
  return timing.cumulative_token_usage ?? timing.last_token_usage ?? null;
}

/**
 * Sum the billable fields of two usages. `contextTokens` is passed in rather
 * than added, because `total_tokens` gauges how full the context window is —
 * adding two readings of it would be meaningless.
 */
export function addTokenUsage(
  base: TokenUsage | null | undefined,
  delta: TokenUsage,
  contextTokens: number,
): TokenUsage {
  return {
    input_tokens: (base?.input_tokens ?? 0) + delta.input_tokens,
    output_tokens: (base?.output_tokens ?? 0) + delta.output_tokens,
    cache_read_tokens: (base?.cache_read_tokens ?? 0) + delta.cache_read_tokens,
    cache_write_tokens: (base?.cache_write_tokens ?? 0) + delta.cache_write_tokens,
    reasoning_tokens: (base?.reasoning_tokens ?? 0) + (delta.reasoning_tokens ?? 0),
    total_tokens: contextTokens,
    cost:
      base?.cost || delta.cost
        ? {
            input: (base?.cost?.input ?? 0) + (delta.cost?.input ?? 0),
            output: (base?.cost?.output ?? 0) + (delta.cost?.output ?? 0),
            cache_read: (base?.cost?.cache_read ?? 0) + (delta.cost?.cache_read ?? 0),
            cache_write: (base?.cost?.cache_write ?? 0) + (delta.cost?.cache_write ?? 0),
            total: (base?.cost?.total ?? 0) + (delta.cost?.total ?? 0),
          }
        : undefined,
  };
}

export function tokenUsageHasSpend(usage: TokenUsage | null | undefined): boolean {
  if (!usage) return false;
  return (
    usage.input_tokens +
      usage.output_tokens +
      usage.cache_read_tokens +
      usage.cache_write_tokens +
      (usage.cost?.total ?? 0) >
    0
  );
}

/**
 * Session spend must never drop: take the higher billable reading of two
 * totals. Context-window `total_tokens` is a gauge, so the first argument
 * (live/persisted) wins when it is non-zero.
 */
export function maxBillableUsage(
  a: TokenUsage | null | undefined,
  b: TokenUsage | null | undefined,
): TokenUsage | null {
  if (!tokenUsageHasSpend(a)) return tokenUsageHasSpend(b) ? (b ?? null) : null;
  if (!a || !tokenUsageHasSpend(b) || !b) return a ?? null;
  return {
    input_tokens: Math.max(a.input_tokens, b.input_tokens),
    output_tokens: Math.max(a.output_tokens, b.output_tokens),
    cache_read_tokens: Math.max(a.cache_read_tokens, b.cache_read_tokens),
    cache_write_tokens: Math.max(a.cache_write_tokens, b.cache_write_tokens),
    reasoning_tokens: Math.max(a.reasoning_tokens ?? 0, b.reasoning_tokens ?? 0),
    total_tokens: a.total_tokens || b.total_tokens,
    cost:
      a.cost || b.cost
        ? {
            input: Math.max(a.cost?.input ?? 0, b.cost?.input ?? 0),
            output: Math.max(a.cost?.output ?? 0, b.cost?.output ?? 0),
            cache_read: Math.max(a.cost?.cache_read ?? 0, b.cost?.cache_read ?? 0),
            cache_write: Math.max(a.cost?.cache_write ?? 0, b.cost?.cache_write ?? 0),
            total: Math.max(a.cost?.total ?? 0, b.cost?.total ?? 0),
          }
        : undefined,
  };
}

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
export function runMetrics(
  snapshot: SessionSnapshotResponse | null | undefined,
  entry: ManagedSessionSummary | null | undefined,
  runUsage?: TokenUsage | null,
  sessionSpend?: TokenUsage | null,
): SessionRunMetrics {
  const meta = snapshot?.metadata;
  const summary = entry?.summary;
  const activeRun = snapshot?.active_run ?? entry?.active_run ?? null;
  const active = isActiveRun(activeRun);
  const persisted = tokenUsage(snapshot);
  const folded = runUsage
    ? addTokenUsage(persisted, runUsage, runUsage.total_tokens || (persisted?.total_tokens ?? 0))
    : persisted;

  return {
    model: meta?.model ?? summary?.model ?? "--",
    env: sessionEnvLabel(summary).toUpperCase(),
    active,
    startedAt: active && activeRun ? activeRun.started_at_epoch_ms : null,
    lastResponseMs: snapshot?.response_timing.last_response_duration_ms ?? null,
    usage: maxBillableUsage(folded, sessionSpend),
  };
}
