// Presentation helpers ported from app.js (card view model + metrics bar).

export function shortId(id) {
  if (!id) return "--";
  return id.length > 13 ? `${id.slice(0, 8)}:${id.slice(-4)}` : id;
}

// Collapse a `/plan` or `/run` command message back to its short human form
// (mirrors app.js displayPromptFromMessageText). Non-command text is returned
// unchanged.
export function displayPromptFromMessageText(content) {
  const text = String(content || "");
  const normalized = text.replaceAll("\r\n", "\n");
  const header = normalized.split("\n", 1)[0] || "";
  const match = header.match(/^# \/(plan|run)\s*:/);
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

// Compact duration, e.g. 850 -> "0.9s", 62000 -> "1m 2s".
export function formatDurationShort(ms) {
  if (ms == null || !isFinite(ms)) return "--";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function displaySessionTitle(summary) {
  if (!summary) return "";
  if (typeof summary.title === "string" && summary.title.trim()) return summary.title.trim();
  const prompt = (summary.last_user_prompt || "").trim();
  if (prompt) return prompt;
  return shortId(summary.session_id) || "session";
}

export function formatTokens(n) {
  if (n == null) return "--";
  const v = Number(n);
  if (!isFinite(v)) return "--";
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "k";
  return String(v);
}

// Clock for a running session card: MM:SS, widening to H:MM:SS past an hour.
export function formatClock(ms) {
  if (ms == null || !isFinite(ms)) return "--:--";
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  const h = Math.floor(total / 3600);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${s}`;
  return `${String(m).padStart(2, "0")}:${s}`;
}

export const ENV_LOCAL = "Local";
export const ENV_SSH = "SSH";
export const ENV_SANDBOX = "Sandbox";
export const SESSION_ENVS = [ENV_LOCAL, ENV_SSH, ENV_SANDBOX];

// Where the session runs: sandbox and ssh are mutually exclusive in practice,
// and sandbox wins because it is the more specific isolation.
export function sessionEnvLabel(summary) {
  if (!summary) return ENV_LOCAL;
  if (summary.sandboxed) return ENV_SANDBOX;
  if (summary.ssh_host) return ENV_SSH;
  return ENV_LOCAL;
}

// Compact id for the card badge; the full id stays available for copying.
export function sessionIdShort(id) {
  if (!id) return "--";
  return id.length > 11 ? id.slice(0, 11) : id;
}

export function formatRuntime(ms) {
  if (ms == null || !isFinite(ms)) return "--:--:--";
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// An active run that still "counts" (matches app.js activeRunCountsForSession
// loosely): a truthy active_run object without a terminal state.
export function isActiveRun(activeRun) {
  if (!activeRun) return false;
  const state = (activeRun.state || activeRun.status || "").toLowerCase();
  if (["done", "completed", "cancelled", "canceled", "failed", "error"].includes(state)) return false;
  return true;
}

export function diffTotals(entry, snapshot) {
  const wd = (snapshot && snapshot.workspace) || entry.workspace_diff || {};
  return {
    additions: wd.total_additions || 0,
    deletions: wd.total_deletions || 0,
    error: wd.error || "",
  };
}

export function tokenUsage(snapshot) {
  const rt = snapshot && snapshot.response_timing;
  if (!rt) return null;
  return rt.cumulative_token_usage || rt.last_token_usage || null;
}

// Build the six metrics shown in the inspector summary grid. The frontend
// snapshot nests config under `metadata`; the list entry exposes `summary`.
export function metricsFromSnapshot(snapshot, entry) {
  const meta = (snapshot && snapshot.metadata) || {};
  const summary = (entry && entry.summary) || {};
  const activeRun = (snapshot && snapshot.active_run) || (entry && entry.active_run);
  const active = isActiveRun(activeRun);
  const usage = tokenUsage(snapshot);
  let tokens = "--";
  let context = "--";
  if (usage) {
    const cache = usage.cache_read_tokens > 0 ? ` R${formatTokens(usage.cache_read_tokens)}` : "";
    tokens = `↑${formatTokens(usage.input_tokens)}${cache} ↓${formatTokens(usage.output_tokens)}`;
    context = formatTokens(usage.total_tokens);
  }
  const messages =
    (snapshot && Array.isArray(snapshot.messages) ? snapshot.messages.length : undefined) ??
    summary.visible_message_count ??
    0;
  const rt = (snapshot && snapshot.response_timing) || {};
  return {
    model: meta.model || summary.model || "--",
    backend: meta.backend || summary.backend || "--",
    messages,
    run: active ? "running" : "idle",
    active,
    startedAt: active && activeRun ? activeRun.started_at_epoch_ms : null,
    lastResponseMs: rt.last_response_duration_ms ?? null,
    tokens,
    context,
  };
}
