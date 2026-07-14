// Presentation helpers ported from app.js (card view model + metrics bar).

export function shortId(id) {
  return (id || "").slice(0, 8);
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
  return {
    model: meta.model || summary.model || "--",
    backend: meta.backend || summary.backend || "--",
    messages,
    run: active ? "running" : "idle",
    active,
    tokens,
    context,
  };
}
