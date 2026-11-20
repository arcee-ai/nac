// Failure-only, value-free evidence. These observations never decide the test result.
const category = (n) => (n === 0 ? "zero" : n === 1 ? "one" : "multiple");
const bounded = (task) =>
  Promise.race([
    Promise.resolve()
      .then(task)
      .catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
  ]);

async function continuationDiagnostics(
  locator,
  endpoint,
  session,
  answer,
  fetchImpl = fetch,
) {
  // These sequential observations can describe different instants.
  const read = async (route) => {
    const response = await fetchImpl(endpoint + route, {
      headers: { "content-type": "application/json", origin: endpoint },
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    return response.json();
  };
  const dom = await bounded(() =>
    locator.evaluateAll((elements) => {
      const turns = elements.map((element) => element.closest("[data-turn]"));
      // Inspect only the adjacent rendered turn; no content or identity leaves the page.
      const pendingPredecessors = turns.map((turn) => {
        if (!turn) return null;
        let previous = turn.previousElementSibling;
        // Day dividers can sit between turns. Bound the scan and classify anything
        // else as unknown rather than inferring that a pending prompt is absent.
        for (let i = 0; previous && i < 4; i++, previous = previous.previousElementSibling) {
          if (!previous.hasAttribute("data-turn")) {
            const divider = previous.getAttribute("role") === "separator" &&
              previous.children.length === 3 &&
              Array.from(previous.children).every((child) => child.tagName === "SPAN" && child.getAttribute("aria-hidden") === "true");
            if (divider) continue;
            return null;
          }
          if (!previous.classList.contains("group/prompt")) return false;
          return Boolean(previous.querySelector(".opacity-60"));
        }
        return null;
      });
      return {
        count: elements.length,
        visible: elements.filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            rect.width > 0 &&
            rect.height > 0
          );
        }).length,
        outside: turns.filter((turn) => !turn).length,
        turns: new Set(turns.filter(Boolean)).size,
        pendingPredecessors: pendingPredecessors.some((value) => value === true)
          ? "observed"
          : pendingPredecessors.length && pendingPredecessors.every((value) => value === false)
            ? "not_observed" : "unknown",
      };
    }),
  );
  const snapshot = await bounded(() => read(`/sessions/${session}`));
  const questions = await bounded(() => read(`/sessions/${session}/questions`));
  const record = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  // Required fields distinguish a successful snapshot from malformed or missing evidence.
  const validSnapshot =
    record(snapshot) &&
    record(snapshot.metadata) &&
    Array.isArray(snapshot.messages) &&
    record(snapshot.response_timing) &&
    Array.isArray(snapshot.sessions) &&
    record(snapshot.session_event_boundary) &&
    record(snapshot.workspace);
  const messages = validSnapshot ? snapshot.messages : null;
  const page = snapshot?.message_page;
  // The unqualified route requests All. An explicitly paged response is complete only
  // if its metadata proves the entire range is included.
  const complete =
    validSnapshot &&
    (!("message_page" in snapshot) ||
      (record(page) &&
        page.start === 0 &&
        page.end === page.total &&
        page.has_older === false &&
        page.total === messages.length));
  const validMessages =
    complete &&
    messages.every((message) => {
      if (!record(message)) return false;
      if (message.role === "assistant")
        return message.content === null || typeof message.content === "string";
      if (message.role === "system" || message.role === "user")
        return typeof message.content === "string";
      if (message.role === "tool")
        return (
          typeof message.tool_call_id === "string" &&
          (typeof message.content === "string" ||
            Array.isArray(message.content))
        );
      return false;
    });
  const count = validMessages
    ? messages.filter(
        (message) =>
          message?.role === "assistant" && message.content === answer,
      ).length
    : null;
  const run = snapshot?.active_run;
  const validRun =
    record(run) &&
    typeof run.run_id === "string" &&
    typeof run.prompt_preview === "string" &&
    Number.isSafeInteger(run.started_at_epoch_ms) &&
    run.started_at_epoch_ms >= 0;
  const state =
    questions?.length === 1 ? questions[0]?.continuation_state : null;
  return {
    dom_count: dom ? category(dom.count) : "unknown",
    visible_count: dom ? category(dom.visible) : "unknown",
    turn_count: dom ? category(dom.turns) : "unknown",
    outside_turn_count: dom ? category(dom.outside) : "unknown",
    pending_predecessor: ["observed", "not_observed"].includes(dom?.pendingPredecessors)
      ? dom.pendingPredecessors : "unknown",
    stored_assistant_count: count === null ? "unknown" : category(count),
    continuation: ["delivered", "pending", "failed"].includes(state)
      ? state
      : "unknown",
    active_run:
      validSnapshot &&
      (snapshot.active_run == null || validRun)
        ? snapshot.active_run == null
          ? "absent"
          : "present"
        : "unknown",
  };
}
module.exports = { continuationDiagnostics };
