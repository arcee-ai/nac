const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  continuationDiagnostics,
} = require("../e2e/continuation-diagnostics.cjs");

test("failure diagnostics classify counts without logging content or identity", async () => {
  const locator = {
    evaluateAll: async () => ({ count: 2, visible: 2, turns: 1, outside: 0 }),
  };
  const api = async (url) =>
    url.endsWith("/questions")
      ? [{ continuation_state: "delivered", secret: "hidden" }]
      : {
          metadata: {},
          response_timing: {},
          sessions: [],
          session_event_boundary: {},
          workspace: {},
          messages: [{ role: "assistant", content: "answer" }],
          message_page: { start: 0, end: 1, has_older: false, total: 1 },
          active_run: null,
        };
  const result = await continuationDiagnostics(
    locator,
    "http://127.0.0.1",
    "secret-id",
    "answer",
    async (url, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, json: async () => api(url) };
    },
  );
  assert.deepEqual(result, {
    dom_count: "multiple",
    visible_count: "multiple",
    turn_count: "one",
    outside_turn_count: "zero",
    pending_predecessor: "unknown",
    stored_assistant_count: "one",
    continuation: "delivered",
    active_run: "absent",
  });
  assert.doesNotMatch(JSON.stringify(result), /answer|secret/);
});

test("incomplete evidence and errors stay unknown", async () => {
  const result = await continuationDiagnostics(
    {
      evaluateAll: async () => {
        throw Error("private");
      },
    },
    "http://127.0.0.1",
    "id",
    "answer",
    async () => ({
      ok: true,
      json: async () => ({
        messages: [],
        message_page: { start: 1, has_older: true, total: 2 },
      }),
    }),
  );
  assert.equal(result.dom_count, "unknown");
  assert.equal(result.stored_assistant_count, "unknown");
  assert.equal(result.continuation, "unknown");
  assert.equal(result.active_run, "unknown");
});

test("stalled DOM evidence times out without treating it as absent", async () => {
  const started = Date.now();
  const result = await continuationDiagnostics(
    { evaluateAll: () => new Promise(() => {}) },
    "http://127.0.0.1",
    "id",
    "answer",
    async () => ({ ok: false }),
  );
  assert.equal(result.dom_count, "unknown");
  assert.ok(Date.now() - started < 5000);
});

test("a stalled diagnostic GET receives an abort", async () => {
  let aborted = false;
  const result = await continuationDiagnostics(
    {
      evaluateAll: async () => ({ count: 0, visible: 0, turns: 0, outside: 0 }),
    },
    "http://127.0.0.1",
    "id",
    "answer",
    async (url, { signal }) => {
      if (url.endsWith("/questions")) return { ok: false };
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
    },
  );
  assert.equal(result.stored_assistant_count, "unknown");
  if (!aborted) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(aborted, true);
});

test("unpaged full snapshot and omitted active run follow the API contract", async () => {
  const snapshot = {
    metadata: {},
    response_timing: {},
    sessions: [],
    session_event_boundary: {},
    workspace: {},
    messages: [{ role: "assistant", content: "answer" }],
  };
  const observe = async (value) =>
    continuationDiagnostics(
      {
        evaluateAll: async () => ({
          count: 1,
          visible: 1,
          turns: 1,
          outside: 0,
        }),
      },
      "http://127.0.0.1",
      "id",
      "answer",
      async (url) => ({
        ok: true,
        json: async () => (url.endsWith("/questions") ? [] : value),
      }),
    );
  assert.equal((await observe(snapshot)).stored_assistant_count, "one");
  assert.equal((await observe(snapshot)).active_run, "absent");
  assert.equal(
    (
      await observe({
        ...snapshot,
        active_run: {
          run_id: "private",
          prompt_preview: "private",
          started_at_epoch_ms: 1,
        },
      })
    ).active_run,
    "present",
  );
  for (const page of [
    null,
    {},
    { start: 0, end: 1, total: 2, has_older: false },
    { start: 1, end: 2, total: 2, has_older: true },
  ]) {
    assert.equal(
      (await observe({ ...snapshot, message_page: page }))
        .stored_assistant_count,
      "unknown",
    );
  }
  for (const messages of [
    [null],
    [{ role: "assistant", content: 42 }],
    [{ role: "unknown", content: "answer" }],
  ]) {
    assert.equal(
      (await observe({ ...snapshot, messages })).stored_assistant_count,
      "unknown",
    );
  }
  assert.equal(
    (
      await observe({
        ...snapshot,
        messages: [
          { role: "assistant", content: null },
          { role: "tool", content: [], tool_call_id: "private" },
        ],
      })
    ).stored_assistant_count,
    "zero",
  );
  assert.equal((await observe({ messages: [] })).active_run, "unknown");
  assert.equal(
    (await observe({ ...snapshot, active_run: "bad" })).active_run,
    "unknown",
  );
  assert.equal(
    (await observe({ ...snapshot, active_run: {} })).active_run,
    "unknown",
  );
});


test("adjacent pending prompt evidence is bounded and value-free", async () => {
  const previous = { previousElementSibling: null, hasAttribute: () => true,
    classList: { contains: (value) => value === "group/prompt" }, querySelector: () => ({}) };
  const turn = { previousElementSibling: previous };
  const element = { closest: () => turn, getBoundingClientRect: () => ({ width: 1, height: 1 }) };
  global.getComputedStyle = () => ({ visibility: "visible", display: "block" });
  try {
    const result = await continuationDiagnostics({ evaluateAll: async (callback) => callback([element]) },
      "http://127.0.0.1", "id", "answer", async () => ({ ok: false }));
    assert.equal(result.pending_predecessor, "observed");
    previous.querySelector = () => null;
    const settled = await continuationDiagnostics({ evaluateAll: async (callback) => callback([element]) },
      "http://127.0.0.1", "id", "answer", async () => ({ ok: false }));
    assert.equal(settled.pending_predecessor, "not_observed");
    previous.querySelector = () => ({});
    const divider = { previousElementSibling: previous, hasAttribute: () => false,
      getAttribute: (name) => name === "role" ? "separator" : null,
      children: Array.from({ length: 3 }, () => ({ tagName: "SPAN", getAttribute: () => "true" })) };
    turn.previousElementSibling = divider;
    const acrossDivider = await continuationDiagnostics({ evaluateAll: async (callback) => callback([element]) },
      "http://127.0.0.1", "id", "answer", async () => ({ ok: false }));
    assert.equal(acrossDivider.pending_predecessor, "observed");
    turn.previousElementSibling = { previousElementSibling: previous, hasAttribute: () => false, getAttribute: () => null, children: [] };
    const unknown = await continuationDiagnostics({ evaluateAll: async (callback) => callback([element]) },
      "http://127.0.0.1", "id", "answer", async () => ({ ok: false }));
    assert.equal(unknown.pending_predecessor, "unknown");
  } finally { delete global.getComputedStyle; }
});
