const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

const appSource = readFileSync(require.resolve("./app.js"), "utf8");
const indexSource = readFileSync(require.resolve("./index.html"), "utf8");
const redesignSource = readFileSync(require.resolve("./redesign.css"), "utf8");
const context = {
  document: { addEventListener() {} },
  window: {},
  module: { exports: {} },
};

vm.runInNewContext(
  `${appSource}\nmodule.exports = {
    state, sessionStatus, syncSessionRunIndicators, noteSessionRunEvent,
    clearSessionAttention, buildThreadModels, buildThreadActions,
    buildRetainedThreadActions, buildOrchestratorActions,
    buildPersistedOrchestratorActions, renderActionRows, formatToolArguments,
    compactActionDetail, renderThreadEpisodes, renderThreadTile, renderFocusMessage,
    renderOrchestratorConversation, renderSessionCard, mergeSnapshotMessageWindow, prependMessageWindow,
    threadFocusActions, threadEventAction,
    currentCycleThreadNames, threadCycleSeed, displaySessionTitle, shortId,
    basename, shortModel, formatNumber, formatTokenCount, messageText, backendOptions,
    displayedTokenUsage, usageRunId, orchestratorContextTokens,
    tokenUsageSummary, tokenUsageTitle,
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
  assert.match(indexSource, /<dt>Orch context<\/dt>/);
});

test("launch backend selector exposes explicit Arcee modes only", () => {
  const select = indexSource.match(/<select id="launchBackend"[\s\S]*?<\/select>/)[0];
  assert.match(select, /value="arcee-auth">arcee-auth</);
  assert.match(select, /value="arcee-api">arcee-api</);
  assert.doesNotMatch(select, /value="arcee"/);
  assert.doesNotMatch(select, /value="auto"/);
});

test("finished orchestrator runs latch attention until the session is opened", () => {
  ui.state.attentionSessions.clear();
  ui.state.sessionRunActivity.clear();
  const idle = { summary: { session_id: "attention-session" }, active_run: null };

  ui.syncSessionRunIndicators([idle]);
  assert.equal(ui.sessionStatus(idle), "idle");

  const running = { ...idle, active_run: { run_id: "run-1" } };
  ui.syncSessionRunIndicators([running]);
  assert.equal(ui.sessionStatus(running), "running");

  ui.syncSessionRunIndicators([idle]);
  assert.equal(ui.sessionStatus(idle), "attention");

  ui.clearSessionAttention("attention-session");
  assert.equal(ui.sessionStatus(idle), "idle");

  ui.noteSessionRunEvent("attention-session", "run_started");
  ui.noteSessionRunEvent("attention-session", "run_completed");
  assert.equal(ui.sessionStatus(idle), "attention");
});

test("session cards use a no-wrap telemetry grid and blue completion indicator", () => {
  assert.match(redesignSource, /--attention: #6ea8ff/);
  assert.match(redesignSource, /\.status-dot\.attention \{[^}]*var\(--attention\)/);
  assert.match(redesignSource, /\.card-metrics \{[^}]*grid-template-columns: minmax\(0, 1fr\) max-content max-content/);
  assert.match(redesignSource, /\.card-metrics span \{[^}]*white-space: nowrap/);
});

test("session reordering uses pointer capture with touch targets and keyboard grab mode", () => {
  const card = ui.renderSessionCard({
    summary: {
      session_id: "session-one",
      title: "One",
      cwd: "/repo",
      model: "model",
      pinned: false,
      presentation_version: 1,
    },
  }, 1, [{}, {}, {}]);
  assert.doesNotMatch(card, /draggable="true"/);
  assert.match(card, /aria-label="Reorder One; position 2 of 3"/);
  assert.equal(occurrences(card, /<circle /g), 6);
  assert.match(appSource, /addEventListener\("pointerdown", handleSessionPointerDown\)/);
  assert.match(appSource, /setPointerCapture\(event\.pointerId\)/);
  assert.match(appSource, /\["Enter", " "\]\.includes\(event\.key\)/);
  assert.match(redesignSource, /@media \(pointer: coarse\)/);
  assert.match(redesignSource, /\.card-control \{ width: 40px; height: 40px; \}/);
});

test("orchestrator tool-call messages render blocks without a duplicate name summary", () => {
  const html = ui.renderFocusMessage({
    role: "assistant",
    content: "",
    tool_calls: [
      { function: { name: "thread_delete", arguments: '{"name":"ops/one"}' } },
      { function: { name: "thread_delete", arguments: '{"name":"ops/two"}' } },
    ],
  });
  assert.equal(occurrences(html, /class="focus-tool-call"/g), 2);
  assert.equal(occurrences(html, />thread_delete</g), 2);
  assert.doesNotMatch(html, /thread_delete, thread_delete/);
  assert.doesNotMatch(html, /focus-message-copy/);
});

test("orchestrator message windows preserve loaded history across fresh tail snapshots", () => {
  ui.state.messageWindows.clear();
  const first = {
    messages: [6, 7, 8, 9].map((value) => ({ role: "assistant", content: String(value) })),
    message_page: { start: 6, end: 10, total: 10, has_older: true },
  };
  ui.mergeSnapshotMessageWindow("paged-session", first);

  const refreshed = {
    messages: [8, 9, 10, 11].map((value) => ({ role: "assistant", content: String(value) })),
    message_page: { start: 8, end: 12, total: 12, has_older: true },
  };
  ui.mergeSnapshotMessageWindow("paged-session", refreshed);
  assert.deepEqual(plain(refreshed.messages.map((message) => message.content)), ["6", "7", "8", "9", "10", "11"]);
  assert.equal(refreshed.message_page.start, 6);

  assert.equal(ui.prependMessageWindow("paged-session", refreshed, {
    messages: [2, 3, 4, 5].map((value) => ({ role: "assistant", content: String(value) })),
    page: { start: 2, end: 6, total: 12, has_older: true },
  }), true);
  assert.deepEqual(plain(refreshed.messages.map((message) => message.content)), ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
  assert.equal(refreshed.message_page.start, 2);
});

test("orchestrator conversation exposes a top-edge history loader only when older pages exist", () => {
  ui.state.currentId = "loader-session";
  ui.state.messageWindows.set("loader-session", {
    start: 24, end: 48, total: 80, hasOlder: true, loading: false, messages: [],
  });
  const html = ui.renderOrchestratorConversation({ messages: [], active_run: null, worksets: { items: [] } });
  assert.match(html, /data-history-loader/);
  assert.match(html, /scroll up for earlier messages/);

  ui.state.messageWindows.set("loader-session", {
    start: 0, end: 48, total: 48, hasOlder: false, loading: false, messages: [],
  });
  assert.doesNotMatch(
    ui.renderOrchestratorConversation({ messages: [], active_run: null, worksets: { items: [] } }),
    /data-history-loader/,
  );
});

test("server-provided cycle metadata keeps current threads visible with a paginated transcript", () => {
  const seed = ui.threadCycleSeed({
    messages: [{ role: "assistant", content: "recent tail without its user message" }],
    message_cycle: { marker: "history:9:44", thread_names: ["current/a", "current/b"] },
    active_threads: ["current/live"],
  });
  assert.equal(seed.marker, "history:9:44");
  assert.deepEqual([...seed.names].sort(), ["current/a", "current/b", "current/live"]);
});

test("thread fullscreen activity is newest-first with failures in event order", () => {
  ui.state.currentId = "thread-order";
  ui.state.events.set("thread-order", [
    agentEnvelope(41, { type: "thread_steering_expired", name: "worker", steering_id: 9, instruction_preview: "too late" }),
    agentEnvelope(42, { type: "error", thread_name: "worker", message: "worker failed" }),
  ]);
  const actions = ui.threadFocusActions("worker", { thread_episodes: {} }, {
    afterSequence: 40,
    events: [
      { id: 12, event: { type: "tool_call_finished", thread_name: "worker", name: "read", is_error: true, content_preview: "missing" } },
      { id: 11, event: { type: "thread_steering_queued", name: "worker", steering_id: 9, instruction_preview: "too late" } },
    ],
  });
  assert.deepEqual(
    plain(actions.map(({ name, result, detail }) => ({ name, result, detail }))),
    [
      { name: "error", result: "failed", detail: "worker failed" },
      { name: "steering", result: "expired", detail: "too late" },
      { name: "read", result: "failed", detail: "missing" },
      { name: "steering", result: "queued", detail: "too late" },
    ],
  );
  ui.state.events.delete("thread-order");
  ui.state.currentId = null;
});

test("durable steering fallback does not accumulate after chronological events", () => {
  const snapshot = {
    thread_episodes: {},
    thread_steering: [
      { id: 1, thread_name: "worker", status: "expired", instruction: "stale one" },
      { id: 2, thread_name: "worker", status: "expired", instruction: "stale two" },
    ],
  };
  const actions = ui.buildThreadActions("worker", [
    agentEnvelope(8, { type: "error", thread_name: "worker", message: "ordered failure" }),
  ], snapshot);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].detail, "ordered failure");
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
    plain(ui.buildThreadModels(snapshot).map(({ name, state, compact }) => ({ name, state, compact }))),
    [
      { name: "running", state: "running", compact: false },
      { name: "queued", state: "queued", compact: false },
      { name: "finished-new", state: "finished", compact: true },
      { name: "finished-old", state: "finished", compact: true },
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
  assert.equal(models[0].compact, false);
});

test("finished dispatches after the latest user turn remain full tiles", () => {
  ui.state.currentId = "cycle-dispatch";
  ui.state.threadCycles.clear();
  const models = ui.buildThreadModels({
    metadata: { session_id: "cycle-dispatch" },
    active_threads: [],
    threads: [
      { name: "current", updated_at: "2026-01-02T00:00:00Z" },
      { name: "earlier", updated_at: "2026-01-01T00:00:00Z" },
    ],
    thread_episodes: {},
    thread_steering: [],
    thread_events: {},
    messages: [
      { role: "user", content: "older request" },
      { role: "assistant", tool_calls: [{ function: { name: "thread", arguments: JSON.stringify({ name: "earlier" }) } }] },
      { role: "user", content: "current request" },
      { role: "assistant", tool_calls: [{ function: { name: "thread", arguments: JSON.stringify({ name: "current" }) } }] },
    ],
  });
  assert.deepEqual(
    plain(models.map(({ name, compact }) => ({ name, compact }))),
    [
      { name: "current", compact: false },
      { name: "earlier", compact: true },
    ],
  );
});

test("activation enrolls a thread for the remainder of its current cycle", () => {
  ui.state.currentId = "cycle-activation";
  ui.state.threadCycles.clear();
  const base = {
    metadata: { session_id: "cycle-activation" },
    threads: [{ name: "resumed", updated_at: "2026-01-01T00:00:00Z" }],
    thread_episodes: {},
    thread_steering: [],
    messages: [{ role: "user", content: "current request" }],
  };
  const active = ui.buildThreadModels({ ...base, active_threads: ["resumed"], thread_events: {} });
  assert.equal(active[0].compact, false);

  const finished = ui.buildThreadModels({
    ...base,
    active_threads: [],
    thread_events: {
      resumed: [
        { type: "thread_started", name: "resumed", action: "resume" },
        { type: "thread_finished", name: "resumed", exit_code: 0, timed_out: false },
      ],
    },
  });
  assert.equal(finished[0].state, "finished");
  assert.equal(finished[0].compact, false);

  const nextCycle = ui.buildThreadModels({
    ...base,
    active_threads: [],
    thread_events: {},
    messages: [
      { role: "user", content: "current request" },
      { role: "user", content: "next request" },
    ],
  });
  assert.equal(nextCycle[0].compact, true);
});

test("compact thread strips contain only the title bar and fullscreen affordance", () => {
  const compact = ui.renderThreadTile({
    name: "ancient/thread",
    state: "finished",
    compact: true,
    actions: [{ name: "read", result: "done", state: "done" }],
  });
  assert.match(compact, /thread-tile is-compact/);
  assert.match(compact, /ancient\/thread/);
  assert.match(compact, /data-focus-thread="ancient\/thread"/);
  assert.match(compact, /class="thread-state" aria-label="finished"><\/span>/);
  assert.doesNotMatch(compact, /action-ledger|action-name/);
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
  assert.equal(ui.formatTokenCount(0), "0");
  assert.equal(ui.messageText({ reasoning_text: "thinking" }), "thinking");
  assert.equal(ui.sessionStatus({ active_run: {} }), "running");
  assert.equal(ui.sessionStatus({ active_run: null }), "idle");
});

test("session telemetry preserves old UI token semantics and folds live model-call deltas", () => {
  const snapshot = {
    active_run: { run_id: "run-live" },
    response_timing: {
      cumulative_token_usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_tokens: 40,
        cache_write_tokens: 5,
        reasoning_tokens: 7,
        total_tokens: 500,
      },
    },
  };
  const events = [
    { run_id: "older-run", event: { type: "agent", event: {
      type: "token_usage_updated", thread_name: null,
      usage: { input_tokens: 999, output_tokens: 999, cache_read_tokens: 999, total_tokens: 999 },
    } } },
    { run_id: "run-live", event: { type: "agent", event: {
      type: "token_usage_updated", thread_name: null,
      usage: { input_tokens: 10, output_tokens: 2, cache_read_tokens: 3, cache_write_tokens: 1, reasoning_tokens: 1, total_tokens: 600 },
    } } },
    { run_id: "run-live", event: { type: "agent", event: {
      type: "token_usage_updated", thread_name: "research/ui",
      usage: { input_tokens: 20, output_tokens: 4, cache_read_tokens: 8, cache_write_tokens: 2, reasoning_tokens: 2, total_tokens: 240 },
    } } },
    { run_id: "run-live", event: { type: "agent", event: {
      type: "token_usage_updated", thread_name: null,
      usage: { input_tokens: 30, output_tokens: 6, cache_read_tokens: 12, cache_write_tokens: 3, reasoning_tokens: 3, total_tokens: 700 },
    } } },
  ];

  const usage = ui.displayedTokenUsage(snapshot, "session", events);
  assert.deepEqual(plain(usage), {
    input_tokens: 160,
    output_tokens: 32,
    cache_read_tokens: 63,
    cache_write_tokens: 11,
    reasoning_tokens: 13,
    total_tokens: 700,
  });
  assert.equal(ui.orchestratorContextTokens(usage), 700);
  assert.equal(ui.tokenUsageSummary(usage), "↑160 R63 ↓32");
  assert.equal(ui.tokenUsageTitle(usage), "input 160 · cache read 63 · output 32");
});

test("completed replay events do not double-count persisted token usage", () => {
  const snapshot = {
    active_run: null,
    response_timing: {
      cumulative_token_usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_tokens: 40,
        total_tokens: 500,
      },
    },
  };
  const events = [
    { run_id: "run-done", event: { type: "run_started" } },
    { run_id: "run-done", event: { type: "agent", event: {
      type: "token_usage_updated", thread_name: null,
      usage: { input_tokens: 10, output_tokens: 2, cache_read_tokens: 3, total_tokens: 600 },
    } } },
    { run_id: "run-done", event: { type: "run_completed" } },
  ];

  assert.equal(ui.usageRunId(snapshot, events), null);
  assert.deepEqual(plain(ui.displayedTokenUsage(snapshot, "session", events)), {
    input_tokens: 100,
    output_tokens: 20,
    cache_read_tokens: 40,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 500,
  });
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
