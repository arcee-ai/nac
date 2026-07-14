// Thin API client for the nac-web backend. When the page is served from the
// static preview server (any port != 3210) it targets the live API on :3210;
// when served by nac-web itself it uses same-origin. CORS on nac-web is
// permissive, which makes the buildless preview work.
export const API_BASE =
  window.location.port === "3210" ? "" : "http://127.0.0.1:3210";

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
  deleteSession: (id) => request("DELETE", `/sessions/${encodeURIComponent(id)}`),
  reorderSessions: (order) => request("PUT", "/sessions/order", { order }),
  renameSession: (id, payload) =>
    request("PUT", `/sessions/${encodeURIComponent(id)}/presentation`, payload),
  updateConfig: (id, payload) =>
    request("PATCH", `/sessions/${encodeURIComponent(id)}/config`, payload),
  submitRun: (id, payload) =>
    request("POST", `/sessions/${encodeURIComponent(id)}/runs`, payload),
  cancelActiveRun: (id) =>
    request("POST", `/sessions/${encodeURIComponent(id)}/cancel-active-run`),
  getWorkspaceDiff: (id) =>
    request("GET", `/sessions/${encodeURIComponent(id)}/workspace/diff`),
  eventStreamUrl: (id) =>
    API_BASE + `/sessions/${encodeURIComponent(id)}/events/stream`,
};
