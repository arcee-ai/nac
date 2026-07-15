const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

const appSource = readFileSync(require.resolve("./app.js"), "utf8");
const indexSource = readFileSync(require.resolve("./index.html"), "utf8");
const context = {
  document: { addEventListener() {} },
  window: {},
  module: { exports: {} },
};

vm.runInNewContext(
  `${appSource}\nmodule.exports = {
    state, sessionStatus, buildThreadModels, buildThreadActions,
    buildRetainedThreadActions, buildOrchestratorActions,
    buildPersistedOrchestratorActions, renderActionRows, formatToolArguments,
    compactActionDetail, renderThreadEpisodes, displaySessionTitle, shortId,
    basename, shortModel, formatNumber, messageText, backendOptions,
    effortOptions, escapeHtml,
  };`,
  context,
  { filename: "app.js" },
);

const ui = context.module.exports;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function agentEnvelope(sequenceId, event) {
  return { sequence_id: sequenceId, event: { type: "agent", event } };
}

function occurrences(value, pattern) {
  return (value.match(pattern) || []).length;
}

test("production markup exposes the redesigned single-canvas controls", () => {
  for (const id of [
    "sessionPicker",
    "sessionWorkspace",
    "generatedOverview",
    "orchestratorLedger",
    "threadGrid",
    "commandComposer",
    "promptInput",
    "sendPrompt",
    "focusPanel",
  ]) {
    assert.match(indexSource, new RegExp(`id="${id}"`));
  }
  assert.match(indexSource, /Message the orchestrator · \/ for commands/);
  assert.doesNotMatch(indexSource, /data-tab=/);
  assert.doesNotMatch(indexSource, /id="eventLog"/);
  assert.doesNotMatch(indexSource, /id="sessionSearch"/);
  assert.doesNotMatch(indexSource, /id="toast"/);
});

test("launch backend selector exposes explicit Arcee modes only", () => {
  const select = indexSource.match(/<select id="launchBackend"[\s\S]*?<\/select>/)[0];
  assert.match(select, /value="arcee-auth">arcee-auth</);
  assert.match(select, /value="arcee-api">arcee-api</);
  assert.doesNotMatch(select, /value="arcee"/);
  assert.doesNotMatch(select, /value="auto"/);
});

test("thread tiles group live work first and order finished work by recency", () => {
  const snapshot = {
    active_threads: ["queued", "running"],
    threads: [
      { name: "finished-old", updated_at: "2026-01-01T00:00:00Z" },
      { name: "queued", updated_at: "2026-01-04T00:00:00Z" },
      { name: "finished-new", updated_at: "2026-01-03T00:00:00Z" },
      { name: "running", updated_at: "2026-01-02T00:00:00Z" },
    ],
    thread_episodes: {},
    thread_steering: [],
    thread_events: {
      running: [{ type: "thread_started", name: "running", action: "work" }],
      "finished-old": [
        { type: "thread_started", name: "finished-old", action: "work" },
        { type: "thread_finished", name: "finished-old", exit_code: 0, timed_out: false },
      ],
      "finished-new": [
        { type: "thread_started", name: "finished-new", action: "work" },
        { type: "thread_finished", name: "finished-new", exit_code: 0, timed_out: false },
      ],
    },
  };

  assert.deepEqual(
    plain(ui.buildThreadModels(snapshot).map(({ name, state }) => ({ name, state }))),
    [
      { name: "running", state: "running" },
      { name: "queued", state: "queued" },
      { name: "finished-new", state: "finished" },
      { name: "finished-old", state: "finished" },
    ],
  );
});

test("a persisted exit wins over active membership when restoring thread state", () => {
  const models = ui.buildThreadModels({
    active_threads: ["worker"],
    threads: [{ name: "worker", updated_at: "2026-01-01T00:00:00Z" }],
    thread_episodes: {},
    thread_steering: [],
    thread_events: {
      worker: [
        { type: "thread_started", name: "worker", action: "work" },
        { type: "thread_finished", name: "worker", exit_code: 0, timed_out: false },
      ],
    },
  });
  assert.equal(models[0].state, "finished");
});

test("thread action ledger renders tool arguments and responses without model rows", () => {
  const events = [
    agentEnvelope(1, { type: "model_call_started", thread_name: "worker", iteration: 1 }),
    agentEnvelope(2, {
      type: "tool_call_started",
      thread_name: "worker",
      call_id: "call-1",
      name: "mcp__exa_web_search__web_fetch_exa",
      args_detail: JSON.stringify({ maxCharacters: 6000, urls: ["https://example.com"] }),
    }),
    agentEnvelope(3, {
      type: "tool_call_finished",
      thread_name: "worker",
      call_id: "call-1",
      name: "mcp__exa_web_search__web_fetch_exa",
      is_error: false,
    }),
    agentEnvelope(4, { type: "assistant_message", thread_name: "worker", content: "Verified result" }),
    agentEnvelope(5, { type: "thread_finished", name: "worker", exit_code: 0, timed_out: false }),
  ];
  const snapshot = {
    thread_episodes: { worker: [{ action: "Research", content: "Full retained episode" }] },
    thread_steering: [],
  };

  const actions = ui.buildThreadActions("worker", events, snapshot);
  assert.deepEqual(plain(actions.map(({ name, result }) => ({ name, result }))), [
    { name: "mcp__exa_web_search__web_fetch_exa", result: "done" },
    { name: "response", result: "returned" },
    { name: "thread", result: "returned" },
  ]);
  assert.match(actions[0].detail, /maxCharacters: 6000/);
  assert.match(actions[2].detail, /Full retained episode/);
});

test("retained thread actions recover dispatch and episode content", () => {
  const actions = ui.buildRetainedThreadActions(
    "worker",
    { latest_action: "Inspect the database" },
    {
      thread_episodes: {
        worker: [
          { content: "First response" },
          { content: "Latest response" },
        ],
      },
    },
  );
  assert.deepEqual(plain(actions.map(({ name, result }) => ({ name, result }))), [
    { name: "dispatch", result: "recorded" },
    { name: "response", result: "retained" },
    { name: "response", result: "retained" },
    { name: "thread", result: "returned" },
  ]);
  assert.equal(actions.at(-1).detail, "Latest response");
});

test("tile ledgers render exactly the five most recent actions", () => {
  const actions = Array.from({ length: 7 }, (_, index) => ({
    name: `action-${index + 1}`,
    result: "done",
    state: "done",
    detail: `<detail-${index + 1}>`,
  }));
  const html = ui.renderActionRows(actions, "empty");
  assert.equal(occurrences(html, /class="action-row/g), 5);
  assert.doesNotMatch(html, /action-1|action-2/);
  assert.match(html, /action-3/);
  assert.match(html, /&lt;detail-7&gt;/);
});

test("empty tile ledgers retain five rows and one quiet status message", () => {
  const html = ui.renderActionRows([], "Awaiting first action");
  assert.equal(occurrences(html, /class="action-row/g), 5);
  assert.equal(occurrences(html, /Awaiting first action/g), 1);
});

test("tool argument formatting prioritizes useful fields and stays bounded", () => {
  const detail = ui.formatToolArguments(
    JSON.stringify({ limit: 5, workdir: "/repo", query: "needle", cmd: "rg needle" }),
    "",
  );
  assert.ok(detail.indexOf("cmd: rg needle") < detail.indexOf("query: needle"));
  assert.ok(detail.indexOf("query: needle") < detail.indexOf("workdir: /repo"));
  assert.equal(ui.compactActionDetail("  a\n b   c "), "a b c");
  const bounded = ui.compactActionDetail("x".repeat(400), 20);
  assert.equal(bounded.length, 20);
  assert.match(bounded, /…$/);
});

test("orchestrator actions restore persisted calls and cap the live ledger", () => {
  ui.state.currentId = "session";
  ui.state.events.set("session", []);
  const persisted = ui.buildOrchestratorActions({
    thread_steering: [],
    messages: [
      {
        role: "assistant",
        tool_calls: [{ id: "1", function: { name: "thread", arguments: JSON.stringify({ name: "worker", action: "Inspect" }) } }],
      },
      { role: "tool", tool_call_id: "1", content: "done" },
      { role: "assistant", content: "Completed" },
    ],
  });
  assert.deepEqual(plain(persisted.map(({ name, result }) => ({ name, result }))), [
    { name: "thread", result: "done" },
    { name: "response", result: "sent" },
  ]);

  ui.state.events.set(
    "session",
    Array.from({ length: 8 }, (_, index) => ({
      sequence_id: index + 1,
      event: { type: "run_started", prompt_preview: `prompt-${index + 1}` },
    })),
  );
  const live = ui.buildOrchestratorActions({ thread_steering: [], messages: [] });
  assert.equal(live.length, 5);
  assert.equal(live[0].detail, "prompt-4");
  assert.equal(live.at(-1).detail, "prompt-8");
});

test("thread fullscreen episodes number locally, collapse individually, and retain prompts", () => {
  const html = ui.renderThreadEpisodes([
    { id: 41, action: "Inspect <schema> fully", content: "First response" },
    { id: 99, action: "Verify migration", content: "Second response" },
  ]);
  assert.match(html, /Episode 1/);
  assert.match(html, /Episode 2/);
  assert.doesNotMatch(html, /Episode 41|Episode 99/);
  assert.equal(occurrences(html, /<details class="focus-episode"/g), 2);
  assert.equal(occurrences(html, /<details class="focus-episode"[^>]* open/g), 1);
  assert.match(html, /Inspect &lt;schema&gt; fully/);
  assert.match(html, /<span>Prompt<\/span><p>Verify migration<\/p>/);
});

test("session and presentation helpers keep compact UI values stable", () => {
  assert.equal(ui.displaySessionTitle({ title: "  Named session  ", session_id: "abc-def" }), "Named session");
  assert.equal(ui.displaySessionTitle({ title: "", session_id: "abc-def" }), "abc");
  assert.equal(ui.shortId("abc-def"), "abc");
  assert.equal(ui.basename("/repo/project/"), "project");
  assert.equal(ui.shortModel("gpt-5.6-sol"), "gpt-5.6-sol");
  assert.equal(ui.formatNumber(1_234_567), "1.2m");
  assert.equal(ui.formatNumber(12_345), "12k");
  assert.equal(ui.messageText({ reasoning_text: "thinking" }), "thinking");
  assert.equal(ui.sessionStatus({ active_run: {} }), "running");
  assert.equal(ui.sessionStatus({ active_run: null }), "idle");
});

test("selector helpers include supported backends and reasoning levels", () => {
  const backends = ui.backendOptions("arcee-auth");
  assert.match(backends, /value="arcee-auth" selected/);
  assert.match(backends, /value="arcee-api"/);
  assert.doesNotMatch(backends, /value="auto"/);
  const efforts = ui.effortOptions("xhigh");
  assert.match(efforts, /value="xhigh" selected/);
  assert.match(efforts, />default<\/option>/);
});

test("HTML escaping covers action names and user-provided labels", () => {
  assert.equal(
    ui.escapeHtml(`<script data-x="1">'&`),
    "&lt;script data-x=&quot;1&quot;&gt;&#39;&amp;",
  );
});
