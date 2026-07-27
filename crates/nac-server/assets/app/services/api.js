// Thin API client for the nac-web backend. Normally the app is served by
// nac-web itself, so it talks to the same origin (works on any bind port).
// Only the buildless static preview (python server on :8001) targets the live
// API on :3210 cross-origin, which nac-web's permissive CORS allows.
export const API_BASE =
  window.location.port === "8001" ? "http://127.0.0.1:3210" : "";

async function request(method, path, body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: body != null ? { "Content-Type": "application/json" } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch (_) {}
    throw new Error(`HTTP ${res.status} ${method} ${path}${detail ? ` — ${detail}` : ""}`);
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

export const api = {
  base: API_BASE,
  get: (p) => request("GET", p),
  post: (p, b) => request("POST", p, b),
  put: (p, b) => request("PUT", p, b),
  patch: (p, b) => request("PATCH", p, b),
  del: (p) => request("DELETE", p),

  // ---- endpoints (mirrors docs/01 audit) ----
  getStore: () => request("GET", "/store"),
  listSessions: (workspaceStats = false) =>
    request("GET", "/sessions" + (workspaceStats ? "?workspace_stats=true" : "")),
  getSession: (id) => request("GET", `/sessions/${encodeURIComponent(id)}`),
  createSession: (payload) => request("POST", "/sessions", payload),
  launchDefaults: (location) => request("POST", "/sessions/launch-defaults", location),
  deleteSession: (id) => request("DELETE", `/sessions/${encodeURIComponent(id)}`),
  reorderSessions: (payload) => request("PUT", "/sessions/order", payload),
  renameSession: (id, payload) =>
    request("PUT", `/sessions/${encodeURIComponent(id)}/presentation`, payload),
  updateConfig: (id, payload) =>
    request("PATCH", `/sessions/${encodeURIComponent(id)}/config`, payload),
  submitRun: (id, payload) =>
    request("POST", `/sessions/${encodeURIComponent(id)}/runs`, payload),
  cancelActiveRun: (id) =>
    request("POST", `/sessions/${encodeURIComponent(id)}/cancel-active-run`),
  getWorkspaceDiff: (id, path, { stage, context } = {}) => {
    const qs = new URLSearchParams({ path });
    if (stage) qs.set("stage", stage);
    if (context != null) qs.set("context", String(context));
    return request("GET", `/sessions/${encodeURIComponent(id)}/workspace/diff?${qs.toString()}`);
  },
  eventStreamUrl: (id) =>
    API_BASE + `/sessions/${encodeURIComponent(id)}/events/stream`,
};
