// Failure-only CDP evidence. Request IDs and URLs never leave this process.
// This diagnostic does not decide whether a stream is active.
function streamLifecycle() {
  const ids = new Map();
  const events = [];
  let truncated = false;
  function entry(id, kind, detail) {
    let ordinal = ids.get(id);
    if (ordinal === undefined) {
      if (ids.size >= 32) {
        truncated = true;
        return;
      }
      ordinal = ids.size + 1;
      ids.set(id, ordinal);
    }
    if (events.length >= 128) {
      truncated = true;
      return;
    }
    events.push({ request: ordinal, kind, ...(detail ? { detail } : {}) });
  }
  return {
    request: (id) => entry(id, "request"),
    response: (id, type, status) =>
      entry(
        id,
        "response",
        `${type === "EventSource" ? "eventsource" : "other"}:${status === 200 ? "200" : "other"}`,
      ),
    finished: (id) => {
      if (ids.has(id)) entry(id, "finished");
    },
    failed: (id, error) => {
      if (ids.has(id)) entry(id, "failed", error === "net::ERR_ABORTED" ? "aborted" : "other");
    },
    snapshot: (active) => ({
      events: [...events],
      truncated,
      active_count: active.size,
      active_requests: [...active].slice(0, 32).map((id) => ids.get(id) ?? "unknown"),
    }),
  };
}
module.exports = { streamLifecycle };
