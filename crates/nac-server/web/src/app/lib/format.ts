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

/**
 * Collapse a `/plan` or `/run` command message back to its short human form.
 * Non-command text is returned unchanged.
 */
export function displayPromptFromMessageText(
  content: string | null | undefined,
): string {
  const text = String(content ?? "");
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

export function displaySessionTitle(
  summary: SessionSummarySnapshot | null | undefined,
): string {
  if (!summary) return "";
  if (typeof summary.title === "string" && summary.title.trim()) {
    return summary.title.trim();
  }
  const prompt = (summary.last_user_prompt ?? "").trim();
  if (prompt) return prompt;
  return shortId(summary.session_id) || "session";
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
 * Spend for the chat input bar. Anything that is not a positive amount reads
 * as "--": zero means the catalog has no rates for the model, so naming a
 * price would be a claim the backend never made.
 */
export function formatCostMicros(micros: number | null | undefined): string {
  if (micros == null) return "--";
  const value = Math.round(Number(micros));
  if (!Number.isFinite(value) || value <= 0) return "--";
  const dollars = value / 1_000_000;
  if (dollars >= 0.01) return `$${dollars.toFixed(2)}`;
  return `$${Number(dollars.toPrecision(3))}`;
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
 * A store timestamp as a short local date and time. The store writes UTC as
 * "YYYY-MM-DD HH:MM:SS" with no zone marker, which JavaScript would otherwise
 * read as local time and shift by the offset.
 */
export function formatStoreTime(value: string): string {
  const parsed = new Date(`${value.replace(" ", "T")}Z`);
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
export function sessionEnvLabel(
  summary: SessionSummarySnapshot | null | undefined,
): SessionEnv {
  if (!summary) return ENV_LOCAL;
  if (summary.sandboxed) return ENV_SANDBOX;
  if (summary.ssh_host) return ENV_SSH;
  return ENV_LOCAL;
}

const TERMINAL_RUN_STATES = [
  "done",
  "completed",
  "cancelled",
  "canceled",
  "failed",
  "error",
];

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

export interface SessionRunMetrics {
  model: string;
  /** Where the run executes, shown as the small uppercase label. */
  env: string;
  active: boolean;
  startedAt: number | null;
  lastResponseMs: number | null;
  usage: TokenUsage | null;
}

/** The values the chat input bar reports underneath the message field. */
export function runMetrics(
  snapshot: SessionSnapshotResponse | null | undefined,
  entry: ManagedSessionSummary | null | undefined,
): SessionRunMetrics {
  const meta = snapshot?.metadata;
  const summary = entry?.summary;
  const activeRun = snapshot?.active_run ?? entry?.active_run ?? null;
  const active = isActiveRun(activeRun);

  return {
    model: meta?.model ?? summary?.model ?? "--",
    env: sessionEnvLabel(summary).toUpperCase(),
    active,
    startedAt: active && activeRun ? activeRun.started_at_epoch_ms : null,
    lastResponseMs: snapshot?.response_timing.last_response_duration_ms ?? null,
    usage: tokenUsage(snapshot),
  };
}
