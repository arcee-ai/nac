const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { beforeEach, test } = require("node:test");
const vm = require("node:vm");

const appSource = readFileSync(require.resolve("./app.js"), "utf8");
const indexSource = readFileSync(require.resolve("./index.html"), "utf8");
const redesignSource = readFileSync(require.resolve("./redesign.css"), "utf8");

function loadApp(overrides = {}) {
  const document = overrides.document || { addEventListener() {}, hidden: false };
  const requestAnimationFrame = overrides.requestAnimationFrame || ((callback) => callback());
  const window = {
    addEventListener() {},
    clearTimeout,
    setTimeout,
    clearInterval,
    setInterval,
    requestAnimationFrame,
    location: { hash: "", pathname: "/" },
    CSS: { escape: (value) => String(value) },
    ...(overrides.window || {}),
  };
  const context = {
    console,
    document,
    window,
    history: overrides.history || { pushState() {} },
    fetch: overrides.fetch || (async () => { throw new Error("unexpected fetch"); }),
    EventSource: overrides.EventSource || class UnexpectedEventSource {
      constructor() { throw new Error("unexpected EventSource"); }
    },
    FormData: overrides.FormData || globalThis.FormData,
    requestAnimationFrame,
    getComputedStyle: overrides.getComputedStyle || (() => ({ minHeight: "40" })),
    module: { exports: {} },
  };
  vm.runInNewContext(
    `${appSource}\nmodule.exports = {
      state, el, commands, boot, openSession, sessionStatus, syncSessionRunIndicators, noteSessionRunEvent,
      clearSessionAttention, buildThreadModels, buildThreadActions, buildRetainedThreadActions,
      buildOrchestratorActions, orchestratorLifecycle, threadLifecycleFromEvidence,
      threadModelEntries, renderThreadEvidence, renderThreadFocus, threadFocusEvidenceEntries,
      threadActionsFromEntries, renderActionRows, formatToolArguments, compactActionDetail,
      renderThreadEpisodes, renderThreadTile, renderFocusMessage, renderOrchestratorConversation,
      renderSessionCard, sessionExecutionTopology, sessionExecutionLocationPresentation,
      applySessionExecutionLocation, sessionReorderControlLabel, reorderAnnouncement,
      commitSessionReorder, mergeSnapshotMessageWindow, prependMessageWindow,
      workspaceSummaryPresentation, applyWorkspaceSummaryMetric, renderPicker, loadStoreInfo,
      renderSessionInfo, loadSessions, loadSnapshot, loadOlderOrchestratorMessages,
      normalizedSubmittedMessage, pendingMessageCoveredByCanonical, captureAcceptedRun,
      effectiveActiveRun, effectivePendingMessages, reconcileAcceptedRun,
      responseDurationAssignments, runTimingPresentation, updateRuntimeMetric, threadFocusActions,
      threadCycleSeed, displaySessionTitle, shortId, basename, shortModel, formatNumber,
      formatTokenCount, messageText, backendOptions, renderFocusMarkdown, renderMarkdownImageToken,
      displayedTokenUsage, usageRunId, orchestratorContextTokens, tokenUsageSummary,
      tokenUsageTitle, effortOptions, escapeHtml, rawHeadersFromConfig, settingsValuesFromConfig,
      serializeSettingsHeaders, buildSettingsPatch, loadFocusSettings, renderFocusSettings,
      handleDrawerSubmit, scheduleWorkspaceRender, captureFocusTarget, restoreFocusTarget,
      captureFormControlStates, restoreFormControlStates, captureScrollPositions,
      restoreScrollPositions, openFocusView, closeFocusView, renderFocusView, openDrawer,
      closeDrawer, handleDrawerKeydown, renderConfigRepairGuidance, recordSessionEnvelope,
      connectEventStream, worksetsPresentation, renderWorksetRail, renderWorksetsFocus,
      firstWorkspaceDiffPath, invalidateWorkspaceDiffs, renderWorkspaceFocus,
      renderWorkspaceFocusDiff, renderDiffLine, loadFocusWorkspaceDiff, handleFocusClick,
      transitionLaunchCwdDrafts, syncLaunchExecutionFields, buildLaunchDefaultsRequest,
      loadLaunchDefaultsPreview, managedLaunchDefaults, renderLaunchDefaultsPreviewHtml,
      syncLaunchApiKeyMode, buildLaunchSessionRequest, persistComposerDraft, restoreComposerDraft,
      clearComposerDraftIfUnchanged, submitComposer, upsertCreatedSession, createSession,
    };`,
    context, { filename: "app.js" });
  return context.module.exports;
}

let ui;
beforeEach(() => { ui = loadApp(); });

const scenarioGroups = new Map();
function scenario(group, name, run) {
  const rows = scenarioGroups.get(group) || [];
  rows.push([name, run]);
  scenarioGroups.set(group, rows);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function agentEnvelope(sequenceId, event) {
  return { sequence_id: sequenceId, event: { type: "agent", event } };
}

function occurrences(value, pattern) {
  return (value.match(pattern) || []).length;
}

function eventSourceHarness() {
  const instances = [];
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      this.readyState = 0;
      this.listeners = new Map();
      instances.push(this);
    }
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    emit(type, payload) {
      const event = { data: typeof payload === "string" ? payload : JSON.stringify(payload) };
      for (const listener of this.listeners.get(type) || []) listener(event);
    }
    open() {
      this.readyState = 1;
      this.onopen?.();
    }
    error({ closed = false } = {}) {
      this.readyState = closed ? 2 : 0;
      this.onerror?.(new Error("interrupted"));
    }
    close() {
      this.closed = true;
      this.readyState = 2;
    }
  }
  return { FakeEventSource, instances };
}

function jsonResponse(payload = {}) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async text() { return JSON.stringify(payload); },
  };
}

function errorResponse(status, payload = {}) {
  return {
    ok: false,
    status,
    statusText: "Error",
    async text() { return JSON.stringify(payload); },
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeFormData {
  constructor(form) { this.form = form; this.values = form.values || {}; }
  get(name) { return name === "execution_mode" ? this.form.mode : this.values[name] ?? null; }
}

function sessionSnapshot(sessionId, overrides = {}) {
  return { metadata: { session_id: sessionId }, messages: [],
    active_run: null, active_threads: [], threads: [],
    thread_events: {}, thread_episodes: {}, thread_steering: [],
    worksets: { items: [], error: null }, ...overrides, };
}

function launchValues(overrides = {}) {
  return { mode: "local", reasoning_mode: "inherit",
    api_key_mode: "inherit", extra_headers: "", ...overrides, };
}

function workspaceFixture(overrides = {}) {
  return { repo_label: "repo", branch: "main", changed_files: [],
    total_additions: 0, total_deletions: 0, ...overrides, };
}

function persistedConfig(overrides = {}) {
  return { session_id: "settings-session", model: "gpt-5",
    base_url: "https://api.example.test/v1",
    backend: "openai-responses", reasoning_effort: "medium",
    api_key_env: "CUSTOM_API_KEY",
    extra_headers_json: '{"X-Trace":"yes"}', config_version: 1,
    diagnostics: [], ...overrides, };
}

function settingsFormElement(values = {}) {
  const status = fakeElement();
  const submit = { disabled: false };
  const attributes = new Map();
  return { id: "settingsForm", values: { backend: "openai-responses",
      reasoning_effort: "medium", model: "gpt-5",
      base_url: "https://api.example.test/v1",
      api_key_env: "CUSTOM_API_KEY",
      extra_headers: '{\n  "X-Trace": "yes"\n}', ...values, },
    inert: false, querySelector(selector) {
      if (selector === "#settingsStatus") return status;
      if (selector === "[data-settings-submit]") return submit;
      return null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    hasAttribute(name) { return attributes.has(name); }, status,
    submit, };
}

function settingsViewElements(uiInstance) {
  uiInstance.el.sessionLayout = fakeElement();
  uiInstance.el.focusPanel = { ...fakeElement(), hidden: false };
  uiInstance.el.focusTitle = fakeElement();
  uiInstance.el.focusState = fakeElement();
  uiInstance.el.focusContent = { innerHTML: "",
    querySelector() { return null; },
    querySelectorAll() { return []; }, };
}

function fakeElement() {
  const classes = new Set();
  const attributes = new Map();
  return { dataset: {}, classList: {
      contains: (name) => classes.has(name),
      add(...names) { for (const name of names) classes.add(name); },
      remove(...names) { for (const name of names) classes.delete(name); },
      toggle(name, force) {
        if (force === undefined ? !classes.has(name) : force) classes.add(name);
        else classes.delete(name); }, },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    textContent: "", title: "", };
}

test("production shell, mobile access, and privacy exclusions stay compact", () => {
  for (const id of [
    "sessionPicker", "sessionWorkspace", "generatedOverview", "orchestratorLedger", "threadGrid",
    "commandComposer", "promptInput", "sendPrompt", "focusPanel", "metricRun", "worksetRail",
    "expandWorksets", "sessionInfo", "focusTitle", "focusContent",
  ]) assert.match(indexSource, new RegExp(`id="${id}"`));
  for (const forbidden of [
    /Session Events/i, /id="streamHealth/i, /id="eventLog"/i, /data-tab=/i, /id="toast"/i,
  ]) assert.doesNotMatch(indexSource, forbidden);
  assert.doesNotMatch(appSource, /include_system\s*=\s*true|\{\s*name:\s*"activity",\s*description:|openFocusView\(\s*"activity"|renderActivityFocus|renderStreamHealth|streamHealth|streamNotices/i);
  assert.doesNotMatch(redesignSource, /stream-health|focus-activity-scroll/i);
  assert.match(indexSource, /Message the orchestrator · \/ for commands/);
  assert.match(indexSource, /id="focusTitle" tabindex="-1"/);
  assert.doesNotMatch(indexSource, /id="focusContent"[^>]*aria-live/);
  const mobile = redesignSource.match(/@media \(max-width: 780px\) \{[\s\S]*?\n\}/)?.[0] || "";
  const narrow = redesignSource.match(/@media \(max-width: 560px\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(mobile + narrow, /(?:focus-live|focus-activity)[^{]*\{[^}]*display: none/);
  assert.match(mobile, /\.focus-panel\.is-thread \.focus-activity \{[^}]*display: block/);
  assert.ok(ui.commands.some(({ name }) => name === "worksets"));
  assert.ok(!ui.commands.some(({ name }) => name === "activity"));
});

test("session opening renders the workspace and starts snapshot and SSE without removed-surface references", () => {
  const { FakeEventSource, instances } = eventSourceHarness();
  const requests = [];
  const isolated = loadApp({ EventSource: FakeEventSource,
    fetch(path) { requests.push(path); return new Promise(() => {}); }, });
  const element = () => ({ ...fakeElement(), style: {}, value: "", scrollHeight: 40,
    hidden: false, innerHTML: "", querySelector() { return null; }, querySelectorAll() { return []; }, });
  for (const name of [
    "sessionPicker", "sessionWorkspace", "sessionTitle", "renameSession", "sessionLocation",
    "metricModel", "metricContext", "metricTokens", "metricRun", "metricChanges", "stopRun",
    "refreshSession", "generatedOverview", "worksetRailSummary", "worksetRailCount",
    "orchestratorState", "orchestratorLedger", "threadGrid", "composerTarget", "composerTargetName",
    "sendPrompt", "promptInput", "commandMenu", "focusContent", "sessionLayout", "focusPanel", "focusState",
  ]) isolated.el[name] = element();
  isolated.state.sessions = [{ summary: { session_id: "release-session", cwd: "/repo", model: "gpt-5" } }];
  assert.doesNotThrow(() => isolated.openSession("release-session"));
  assert.equal(isolated.el.sessionWorkspace.hidden, false);
  assert.deepEqual(requests, ["/sessions/release-session?message_limit=24&thread_event_limit=24"]);
  assert.equal(instances[0].url, "/sessions/release-session/events/stream?limit=512");
});

scenario("SSE", "SSE resets lower epochs cursor-free and ignores the replaced source", async () => {
  const { FakeEventSource, instances } = eventSourceHarness();
  const requests = [];
  const isolated = loadApp({ EventSource: FakeEventSource,
    fetch: async (path) => { requests.push(path);
      return jsonResponse({ metadata: { session_id: "epoch-session" }, messages: [], active_run: null });
    }, });
  const sessionId = "epoch-session";
  isolated.state.lastSequence.set(sessionId, 900);
  isolated.state.events.set(sessionId, [{ sequence_id: 900, event: { type: "run_completed", response: "old" } }]);
  isolated.state.threadCycles.set(sessionId, { marker: "old", names: new Set(["old-thread"]) });
  isolated.state.threadEventWindows.set(`${sessionId}:old-thread`, { afterSequence: 900, events: [{}] });
  isolated.state.acceptedRuns.set(sessionId, { run_id: "accepted-old" });
  isolated.state.snapshots.set(sessionId, { metadata: { session_id: sessionId }, messages: [], active_run: { run_id: "old" } });
  isolated.state.sessions = [{ summary: { session_id: sessionId }, active_run: { run_id: "old" } }];
  isolated.connectEventStream(sessionId);
  const stale = instances[0];
  assert.match(stale.url, /after_sequence_id=900/);
  stale.emit("replay_boundary", { replay_boundary_sequence_id: 0 });
  assert.equal(stale.closed, true);
  assert.equal(instances.length, 2);
  assert.doesNotMatch(instances[1].url, /after_sequence_id/);
  for (const store of [isolated.state.lastSequence, isolated.state.events, isolated.state.threadCycles, isolated.state.acceptedRuns]) {
    assert.equal(store.has(sessionId), false); }
  assert.equal(isolated.state.threadEventWindows.has(`${sessionId}:old-thread`), false);
  assert.equal(isolated.state.sessions[0].active_run, null);
  assert.equal(isolated.state.snapshots.get(sessionId).active_run, null);
  stale.emit("replay_boundary", { replay_boundary_sequence_id: 901 });
  stale.emit("session_event", { session_id: sessionId, sequence_id: 901, event: { type: "future", value: "stale" } });
  stale.emit("lagged", { missed: 10 });
  assert.equal(instances.length, 2);
  instances[1].emit("replay_boundary", { replay_boundary_sequence_id: 0 });
  for (const value of ["new epoch", "duplicate"]) {
    instances[1].emit("session_event", { session_id: sessionId, sequence_id: 1, event: { type: "future", value } });
  }
  assert.equal(isolated.state.lastSequence.get(sessionId), 1);
  assert.deepEqual(plain(isolated.state.events.get(sessionId).map(({ event }) => event.value)), ["new epoch"]);
  await flushPromises();
  assert.equal(requests.filter((path) => path.startsWith(`/sessions/${sessionId}?`)).length, 1);
});

scenario("SSE", "SSE reconciles gaps and lag, rejects malformed boundaries, and guards CLOSED reconnects", async () => {
  const { FakeEventSource, instances } = eventSourceHarness();
  const requests = [];
  const timers = [];
  const isolated = loadApp({ EventSource: FakeEventSource,
    fetch: async (path) => { requests.push(path);
      return jsonResponse({ metadata: { session_id: "stream-session" }, messages: [] });
    }, window: {
      setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
      clearTimeout() {}, }, });
  const sessionId = "stream-session";
  isolated.state.currentId = sessionId;
  isolated.connectEventStream(sessionId);
  const first = instances[0];
  first.emit("replay_boundary", { replay_boundary_sequence_id: 10 });
  first.emit("session_event", { session_id: sessionId, sequence_id: 11, event: { type: "future", value: "before lag" } });
  first.emit("replay_gap", { replay_gap: { missing_from_sequence_id: 2, missing_to_sequence_id: 9 } });
  first.emit("lagged", { missed: 4 });
  assert.equal(first.closed, true);
  assert.equal(instances.length, 2);
  assert.match(instances[1].url, /after_sequence_id=11/);
  first.emit("session_event", { session_id: sessionId, sequence_id: 99, event: { type: "future", value: "stale" } });
  first.error({ closed: true });
  assert.equal(instances.length, 2);
  assert.equal(isolated.state.lastSequence.get(sessionId), 11);
  const replacement = instances[1];
  replacement.emit("replay_boundary", { replay_boundary_sequence_id: 13 });
  for (const sequence_id of [12, 13]) {
    replacement.emit("session_event", { session_id: sessionId, sequence_id, event: { type: "future", value: `retained ${sequence_id}` } });
  }
  assert.deepEqual(
    plain(isolated.state.events.get(sessionId).map(({ event }) => event.value)),
    ["before lag", "retained 12", "retained 13"]);
  replacement.error({ closed: true });
  replacement.error({ closed: true });
  assert.deepEqual(timers.map(({ delay }) => delay), [1_000, 1_000]);
  for (const { callback } of timers.splice(0)) callback();
  assert.equal(instances.length, 3);
  assert.match(instances[2].url, /after_sequence_id=13/);
  const current = instances[2];
  current.error({ closed: true });
  assert.equal(timers.length, 1);
  isolated.state.currentId = "other-session";
  timers.shift().callback();
  assert.equal(instances.length, 3);
  isolated.state.currentId = sessionId;
  isolated.connectEventStream(sessionId);
  const malformed = instances[3];
  malformed.emit("replay_boundary", "{not json");
  malformed.emit("session_event", { session_id: sessionId, sequence_id: 14, event: { type: "future", value: "ignored" } });
  assert.equal(isolated.state.lastSequence.get(sessionId), 13);
  assert.equal(isolated.state.replayBoundaries.get(sessionId), 13);
  await flushPromises();
  assert.equal(requests.filter((path) => path.startsWith(`/sessions/${sessionId}?`)).length, 3);
});

scenario("SSE", "initial replay hydrates chronology without replaying stale run-attention side effects", () => {
  const { FakeEventSource, instances } = eventSourceHarness();
  const isolated = loadApp({ EventSource: FakeEventSource });
  const sessionId = "historical-session";
  isolated.connectEventStream(sessionId);
  instances[0].emit("replay_boundary", { replay_boundary_sequence_id: 2 });
  instances[0].emit("session_event", { session_id: sessionId,
    sequence_id: 1,
    event: { type: "run_started", prompt_preview: "old run", started_at_epoch_ms: 1 },
  });
  instances[0].emit("session_event", { session_id: sessionId,
    sequence_id: 2,
    event: { type: "run_completed", response: "old result" }, });
  assert.equal(isolated.state.events.get(sessionId).length, 2);
  assert.equal(isolated.state.sessionRunActivity.has(sessionId), false);
  assert.equal(isolated.state.attentionSessions.has(sessionId), false);
  assert.equal(isolated.recordSessionEnvelope(sessionId, {
    session_id: sessionId, sequence_id: 3,
    event: { type: "run_started", prompt_preview: "new run", started_at_epoch_ms: 2 },
  }), true);
  assert.equal(isolated.state.sessionRunActivity.get(sessionId), true);
});

test("workset presentation and overview rail expose authoritative status, item counts, errors, and empty state", () => {
  ui.el.worksetRailSummary = fakeElement();
  ui.el.worksetRailCount = fakeElement();
  ui.renderWorksetRail(undefined);
  assert.equal(ui.el.worksetRailSummary.dataset.state, "loading");
  assert.match(ui.el.worksetRailSummary.innerHTML, /Loading worksets/);
  assert.equal(ui.el.worksetRailCount.textContent, "…");
  for (const snapshot of [{}, { worksets: null }, { worksets: { items: null, error: null } }]) {
    const presentation = ui.worksetsPresentation(snapshot);
    assert.equal(presentation.state, "error");
    assert.match(presentation.error, /unavailable/i); }
  ui.renderWorksetRail({ worksets: { items: [], error: "database <offline>" } });
  assert.equal(ui.el.worksetRailSummary.dataset.state, "error");
  assert.match(ui.el.worksetRailSummary.innerHTML, /database &lt;offline&gt;/);
  assert.doesNotMatch(ui.el.worksetRailSummary.innerHTML, /database <offline>/);
  assert.equal(ui.el.worksetRailCount.textContent, "!");
  ui.renderWorksetRail({ worksets: { items: [], error: null } });
  assert.equal(ui.el.worksetRailSummary.dataset.state, "empty");
  assert.match(ui.el.worksetRailSummary.innerHTML, /No worksets yet/);
  assert.equal(ui.el.worksetRailCount.textContent, "0");
  ui.renderWorksetRail({ worksets: { error: null, items: [{
        id: "plan-<ui>", status: "in_review",
        summary: "Restore <all> fields",
        items: [{ title: "one", status: "invented-item-status" }, { title: "two" }],
      }], }, });
  const html = ui.el.worksetRailSummary.innerHTML;
  assert.equal(ui.el.worksetRailSummary.dataset.state, "populated");
  assert.equal(ui.el.worksetRailCount.textContent, "1");
  assert.match(html, /plan-&lt;ui&gt;/);
  assert.match(html, /in_review/);
  assert.match(html, /2 items/);
  assert.match(html, /Restore &lt;all&gt; fields/);
  assert.doesNotMatch(html, /invented-item-status|0\/2|progress-track/);
});

test("worksets fullscreen distinguishes loading, error, empty, populated, and empty-workset states", () => {
  assert.match(ui.renderWorksetsFocus(undefined), /data-state="loading"[\s\S]*Waiting for the session snapshot/);
  assert.match(
    ui.renderWorksetsFocus({ worksets: { items: [], error: "read <failed>" } }),
    /data-state="error"[\s\S]*read &lt;failed&gt;/);
  assert.match(
    ui.renderWorksetsFocus({ worksets: { items: [], error: null } }),
    /data-state="empty"[\s\S]*no persisted worksets/i);
  const populated = ui.renderWorksetsFocus({ worksets: { error: null,
      items: [{ id: "empty-plan", session_id: "session-one",
        status: "draft", created_at: "2026-07-01T01:02:03Z",
        updated_at: "2026-07-02T01:02:03Z", summary: "A summary",
        goal: "A goal", verification_recipe: null, items: [], }], },
  });
  assert.match(populated, /class="focus-worksets-scroll" data-state="populated"/);
  assert.match(populated, /class="workset-detail" data-state="empty-workset" data-status="draft"/);
  assert.match(populated, /This workset has no items/);
  assert.doesNotMatch(populated, /0\/0|progress-track/);
});

test("worksets fullscreen renders every persisted workset and item field with escaping and no fabricated item status", () => {
  const html = ui.renderWorksetsFocus({ worksets: { error: null,
      items: [{ id: "plan-<one>", status: "executing & checking",
        session_id: "session-<id>", created_at: "created-exact",
        updated_at: "workset-updated-exact",
        summary: "summary <script>", goal: "goal & scope",
        verification_recipe: "npm test -- '<all>'", items: [{
          position: 7, title: "title <unsafe>",
          role: "reviewer & tester", scope: "src/<area>",
          description: "description > detail",
          depends_on: ["base<one>", "base&two"],
          acceptance: "accept <exact>", notes: "notes & caveat",
          updated_at: "item-updated-exact",
          status: "fabricated-item-status", }], }], }, });
  for (const label of [
    "ID", "Status", "Session", "Created", "Updated", "Summary", "Goal", "Verification recipe",
    "Position", "Title", "Role", "Scope", "Description", "Dependencies", "Acceptance", "Notes",
  ]) assert.match(html, new RegExp(`<dt>${label}</dt>`));
  for (const escapedValue of [
    "plan-&lt;one&gt;", "executing &amp; checking", "session-&lt;id&gt;", "created-exact",
    "workset-updated-exact", "summary &lt;script&gt;", "goal &amp; scope", "npm test -- &#39;&lt;all&gt;&#39;",
    "title &lt;unsafe&gt;", "reviewer &amp; tester", "src/&lt;area&gt;", "description &gt; detail",
    "base&lt;one&gt;", "base&amp;two", "accept &lt;exact&gt;", "notes &amp; caveat", "item-updated-exact",
  ]) assert.match(html, new RegExp(escapedValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /Item 7/);
  assert.match(html, /1 item/);
  assert.doesNotMatch(html, /fabricated-item-status|progress-track|0\/1/);
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

test("session reordering uses pointer capture with touch targets and keyboard grab mode", () => {
  const card = ui.renderSessionCard({ summary: {
      session_id: "session-one", title: "One", cwd: "/repo",
      model: "model", pinned: false, presentation_version: 1, },
  }, 1, [{}, {}, {}]);
  assert.doesNotMatch(card, /draggable="true"/);
  assert.match(card, /aria-label="Reorder One; position 2 of 3 in sessions"/);
  assert.equal(occurrences(card, /<circle /g), 6);
});

scenario("Transcript privacy", "orchestrator tool-call messages render blocks without a duplicate name summary", () => {
  const html = ui.renderFocusMessage({ role: "assistant", content: "",
    tool_calls: [
      { function: { name: "thread_delete", arguments: '{"name":"ops/one"}' } },
      { function: { name: "thread_delete", arguments: '{"name":"ops/two"}' } },
    ], });
  assert.equal(occurrences(html, /class="focus-tool-call"/g), 2);
  assert.equal(occurrences(html, />thread_delete</g), 2);
  assert.doesNotMatch(html, /thread_delete, thread_delete/);
  assert.doesNotMatch(html, /focus-message-copy/);
});

scenario("Transcript privacy", "shared transcript message rendering excludes system rows without dropping supported message fields", () => {
  const system = ui.renderFocusMessage({ role: "system", content: "policy <root>" }, { ordinal: 25 });
  assert.equal(system, "");
  const assistant = ui.renderFocusMessage({ role: "assistant",
    reasoning_text: "reason <carefully>", content: "answer <safely>",
    tool_calls: [{ id: "call-<42>",
      function: { name: "read<file>", arguments: '{"path":"<secret>"}' },
    }], }, { ordinal: 26, durationMs: 2_500 });
  assert.match(assistant, /focus-message-copy is-reasoning/);
  assert.match(assistant, />reasoning</);
  assert.ok(assistant.indexOf("reason &lt;carefully&gt;") < assistant.indexOf("answer &lt;safely&gt;"));
  assert.match(assistant, /focus-tool-call-id[^>]*>call-&lt;42&gt;</);
  assert.match(assistant, /read&lt;file&gt;/);
  assert.match(assistant, /response 00:00:02/);
  assert.doesNotMatch(assistant, /<secret>|<carefully>|<safely>/);
  const tool = ui.renderFocusMessage({ role: "tool", tool_call_id: "call-<42>", content: "done" }, { ordinal: 27 });
  assert.match(tool, /Tool result/);
  assert.match(tool, /call call-&lt;42&gt;/);
  const empty = ui.renderFocusMessage({ role: "assistant", content: null, reasoning_text: null, tool_calls: [] }, { ordinal: 28 });
  assert.match(empty, /focus-message-copy is-empty/);
  assert.match(empty, /empty message/);
  assert.match(empty, /\[empty\]/);
  const pending = ui.renderFocusMessage({
    role: "user", content: "just accepted", pending: true, pendingSource: "accepted response <client>",
  });
  assert.match(pending, /class="focus-message is-pending"/);
  assert.match(pending, /submitted · pending/);
  assert.match(pending, /data-pending-source="accepted response &lt;client&gt;"/);
  assert.doesNotMatch(pending, />#\d+</);
});

scenario("Transcript privacy", "unfiltered post-create transcripts hide system and AGENTS content while retaining user and reasoning-only assistant rows", () => {
  const message = { role: "assistant", content: null,
    reasoning_text: "reason <carefully> & ignore <img src=x onerror=alert(1)>",
    tool_calls: [], };
  const row = ui.renderFocusMessage(message, { ordinal: 7 });
  assert.match(row, /data-role="assistant"/);
  assert.match(row, /focus-message-copy is-reasoning/);
  assert.match(row, />reasoning</);
  assert.match(row, /reason &lt;carefully&gt; &amp; ignore &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(row, /<img|empty message/);
  const transcript = ui.renderOrchestratorConversation(sessionSnapshot("reasoning-session", {
    messages: [
      { role: "system", content: "private system prompt with AGENTS.md instructions <never-show>" },
      { role: "user", content: "visible user prompt" }, message, ],
    message_page: { start: 0, end: 3, total: 3, has_older: false }, }));
  assert.equal(occurrences(transcript, /focus-message-copy is-reasoning/g), 1);
  assert.match(transcript, /visible user prompt/);
  assert.match(transcript, />#2</);
  assert.match(transcript, />#3</);
  assert.doesNotMatch(transcript, /private system prompt|AGENTS\.md|never-show|data-role="system"|>System</);
  assert.doesNotMatch(transcript, /No conversation messages|<img/);
});

scenario("Transcript privacy", "transcript image rendering stays textual and markdown output stays sanitizer-guarded", () => {
  const image = ui.renderMarkdownImageToken([
    { attrGet: () => "javascript:alert(<x>)", children: [{}] },
  ], 0, {}, {}, { renderInlineAsText: () => "diagram <alt>" });
  assert.equal(image, '<span class="md-image-text">image: diagram &lt;alt&gt; &lt;javascript:alert(&lt;x&gt;)&gt;</span>');
  assert.doesNotMatch(image, /<img|javascript:alert\(<x>/);
  let markdownRenderer;
  let sanitizeInput;
  let sanitizeOptions;
  const isolated = loadApp({ window: { markdownit() {
        markdownRenderer = { renderer: { rules: {} },
          render(value) { return `<p>${value}</p><img src="bad"><script>bad()</script>`; },
        };
        return markdownRenderer; }, DOMPurify: {
        sanitize(input, options) { sanitizeInput = input;
          sanitizeOptions = options;
          return "<p>sanitized transcript</p>"; }, }, }, });
  assert.equal(isolated.renderFocusMarkdown("<unsafe>"), "<p>sanitized transcript</p>");
  assert.match(sanitizeInput, /<img src="bad"><script>/);
  assert.ok(sanitizeOptions.FORBID_TAGS.includes("img"));
  assert.ok(sanitizeOptions.FORBID_TAGS.includes("script"));
  assert.ok(sanitizeOptions.FORBID_ATTR.includes("style"));
  assert.equal(typeof markdownRenderer.renderer.rules.image, "function");
});

test("paged transcript requests leave the system-message API opt-in dormant", async () => {
  const urls = [];
  let isolated;
  const reasoningOnly = { role: "assistant", content: null, reasoning_text: "retained reasoning", tool_calls: [] };
  const fetch = async (url) => { urls.push(url);
    if (urls.length === 1) { return jsonResponse({
        metadata: { session_id: "page/session" },
        messages: [reasoningOnly, { role: "user", content: "tail" }],
        message_page: { start: 0, end: 2, total: 2, has_older: false },
      }); }
    isolated.state.focusView = { type: "info" };
    return jsonResponse({
      messages: [{ role: "assistant", content: "older reply" }],
      page: { start: 2, end: 3, total: 5, has_older: true }, }); };
  isolated = loadApp({ fetch });
  const snapshot = await isolated.loadSnapshot("page/session");
  assert.equal(snapshot.messages[0].reasoning_text, "retained reasoning");
  assert.equal(urls[0], "/sessions/page%2Fsession?message_limit=24&thread_event_limit=24");
  isolated.state.currentId = "page/session";
  isolated.state.focusView = { type: "orchestrator" };
  isolated.state.snapshots.set("page/session", {
    messages: [{ role: "user", content: "tail" }, { role: "assistant", content: "reply" }],
    message_page: { start: 3, end: 5, total: 5, has_older: true }, });
  isolated.state.messageWindows.set("page/session", {
    start: 3, end: 5, total: 5, hasOlder: true, loading: false,
    messages: [{ role: "user", content: "tail" }, { role: "assistant", content: "reply" }],
  });
  await isolated.loadOlderOrchestratorMessages({ scrollHeight: 500,
    scrollTop: 0, querySelector() { return null; }, });
  assert.equal(urls[1], "/sessions/page%2Fsession/messages?before=3&limit=24");
  assert.equal(isolated.state.messageWindows.get("page/session").loading, false);
});

test("session-list generations and navigation identity reject stale responses without ejecting the selected session", async () => {
  const first = deferred();
  const second = deferred();
  const navigation = deferred();
  const pending = [first, second, navigation];
  const isolated = loadApp({ fetch: () => pending.shift().promise });
  isolated.el.pickerSessionTotal = fakeElement();
  isolated.el.sessionGrid = fakeElement();
  const olderLoad = isolated.loadSessions();
  const newerLoad = isolated.loadSessions();
  second.resolve(jsonResponse([{
    summary: { session_id: "new-session", cwd: "/new", model: "new-model", backend: "test", pinned: false, visible_message_count: 0 },
    active_run: null, }]));
  await newerLoad;
  first.resolve(jsonResponse([{
    summary: { session_id: "old-session", cwd: "/old", model: "old-model", backend: "test", pinned: false, visible_message_count: 0 },
    active_run: null, }]));
  assert.equal(await olderLoad, null);
  assert.deepEqual(plain(isolated.state.sessions.map((entry) => entry.summary.session_id)), ["new-session"]);
  const startedFromPicker = isolated.loadSessions();
  isolated.state.currentId = "new-session";
  navigation.resolve(jsonResponse([]));
  assert.equal(await startedFromPicker, null);
  assert.equal(isolated.state.currentId, "new-session");
  assert.deepEqual(plain(isolated.state.sessions.map((entry) => entry.summary.session_id)), ["new-session"]);
});

test("snapshot generations and response identity prevent stale snapshots from overwriting newer state", async () => {
  const first = deferred();
  const second = deferred();
  const mismatch = deferred();
  const pending = [first, second, mismatch];
  const isolated = loadApp({ fetch: () => pending.shift().promise });
  const olderLoad = isolated.loadSnapshot("snapshot-session");
  const newerLoad = isolated.loadSnapshot("snapshot-session");
  second.resolve(jsonResponse({ metadata: { session_id: "snapshot-session", model: "new-model" }, messages: [] }));
  await newerLoad;
  first.resolve(jsonResponse({ metadata: { session_id: "snapshot-session", model: "stale-model" }, messages: [] }));
  assert.equal(await olderLoad, null);
  assert.equal(isolated.state.snapshots.get("snapshot-session").metadata.model, "new-model");
  const mismatchedLoad = isolated.loadSnapshot("snapshot-session");
  mismatch.resolve(jsonResponse({ metadata: { session_id: "different-session", model: "wrong-model" }, messages: [] }));
  assert.equal(await mismatchedLoad, null);
  assert.equal(isolated.state.snapshots.get("snapshot-session").metadata.model, "new-model");
});

test("pending messages reconcile only against canonical rows after their authoritative baseline", () => {
  const absentBaselines = ui.normalizedSubmittedMessage({
    run_id: "run-no-baseline", baseline_message_total: null,
    submitted_user_message: { content: "new", baseline_user_message_count: null },
  });
  assert.equal(absentBaselines.baselineUserCount, null);
  assert.equal(absentBaselines.baselineMessageTotal, null);
  const activeRun = { run_id: "run-repeat",
    started_at_epoch_ms: 1_000, submitted_user_message: {
      run_id: "run-repeat", content: "repeat prompt",
      baseline_user_message_count: 1, submitted_at_epoch_ms: 1_000, },
  };
  const beforeCanonical = { active_run: activeRun,
    messages: [{ role: "user", content: "repeat prompt" }],
    message_page: { start: 0, end: 1, total: 1 },
    message_cycle: { marker: "history:1:0", thread_names: [] }, };
  assert.equal(ui.effectivePendingMessages("repeat-session", beforeCanonical).length, 1);
  const afterCanonical = { ...beforeCanonical, messages: [
      { role: "user", content: "repeat prompt" },
      { role: "assistant", content: "earlier response" },
      { role: "user", content: "expanded canonical prompt that differs" },
    ], message_page: { start: 0, end: 3, total: 3 },
    message_cycle: { marker: "history:2:2", thread_names: [] }, };
  assert.equal(ui.effectivePendingMessages("repeat-session", afterCanonical).length, 0);
  const acceptedPending = { role: "user",
    content: "/run compact-name", baselineMessageTotal: 20,
    baselineUserCount: null, };
  assert.equal(ui.pendingMessageCoveredByCanonical(acceptedPending, {
    messages: [{ role: "user", content: "/run compact-name" }],
    message_page: { start: 19 }, }), false);
  assert.equal(ui.pendingMessageCoveredByCanonical(acceptedPending, {
    messages: [{ role: "user", content: "expanded command body" }],
    message_page: { start: 20 }, }), true);
});

test("an accepted run immediately supplies pending transcript and active elapsed state", () => {
  const sessionId = "accepted-session";
  const snapshot = sessionSnapshot(sessionId, {
    messages: [{ role: "system", content: "policy" }, { role: "user", content: "older" }],
    message_page: { start: 0, end: 2, total: 2, has_older: false },
    message_cycle: { marker: "history:1:1", thread_names: [] }, });
  ui.state.currentId = sessionId;
  ui.state.snapshots.set(sessionId, snapshot);
  ui.state.events.set(sessionId, []);
  const accepted = ui.captureAcceptedRun(sessionId, {
    run_id: "run-accepted", client_id: "client-7",
    display_prompt: "/run accepted-workset",
  }, "expanded input should not be shown yet", snapshot, 10_000);
  assert.equal(accepted.baseline_message_total, 2);
  assert.equal(ui.effectiveActiveRun(snapshot, sessionId).accepted_response, true);
  assert.deepEqual(plain(ui.effectivePendingMessages(sessionId, snapshot).map((message) => ({
    content: message.content, source: message.pendingSource,
    runId: message.run_id,
  }))), [{ content: "/run accepted-workset", source: "accepted response", runId: "run-accepted" }]);
  assert.equal(ui.orchestratorLifecycle(snapshot, sessionId).provenance, "accepted");
  assert.deepEqual(plain(ui.runTimingPresentation(snapshot, sessionId, 14_500)), {
    state: "active", label: "00:00:04",
    title: "Active elapsed runtime: 00:00:04", elapsedMs: 4_500, });
  const html = ui.renderOrchestratorConversation(snapshot);
  assert.match(html, /submitted · pending/);
  assert.match(html, /\/run accepted-workset/);
  const reconciled = { ...snapshot,
    messages: [...snapshot.messages, { role: "user", content: "expanded canonical command body" }],
    message_page: { start: 0, end: 3, total: 3, has_older: false },
    message_cycle: { marker: "history:2:2", thread_names: [] }, };
  assert.equal(ui.reconcileAcceptedRun(sessionId, reconciled), true);
  assert.equal(ui.state.acceptedRuns.has(sessionId), false);
  assert.equal(ui.effectivePendingMessages(sessionId, reconciled).length, 0);
});

test("composer drafts are isolated and intentionally restored per session", () => {
  const isolated = loadApp();
  isolated.el.promptInput = { value: "draft A", scrollHeight: 40, style: {} };
  isolated.el.commandMenu = { hidden: true, innerHTML: "" };
  isolated.state.currentId = "session-A";
  assert.equal(isolated.persistComposerDraft(), "draft A");
  isolated.state.currentId = "session-B";
  assert.equal(isolated.restoreComposerDraft(), "");
  assert.equal(isolated.el.promptInput.value, "");
  isolated.el.promptInput.value = "draft B";
  isolated.persistComposerDraft();
  isolated.state.currentId = "session-A";
  assert.equal(isolated.restoreComposerDraft(), "draft A");
  assert.equal(isolated.el.promptInput.value, "draft A");
  assert.equal(isolated.state.composerDrafts.get("session-B"), "draft B");
  assert.equal(isolated.clearComposerDraftIfUnchanged("session-A", "different submission"), false);
  assert.equal(isolated.state.composerDrafts.get("session-A"), "draft A");
});

test("composer fallback and accepted-run state stay bound to the originating session across navigation", async () => {
  const steering = deferred();
  const requests = [];
  const isolated = loadApp({ fetch: async (path, options) => {
      requests.push({ path, body: options?.body ? JSON.parse(options.body) : null });
      if (path === "/sessions/session-A/steering") return steering.promise;
      if (path === "/sessions/session-A/runs") return jsonResponse({ run_id: "run-A", display_prompt: "continue A" });
      throw new Error(`unexpected request ${path}`); },
    window: { setTimeout: () => 42, clearTimeout() {} }, });
  isolated.state.currentId = "session-A";
  isolated.state.snapshots.set("session-A", sessionSnapshot("session-A", {
    active_run: { run_id: "ending-A", started_at_epoch_ms: 1 },
  }));
  isolated.el.promptInput = {
    value: "continue A", scrollHeight: 40, style: {},
    focus() { this.focused = true; }, };
  isolated.el.sendPrompt = { disabled: false };
  const submission = isolated.submitComposer({ preventDefault() {} });
  assert.equal(requests[0].path, "/sessions/session-A/steering");
  isolated.state.currentId = "session-B";
  isolated.state.composerDrafts.set("session-B", "draft for B");
  isolated.el.promptInput.value = "draft for B";
  isolated.el.sendPrompt.disabled = false;
  steering.resolve(errorResponse(409, { error: "no active run" }));
  await submission;
  assert.deepEqual(requests.map((request) => request.path), ["/sessions/session-A/steering", "/sessions/session-A/runs"]);
  assert.deepEqual(requests[1].body, { prompt: "continue A" });
  assert.equal(isolated.state.acceptedRuns.get("session-A").run_id, "run-A");
  assert.equal(isolated.state.acceptedRuns.has("session-B"), false);
  assert.equal(isolated.state.snapshotTimers.has("session-A"), true);
  assert.equal(isolated.state.snapshotTimers.has("session-B"), false);
  assert.equal(isolated.el.promptInput.value, "draft for B");
  assert.equal(isolated.state.composerDrafts.get("session-A"), "");
  assert.equal(isolated.state.composerDrafts.get("session-B"), "draft for B");
  assert.equal(isolated.el.sendPrompt.disabled, false);
  assert.equal(isolated.el.promptInput.focused, undefined);
  assert.equal(isolated.state.submittingSessions.size, 0);
});

test("thread steering captures its originating session and thread before awaiting", async () => {
  const steering = deferred();
  const requests = [];
  const isolated = loadApp({ fetch: async (path) => {
      requests.push(path);
      return steering.promise; },
    window: { setTimeout: () => 73, clearTimeout() {} }, });
  isolated.state.currentId = "session-A";
  isolated.state.targetedThread = "worker-A";
  isolated.el.promptInput = { value: "steer A", scrollHeight: 40, style: {}, focus() { this.focused = true; } };
  isolated.el.sendPrompt = { disabled: false };
  const submission = isolated.submitComposer({ preventDefault() {} });
  isolated.state.currentId = "session-B";
  isolated.state.targetedThread = "worker-B";
  isolated.state.composerDrafts.set("session-B", "draft for B");
  isolated.el.promptInput.value = "draft for B";
  isolated.el.sendPrompt.disabled = false;
  steering.resolve(jsonResponse({ steering_id: 1 }));
  await submission;
  assert.deepEqual(requests, ["/sessions/session-A/threads/worker-A/steering"]);
  assert.equal(isolated.state.snapshotTimers.has("session-A"), true);
  assert.equal(isolated.state.snapshotTimers.has("session-B"), false);
  assert.equal(isolated.el.promptInput.value, "draft for B");
  assert.equal(isolated.state.composerDrafts.get("session-A"), "");
  assert.equal(isolated.state.composerDrafts.get("session-B"), "draft for B");
  assert.equal(isolated.el.sendPrompt.disabled, false);
});

test("response durations align only with assistant responses and tail pages", () => {
  const messages = [ { role: "system", content: "policy" },
    { role: "assistant", content: null, tool_calls: [{ id: "call-1", function: { name: "read", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call-1", content: "done" },
    { role: "assistant", content: "first response" },
    { role: "user", content: "next" },
    { role: "assistant", content: null, reasoning_text: "reasoning response" },
    { role: "assistant", content: "response without recorded duration" },
  ];
  const assignments = ui.responseDurationAssignments({ messages,
    response_timing: { response_durations_ms: [1_000, 2_500, null] },
  }, messages);
  assert.equal(assignments.size, 2);
  assert.equal(assignments.has(1), false);
  assert.equal(assignments.get(3), 1_000);
  assert.equal(assignments.get(5), 2_500);
  assert.equal(assignments.has(6), false);
  const tail = [{ role: "assistant", content: "latest response" }];
  assert.equal(ui.responseDurationAssignments({ messages: tail,
    message_page: { start: 90, end: 91, total: 91 },
    response_timing: { response_durations_ms: [1_000, null, 4_250] },
  }, tail).get(0), 4_250);
  const legacyMessages = [ { role: "assistant", content: "previous" },
    { role: "assistant", tool_calls: [{ function: { name: "tool", arguments: "{}" } }] },
    { role: "assistant", content: "last" }, ];
  const legacy = ui.responseDurationAssignments({
    messages: legacyMessages,
    response_timing: { previous_response_duration_ms: 3_000, last_response_duration_ms: 6_000 },
  }, legacyMessages);
  assert.equal(legacy.get(0), 3_000);
  assert.equal(legacy.get(2), 6_000);
});

test("run metric shows active elapsed time or the last response duration", () => {
  const sessionId = "timing-session";
  ui.state.currentId = sessionId;
  ui.state.events.set(sessionId, []);
  assert.deepEqual(plain(ui.runTimingPresentation({
    active_run: { run_id: "run-live", started_at_epoch_ms: 1_000 },
  }, sessionId, 66_500)), { state: "active", label: "00:01:05",
    title: "Active elapsed runtime: 00:01:05", elapsedMs: 65_500, });
  assert.deepEqual(plain(ui.runTimingPresentation({ active_run: null,
    response_timing: { last_response_duration_ms: 6_543 },
  }, sessionId, 66_500)), { state: "response", label: "00:00:06",
    title: "Last response duration: 00:00:06", elapsedMs: null, });
  assert.equal(ui.runTimingPresentation({
    active_run: { run_id: "run-no-time", started_at_epoch_ms: null },
  }, sessionId, 66_500).label, "active");
  ui.el.metricRun = fakeElement();
  ui.state.snapshots.set(sessionId, { active_run: null,
    response_timing: { last_response_duration_ms: 2_000 }, });
  ui.updateRuntimeMetric(70_000);
  assert.equal(ui.el.metricRun.textContent, "00:00:02");
  assert.equal(ui.el.metricRun.dataset.state, "response");
  assert.match(ui.el.metricRun.title, /Last response duration/);
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
    page: { start: 2, end: 6, total: 12, has_older: true }, }), true);
  assert.deepEqual(plain(refreshed.messages.map((message) => message.content)), ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
  assert.equal(refreshed.message_page.start, 2);
});

test("orchestrator conversation keeps pagination available while filtering system rows", () => {
  ui.state.currentId = "loader-session";
  ui.state.messageWindows.set("loader-session", {
    start: 24, end: 48, total: 80, hasOlder: true, loading: false, messages: [],
  });
  const html = ui.renderOrchestratorConversation({ messages: [
      { role: "system", content: "paged private AGENTS prompt" },
      { role: "user", content: "paged visible user prompt" }, ],
    message_page: { start: 24, end: 26, total: 80, has_older: true },
    active_run: null, worksets: { items: [] }, });
  assert.match(html, /data-history-loader/);
  assert.match(html, /scroll up for earlier messages/);
  assert.match(html, />#26</);
  assert.match(html, /paged visible user prompt/);
  assert.doesNotMatch(html, />#25</);
  assert.doesNotMatch(html, /paged private AGENTS prompt|data-role="system"/);
  ui.state.messageWindows.set("loader-session", {
    start: 0, end: 48, total: 48, hasOlder: false, loading: false, messages: [],
  });
  assert.doesNotMatch(
    ui.renderOrchestratorConversation({ messages: [], active_run: null, worksets: { items: [] } }),
    /data-history-loader/);
});

test("server-provided cycle metadata keeps current threads visible with a paginated transcript", () => {
  const seed = ui.threadCycleSeed({
    messages: [{ role: "assistant", content: "recent tail without its user message" }],
    message_cycle: { marker: "history:9:44", thread_names: ["current/a", "current/b"] },
    active_threads: ["current/live"], });
  assert.equal(seed.marker, "history:9:44");
  assert.deepEqual([...seed.names].sort(), ["current/a", "current/b", "current/live"]);
});

scenario("Thread lifecycle, redaction, and coalescing", "orchestrator lifecycle distinguishes no-run, running, completed, and failed evidence", () => {
  ui.state.currentId = "orchestrator-lifecycle";
  ui.state.events.set("orchestrator-lifecycle", []);
  assert.deepEqual(
    plain(ui.orchestratorLifecycle({ active_run: null })), {
      state: "no-run", provenance: "unavailable", sequenceId: null,
      startSequence: null, finishSequence: null, runId: null,
      startedAtEpochMs: null, durationMs: null,
      detail: "No run lifecycle event is available in the current replay window.",
    });
  assert.equal(ui.orchestratorLifecycle({
    active_run: { run_id: "run-live", started_at_epoch_ms: 1_700_000_000_000, prompt_preview: "work" },
  }).state, "running");
  ui.state.events.set("orchestrator-lifecycle", [
    { sequence_id: 20, run_id: "run-20", event: { type: "run_started", prompt_preview: "start", started_at_epoch_ms: 1_700_000_000_000 } },
    { sequence_id: 21, run_id: "run-20", event: { type: "run_completed", response: "done", duration_ms: 55 } },
  ]);
  assert.deepEqual(
    plain(ui.orchestratorLifecycle({ active_run: null })), {
      state: "completed", provenance: "observed", sequenceId: 21,
      startSequence: 20, finishSequence: 21, runId: "run-20",
      startedAtEpochMs: 1_700_000_000_000, durationMs: 55,
      detail: "done", });
  ui.state.events.set("orchestrator-lifecycle", [
    { sequence_id: 22, run_id: "run-22", event: { type: "run_failed", message: "model unavailable" } },
  ]);
  assert.equal(ui.orchestratorLifecycle({ active_run: null }).state, "failed");
  assert.equal(ui.orchestratorLifecycle({ active_run: null }).detail, "model unavailable");
});

scenario("Thread lifecycle, redaction, and coalescing", "thread lifecycle exposes only queued, running, and finished while retaining detailed outcomes", () => {
  ui.state.currentId = "thread-states";
  ui.state.threadCycles.clear();
  ui.state.events.set("thread-states", [ agentEnvelope(60, {
      type: "tool_call_started", thread_name: null, call_id: "dispatch-live", name: "thread",
      args_detail: JSON.stringify({ name: "launched", action: "spawn" }),
    }), agentEnvelope(70, {
      type: "tool_call_started", thread_name: null, call_id: "dispatch-bad", name: "thread",
      args_detail: JSON.stringify({ name: "dispatch-failure", action: "spawn" }),
    }), agentEnvelope(71, {
      type: "tool_call_finished", thread_name: null, call_id: "dispatch-bad", name: "thread",
      content_preview: "Failed to spawn", is_error: true, }), ]);
  const snapshot = { metadata: { session_id: "thread-states" },
    messages: [], active_threads: ["running", "queued", "launched"],
    threads: ["running", "queued", "launched", "failed-exit", "failed-error", "finished", "timeout-finish", "dispatch-failure", "started-inactive", "retained-only"]
      .map((name, index) => ({ name, session_id: "thread-states", updated_at: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z` })),
    thread_episodes: { "retained-only": [{ id: 9, content: "retained" }] },
    thread_steering: [], thread_events: {
      running: [{ type: "thread_started", name: "running", action: "work", source_threads: [] }],
      "failed-exit": [
        { type: "thread_started", name: "failed-exit", action: "work", source_threads: [] },
        { type: "thread_finished", name: "failed-exit", exit_code: 7, timed_out: false },
      ], "failed-error": [
        { type: "thread_started", name: "failed-error", action: "work", source_threads: [] },
        { type: "error", thread_name: "failed-error", message: "worker transport failed" },
      ], finished: [
        { type: "thread_started", name: "finished", action: "work", source_threads: [] },
        { type: "thread_finished", name: "finished", exit_code: 0, timed_out: false },
      ], "timeout-finish": [
        { type: "thread_started", name: "timeout-finish", action: "work", source_threads: [] },
        { type: "thread_finished", name: "timeout-finish", exit_code: 124, timed_out: true, timeout_reason: "model call" },
      ], "started-inactive": [
        { type: "thread_started", name: "started-inactive", action: "work", source_threads: [] },
      ], }, };
  const models = ui.buildThreadModels(snapshot);
  assert.deepEqual(new Set(models.map((model) => model.state)), new Set(["queued", "running", "finished"]));
  assert.equal(models.find((model) => model.name === "running").state, "running");
  assert.equal(models.find((model) => model.name === "launched").state, "running");
  assert.equal(models.find((model) => model.name === "queued").state, "queued");
  for (const name of ["failed-exit", "failed-error", "finished", "timeout-finish", "dispatch-failure", "started-inactive", "retained-only"]) {
    assert.equal(models.find((model) => model.name === name).state, "finished");
  }
  assert.equal(models.find((model) => model.name === "failed-exit").outcome, "failed (exit 7)");
  assert.equal(models.find((model) => model.name === "failed-error").outcome, "worker transport failed");
  assert.equal(models.find((model) => model.name === "finished").outcome, "completed (exit 0)");
  assert.equal(models.find((model) => model.name === "timeout-finish").outcome, "timed out");
  assert.equal(models.find((model) => model.name === "dispatch-failure").outcome, "Failed to spawn");
  assert.equal(models.find((model) => model.name === "started-inactive").outcome, "start observed; finish outcome unavailable");
  const runningHtml = ui.renderThreadTile(models.find((model) => model.name === "running"));
  const queuedHtml = ui.renderThreadTile(models.find((model) => model.name === "queued"));
  const finishedHtml = ui.renderThreadTile(models.find((model) => model.name === "failed-exit"));
  assert.match(runningHtml, /data-state="running"[\s\S]*aria-label="Running">Running/);
  assert.match(queuedHtml, /data-state="queued"[\s\S]*aria-label="Queued">Queued/);
  assert.match(finishedHtml, /data-state="finished"[\s\S]*aria-label="Finished">Finished/);
});

scenario("Thread lifecycle, redaction, and coalescing", "thread evidence overlays duplicate live occurrences into durable positions without losing order or multiplicity", () => {
  const name = "overlay-worker";
  const start = { type: "thread_started", name, action: "inspect", source_threads: [] };
  const repeated = { type: "thread_log", name, line: "same retained line" };
  const finish = { type: "thread_finished", name, exit_code: 0, timed_out: false };
  const partial = { type: "tool_call_started", thread_name: name, call_id: "still-open", name: "read", args_detail: "{}" };
  const snapshot = {
    thread_events: { [name]: [start, repeated, repeated, finish] },
    thread_episodes: {}, thread_steering: [], };
  const entries = ui.threadModelEntries(name, snapshot, [
    agentEnvelope(40, partial), agentEnvelope(25, repeated),
    agentEnvelope(10, start), agentEnvelope(30, repeated),
    agentEnvelope(20, repeated), ]);
  assert.deepEqual(
    plain(entries.map((entry) => ({ type: entry.event.type, sequenceId: entry.sequenceId, persisted: Boolean(entry.persisted) }))),
    [ { type: "thread_started", sequenceId: 10, persisted: true },
      { type: "thread_log", sequenceId: 20, persisted: true },
      { type: "thread_log", sequenceId: 25, persisted: true },
      { type: "thread_finished", sequenceId: null, persisted: false },
      { type: "thread_log", sequenceId: 30, persisted: false },
      { type: "tool_call_started", sequenceId: 40, persisted: false },
    ]);
  assert.equal(entries.filter((entry) => entry.event.type === "thread_log").length, 3);
  assert.equal(ui.threadLifecycleFromEvidence(name, entries, false, []).state, "finished");
  assert.equal(ui.buildThreadActions(name, entries, snapshot).filter((action) => action.name === "thread log").length, 3);
});

scenario("Thread lifecycle, redaction, and coalescing", "a durable finish stays terminal when excess identical live starts replay after it", () => {
  const name = "duplicate-start-worker";
  const start = { type: "thread_started", name, action: "work", source_threads: [] };
  const finish = { type: "thread_finished", name, exit_code: 0, timed_out: false };
  const entries = ui.threadModelEntries(name, { thread_events: { [name]: [start, finish] } }, [
    agentEnvelope(10, start), agentEnvelope(20, start), ]);
  assert.deepEqual(
    plain(entries.map((entry) => ({ type: entry.event.type, sequenceId: entry.sequenceId, persisted: Boolean(entry.persisted) }))),
    [ { type: "thread_started", sequenceId: 10, persisted: true },
      { type: "thread_finished", sequenceId: null, persisted: false },
      { type: "thread_started", sequenceId: 20, persisted: false }, ],
  );
  const lifecycle = ui.threadLifecycleFromEvidence(name, entries, false, []);
  assert.equal(entries.filter((entry) => entry.event.type === "thread_started").length, 2);
  assert.equal(lifecycle.state, "finished");
  assert.equal(lifecycle.outcome, "completed (exit 0)");
  assert.equal(lifecycle.startSequence, 10);
});

scenario("Thread lifecycle, redaction, and coalescing", "authoritative active membership or a distinct new dispatch establishes a later thread cycle", () => {
  const name = "restarted-worker";
  const durableStart = { type: "thread_started", name, action: "first cycle", source_threads: [] };
  const newStart = { type: "thread_started", name, action: "second cycle", source_threads: [] };
  const entries = ui.threadModelEntries(name, {
    thread_events: { [name]: [durableStart, { type: "thread_finished", name, exit_code: 0, timed_out: false }] },
  }, [ agentEnvelope(10, durableStart), agentEnvelope(20, newStart),
  ]);
  const dispatchOnlyEntries = ui.threadModelEntries(name, {
    thread_events: { [name]: [durableStart, { type: "thread_finished", name, exit_code: 0, timed_out: false }] },
  }, [agentEnvelope(10, durableStart)]);
  const dispatchOnlyLifecycle = ui.threadLifecycleFromEvidence(name, dispatchOnlyEntries, true, [{
    name, provenance: "observed", sequenceId: 20, isError: false,
    completed: false, }]);
  assert.equal(dispatchOnlyLifecycle.state, "running");
  assert.equal(dispatchOnlyLifecycle.start, null);
  const activeLifecycle = ui.threadLifecycleFromEvidence(name, entries, true, []);
  assert.equal(activeLifecycle.state, "running");
  assert.equal(activeLifecycle.start.action, "second cycle");
  assert.equal(activeLifecycle.startSequence, 20);
  const dispatchedLifecycle = ui.threadLifecycleFromEvidence(name, entries, false, [{
    name, provenance: "observed", sequenceId: 15, isError: false, }]);
  assert.equal(dispatchedLifecycle.state, "finished");
  assert.equal(dispatchedLifecycle.start.action, "second cycle");
  assert.equal(dispatchedLifecycle.startSequence, 20);
});

scenario("Thread lifecycle, redaction, and coalescing", "an unmatched live finish advances running durable evidence to finished", () => {
  const name = "live-finish-worker";
  const snapshot = {
    thread_events: { [name]: [{ type: "thread_started", name, action: "work", source_threads: [] }] },
  };
  const runningEntries = ui.threadModelEntries(name, snapshot, []);
  assert.equal(ui.threadLifecycleFromEvidence(name, runningEntries, true, []).state, "running");
  const finishedEntries = ui.threadModelEntries(name, snapshot, [
    agentEnvelope(88, { type: "thread_finished", name, exit_code: 0, timed_out: false }),
  ]);
  const lifecycle = ui.threadLifecycleFromEvidence(name, finishedEntries, true, []);
  assert.equal(lifecycle.state, "finished");
  assert.equal(lifecycle.finishSequence, 88);
  assert.deepEqual(plain(finishedEntries.map((entry) => entry.event.type)), ["thread_started", "thread_finished"]);
});

scenario("Thread lifecycle, redaction, and coalescing", "thread focus overlay retains durable slots and repeated occurrences while adding only newer live evidence", () => {
  const sessionId = "focus-overlay-session";
  const name = "focus-overlay-worker";
  const durable = [
    { type: "thread_started", name, action: "work", source_threads: [] },
    { type: "thread_log", name, line: "repeated" },
    { type: "thread_log", name, line: "repeated" },
    { type: "thread_finished", name, exit_code: 0, timed_out: false },
  ];
  ui.state.currentId = sessionId;
  ui.state.events.set(sessionId, [ agentEnvelope(10, durable[0]),
    agentEnvelope(20, durable[1]), agentEnvelope(21, durable[2]),
    agentEnvelope(31, { type: "error", thread_name: name, message: "new tail evidence" }),
  ]);
  const entries = ui.threadFocusEvidenceEntries(name, { thread_events: {} }, {
    afterSequence: 30,
    events: durable.map((event, index) => ({ id: index + 1, created_at: `time-${index + 1}`, event })).reverse(),
  });
  assert.deepEqual(
    plain(entries.map((entry) => ({ type: entry.event.type, eventId: entry.eventId, sequenceId: entry.sequenceId }))),
    [ { type: "error", eventId: null, sequenceId: 31 },
      { type: "thread_finished", eventId: 4, sequenceId: null },
      { type: "thread_log", eventId: 3, sequenceId: 21 },
      { type: "thread_log", eventId: 2, sequenceId: 20 },
      { type: "thread_started", eventId: 1, sequenceId: 10 }, ]);
  assert.equal(entries.filter((entry) => entry.event.type === "thread_log").length, 2);
});

scenario("Thread lifecycle, redaction, and coalescing", "detailed thread focus keeps user-facing outcomes while hiding technical event evidence", () => {
  ui.state.currentId = "evidence-session";
  ui.state.threadCycles.clear();
  const usage = { input_tokens: 100, cache_read_tokens: 40, output_tokens: 12, total_tokens: 222 };
  const events = [
    { type: "thread_started", name: "worker/evidence", action: "Inspect <unsafe>", source_threads: ["source/a", "source/b"] },
    { type: "model_call_started", thread_name: "worker/evidence", iteration: 3 },
    { type: "thread_log", name: "worker/evidence", line: "latest <log>" },
    { type: "tool_call_started", thread_name: "worker/evidence", call_id: "call-55", name: "read", args_detail: '{"path":"<secret>"}' },
    { type: "tool_call_finished", thread_name: "worker/evidence", call_id: "call-55", name: "read", content_preview: "preview <done>", is_error: false },
    { type: "future_worker_evidence", thread_name: "worker/evidence", field: "<future>" },
    { type: "error", thread_name: "worker/evidence", message: "structured <error>" },
    { type: "thread_finished", name: "worker/evidence", exit_code: 124, timed_out: true, timeout_reason: "tool <timeout>", usage },
  ];
  ui.state.events.set("evidence-session", events.map((event, index) => agentEnvelope(101 + index, event)));
  const snapshot = { metadata: { session_id: "evidence-session" },
    sessions: [{ session_id: "evidence-session", created_at: "session-created", updated_at: "session-updated" }],
    active_threads: [], messages: [], threads: [{
      name: "worker/evidence", session_id: "evidence-session", created_at: "thread-created",
      updated_at: "thread-updated", episode_count: 1, latest_action: "Inspect <unsafe>",
    }], thread_events: {}, thread_episodes: { "worker/evidence": [{
        id: 77, session_id: "evidence-session", thread_name: "worker/evidence",
        created_at: "episode-created", action: "Durable <action>", content: "Retained response",
      }], }, thread_steering: [{
      id: 12, session_id: "evidence-session", thread_name: "worker/evidence", status: "delivered",
      instruction: "Steer <carefully>", created_at: "steering-created", delivered_at: "steering-delivered", expired_at: null,
    }], };
  ui.state.threadEventWindows.set("evidence-session:worker/evidence", {
    afterSequence: 108, events: events.map((event, index) => ({
      id: 501 + index,
      created_at: index === 0 ? "start-time" : index === 7 ? "finish-time" : `event-time-${index + 1}`,
      event, })).reverse(), hasOlder: false, loading: false, });
  const model = ui.buildThreadModels(snapshot).find((item) => item.name === "worker/evidence");
  assert.equal(model.state, "finished");
  assert.deepEqual(plain(model.provenance), ["persisted", "observed"]);
  assert.deepEqual(plain(model.iterations), [3]);
  assert.equal(model.latestLog, "latest <log>");
  assert.equal(model.latestError, "structured <error>");
  assert.deepEqual(plain(model.usageEvidence.usage), usage);
  const html = ui.renderThreadFocus("worker/evidence", model, snapshot);
  assert.match(html, /<h3>Episodes<\/h3>/);
  assert.match(html, /<h3>Lifecycle<\/h3>/);
  assert.ok(html.indexOf("<h3>Episodes</h3>") < html.indexOf("<h3>Lifecycle</h3>"));
  assert.doesNotMatch(html, /<h3>Durable episodes<\/h3>|<h3>Lifecycle evidence<\/h3>/);
  for (const value of [
    "session-created", "session-updated", "thread-created", "thread-updated", "2 source threads · source/a, source/b",
    "start-time", "finish-time", "tool &lt;timeout&gt;", "structured &lt;error&gt;", "latest &lt;log&gt;",
    "Read", "Done", "path: &lt;secret&gt;", "Activity recorded",
    "steering-created", "steering-delivered", "Episode 1 · ID 77", "episode-created", "Durable &lt;action&gt;",
  ]) assert.match(html, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /<dt>Input<\/dt><dd>100<\/dd>/);
  assert.match(html, /<dt>Cache read<\/dt><dd>40<\/dd>/);
  assert.match(html, /<dt>Output<\/dt><dd>12<\/dd>/);
  assert.match(html, /<dt>Context<\/dt><dd>222<\/dd>/);
  assert.doesNotMatch(html, /call-55|preview &lt;done&gt;|future_worker_evidence|&lt;future&gt;/);
  assert.doesNotMatch(html, /data-provenance=|observed live|<dt>Provenance<\/dt>|actions in view|Start sequence|Finish sequence|Start event ID|Finish event ID/);
  assert.doesNotMatch(html, /usage unavailable|latest retained response/);
  assert.doesNotMatch(html, /<unsafe>|<secret>|<error>|<timeout>|<future>/);
});

scenario("Thread lifecycle, redaction, and coalescing", "missing lifecycle evidence is labeled unavailable rather than synthesized", () => {
  const snapshot = { metadata: { session_id: "history-session" },
    sessions: [{ session_id: "history-session", created_at: "created", updated_at: "updated" }],
    active_threads: [], messages: [],
    threads: [{ name: "history", session_id: "history-session", episode_count: 0 }],
    thread_events: {}, thread_episodes: {}, thread_steering: [], };
  const model = ui.buildThreadModels(snapshot)[0];
  assert.equal(model.state, "finished");
  assert.equal(model.outcome, "no start/finish lifecycle evidence in the current window");
  const html = ui.renderThreadEvidence("history", model, snapshot, []);
  assert.match(html, /No start event in current evidence/);
  assert.match(html, /No model-call iteration events/);
  assert.equal(occurrences(html, /<span class="evidence-unavailable">Unavailable<\/span>/g), 4);
  assert.doesNotMatch(html, /exit 0|timed out.*no/i);
});

scenario("Thread lifecycle, redaction, and coalescing", "orchestrator actions retain iterations, matched completion previews, call IDs, generic fallback, and focus activity", () => {
  ui.state.currentId = "orchestrator-evidence";
  ui.state.events.set("orchestrator-evidence", [
    { sequence_id: 1, run_id: "run-evidence", event: { type: "run_started", prompt_preview: "begin", started_at_epoch_ms: 1_700_000_000_000 } },
    agentEnvelope(2, { type: "model_call_started", thread_name: null, iteration: 4 }),
    agentEnvelope(3, { type: "tool_call_started", thread_name: null, call_id: "orch-call", name: "read", args_detail: '{"path":"README.md"}' }),
    agentEnvelope(4, { type: "tool_call_finished", thread_name: null, call_id: "orch-call", name: "read", content_preview: "matched preview", is_error: false }),
    agentEnvelope(5, { type: "future_orchestrator_signal", thread_name: null, payload: "future" }),
    { sequence_id: 6, run_id: "run-evidence", event: { type: "run_completed", response: "complete", duration_ms: 88 } },
  ]);
  const snapshot = {
    metadata: { session_id: "orchestrator-evidence" }, active_run: null, messages: [], active_threads: [],
    threads: [], thread_events: {}, thread_episodes: {}, thread_steering: [], worksets: { items: [], error: null },
    sessions: [{ session_id: "orchestrator-evidence", created_at: "orch-created", updated_at: "orch-updated" }],
  };
  const actions = ui.buildOrchestratorActions(snapshot, { limit: false });
  assert.ok(actions.some((action) => action.name === "model" && action.result === "iteration 4"));
  const tool = actions.find((action) => action.callId === "orch-call");
  assert.equal(tool.result, "done");
  assert.match(tool.detail, /call orch-call.*path: README.md.*result: matched preview/);
  assert.ok(actions.some((action) => action.name === "future_orchestrator_signal" && /payload/.test(action.detail)));
  assert.equal(ui.orchestratorLifecycle(snapshot).state, "completed");
  const html = ui.renderOrchestratorConversation(snapshot);
  assert.match(html, /data-state="completed"/);
  assert.match(html, /sequence #6/);
  assert.match(html, /future_orchestrator_signal/);
  assert.doesNotMatch(html, /orch-created|orch-updated|Run lifecycle|Thread states/);
});
scenario("Thread lifecycle, redaction, and coalescing", "thread fullscreen activity is newest-first with failures in event order", () => {
  ui.state.currentId = "thread-order";
  ui.state.events.set("thread-order", [
    agentEnvelope(41, { type: "thread_steering_expired", name: "worker", steering_id: 9, instruction_preview: "too late" }),
    agentEnvelope(42, { type: "error", thread_name: "worker", message: "worker failed" }),
  ]);
  const actions = ui.threadFocusActions("worker", { thread_episodes: {} }, {
    afterSequence: 40, events: [
      { id: 12, event: { type: "tool_call_finished", thread_name: "worker", name: "read", is_error: true, content_preview: "missing" } },
      { id: 11, event: { type: "thread_steering_queued", name: "worker", steering_id: 9, instruction_preview: "too late" } },
    ], });
  assert.deepEqual(
    plain(actions.map(({ name, result, detail }) => ({ name, result, detail }))),
    [ { name: "error", result: "failed", detail: "worker failed" },
      { name: "steering", result: "expired", detail: "steering #9 · too late" },
      { name: "Read", result: "Failed", detail: "Error: missing" },
      { name: "steering", result: "queued", detail: "steering #9 · too late" },
    ]);
  ui.state.events.delete("thread-order");
  ui.state.currentId = null;
});

scenario("Thread lifecycle, redaction, and coalescing", "thread focus hides dedicated usage rows without changing usage summaries or header totals", () => {
  ui.state.currentId = "thread-usage-session";
  const start = { ...agentEnvelope(10, { type: "thread_started", name: "worker", action: "measure", source_threads: [] }), run_id: "run-live" };
  const usageEnvelope = { ...agentEnvelope(11, {
    type: "token_usage_updated", thread_name: "worker",
    usage: { input_tokens: 20, output_tokens: 4, cache_read_tokens: 8, total_tokens: 240 },
  }), run_id: "run-live" };
  ui.state.events.set("thread-usage-session", [start, usageEnvelope]);
  const snapshot = { metadata: { session_id: "thread-usage-session" },
    active_run: { run_id: "run-live" }, active_threads: ["worker"],
    response_timing: { cumulative_token_usage: {
      input_tokens: 100, output_tokens: 20, cache_read_tokens: 40, total_tokens: 500,
    } }, threads: [{ name: "worker" }],
    thread_events: {}, thread_episodes: {}, thread_steering: [], messages: [],
  };
  const actions = ui.threadFocusActions("worker", snapshot, { afterSequence: 0, events: [] });
  assert.deepEqual(plain(actions.map((action) => action.name)), ["dispatch"]);
  assert.ok(actions.every((action) => action.kind !== "token_usage_updated"));
  const model = ui.buildThreadModels(snapshot).find((thread) => thread.name === "worker");
  assert.equal(model.usageEvidence.kind, "token_usage_updated");
  const evidenceHtml = ui.renderThreadEvidence("worker", model, snapshot, model.entries);
  assert.match(evidenceHtml, /<h4>Worker usage<\/h4>/);
  assert.match(evidenceHtml, /<dt>Input<\/dt><dd>20<\/dd>/);
  assert.deepEqual(plain(ui.displayedTokenUsage(snapshot, "thread-usage-session", [start, usageEnvelope])), {
    input_tokens: 120, output_tokens: 24, cache_read_tokens: 48,
    cache_write_tokens: 0, reasoning_tokens: 0, total_tokens: 500, });
});

scenario("Thread lifecycle, redaction, and coalescing", "thread model rows pair returned text chronologically and bound retained fallbacks to the final successful call", () => {
  const entry = (event, sequenceId) => ({ event, provenance: "persisted", sequenceId });
  const paired = ui.threadActionsFromEntries([
    entry({ type: "thread_started", name: "worker", action: "work" }, 1),
    entry({ type: "model_call_started", thread_name: "worker", iteration: 1 }, 2),
    entry({ type: "tool_call_started", thread_name: "worker", call_id: "tool-1", name: "read" }, 3),
    entry({ type: "tool_call_finished", thread_name: "worker", call_id: "tool-1", name: "read", is_error: false }, 4),
    entry({ type: "model_call_started", thread_name: "worker", iteration: 2 }, 5),
    entry({ type: "assistant_message", thread_name: "worker", content: "  Final model answer  " }, 6),
    entry({ type: "thread_finished", name: "worker", exit_code: 0, timed_out: false }, 7),
  ], { content: "Retained answer" });
  const pairedModels = paired.filter((action) => action.name === "model");
  assert.equal(pairedModels[0].detail, "Returned text unavailable");
  assert.equal(pairedModels[1].detail, "Final model answer");
  assert.equal(paired.filter((action) => action.name === "response").length, 0);
  const paginated = ui.threadActionsFromEntries([
    entry({ type: "assistant_message", thread_name: "worker", content: "Start omitted by pagination" }, 8),
  ], null);
  assert.deepEqual(plain(paginated.map(({ name, detail }) => ({ name, detail }))), [
    { name: "response", detail: "Start omitted by pagination" }, ]);
  const fallback = ui.threadActionsFromEntries([
    entry({ type: "model_call_started", thread_name: "worker", iteration: 3 }, 9),
    entry({ type: "model_call_started", thread_name: "worker", iteration: 4 }, 10),
    entry({ type: "thread_finished", name: "worker", exit_code: 0, timed_out: false }, 11),
  ], { content: "Durable final text" });
  const fallbackModels = fallback.filter((action) => action.name === "model");
  assert.equal(fallbackModels[0].detail, "Returned text unavailable");
  assert.equal(fallbackModels[1].detail, "Final-call fallback from latest retained episode: Durable final text");
  const unavailable = ui.threadActionsFromEntries([
    entry({ type: "model_call_started", thread_name: "worker", iteration: 5 }, 12),
    entry({ type: "thread_finished", name: "worker", exit_code: 7, timed_out: false }, 13),
  ], { content: "Must not mask a failed call" });
  assert.equal(unavailable.find((action) => action.name === "model").detail, "Returned text unavailable");
});

scenario("Thread lifecycle, redaction, and coalescing", "whitespace-only assistant text stays paired but permits retained fallback only for the final successful model", () => {
  const entry = (event, sequenceId) => ({ event, provenance: "persisted", sequenceId });
  const finalWhitespace = ui.threadActionsFromEntries([
    entry({ type: "model_call_started", thread_name: "worker", iteration: 1 }, 1),
    entry({ type: "assistant_message", thread_name: "worker", content: " \n\t " }, 2),
    entry({ type: "thread_finished", name: "worker", exit_code: 0, timed_out: false }, 3),
  ], { content: "Durable final text" });
  assert.equal(finalWhitespace.find((action) => action.name === "model").detail, "Final-call fallback from latest retained episode: Durable final text");
  assert.equal(finalWhitespace.filter((action) => action.name === "response").length, 0);
  const nonFinalWhitespace = ui.threadActionsFromEntries([
    entry({ type: "model_call_started", thread_name: "worker", iteration: 1 }, 4),
    entry({ type: "assistant_message", thread_name: "worker", content: " \n\t " }, 5),
    entry({ type: "model_call_started", thread_name: "worker", iteration: 2 }, 6),
    entry({ type: "assistant_message", thread_name: "worker", content: "Usable final text" }, 7),
    entry({ type: "thread_finished", name: "worker", exit_code: 0, timed_out: false }, 8),
  ], { content: "Must not replace a usable final response" });
  const modelDetails = nonFinalWhitespace.filter((action) => action.name === "model").map((action) => action.detail);
  assert.deepEqual(plain(modelDetails), ["Returned text unavailable", "Usable final text"]);
  assert.equal(nonFinalWhitespace.filter((action) => action.name === "response").length, 0);
  const failedWhitespace = ui.threadActionsFromEntries([
    entry({ type: "model_call_started", thread_name: "worker", iteration: 3 }, 9),
    entry({ type: "assistant_message", thread_name: "worker", content: " \n\t " }, 10),
    entry({ type: "thread_finished", name: "worker", exit_code: 7, timed_out: false }, 11),
  ], { content: "Must not mask a failed call" });
  assert.equal(failedWhitespace.find((action) => action.name === "model").detail, "Returned text unavailable");
  assert.equal(failedWhitespace.filter((action) => action.name === "response").length, 0);
  const blankPaginated = ui.threadActionsFromEntries([
    entry({ type: "assistant_message", thread_name: "worker", content: " \n\t " }, 12),
  ], null);
  assert.deepEqual(plain(blankPaginated), []);
  assert.deepEqual(plain(ui.buildThreadActions("worker", [
    { type: "assistant_message", thread_name: "worker", content: " \n\t " },
  ], { thread_episodes: {}, thread_steering: [] })), []);
});

scenario("Thread lifecycle, redaction, and coalescing", "thread lifecycle coalesces tools, keeps running and failed outcomes, and suppresses duplicate run markers", () => {
  const entry = (event, sequenceId) => ({ event, provenance: "observed", sequenceId, eventId: 100 + sequenceId });
  const actions = ui.threadActionsFromEntries([
    entry({ type: "run_started", thread_name: "worker", prompt_preview: "generic start" }, 1),
    entry({ type: "thread_started", name: "worker", action: "Canonical dispatch", source_threads: [] }, 2),
    entry({ type: "model_call_started", thread_name: "worker", iteration: 4 }, 3),
    entry({ type: "assistant_message", thread_name: "worker", content: "Model response text" }, 4),
    entry({ type: "tool_call_started", thread_name: "worker", call_id: "internal-success", name: "read", args_detail: '{"path":"README.md","limit":10}' }, 5),
    entry({ type: "tool_call_finished", thread_name: "worker", call_id: "internal-success", name: "read", content_preview: "raw successful result must stay hidden", is_error: false }, 6),
    entry({ type: "tool_call_started", thread_name: "worker", call_id: "internal-running", name: "exec_command", args_detail: '{"cmd":"npm test","workdir":"/repo"}' }, 7),
    entry({ type: "tool_call_started", thread_name: "worker", call_id: "internal-failure", name: "edit", args_detail: '{"path":"src/app.js","old_text":"private old","new_text":"private new"}' }, 8),
    entry({ type: "tool_call_finished", thread_name: "worker", call_id: "internal-failure", name: "edit", content_preview: '{"message":"edit failed token=top-secret","headers":{"Authorization":"hidden"}}', is_error: true }, 9),
    entry({ type: "tool_call_started", thread_name: "worker", call_id: "internal-unknown", name: "mcp__vendor__custom_lookup", args_detail: '{"query":"safe","body":"hidden"}' }, 10),
    entry({ type: "future_worker_signal", thread_name: "worker", payload: { secret: "hidden" } }, 11),
    entry({ type: "error", thread_name: "worker", message: "Explicit dispatch error" }, 12),
    entry({ type: "thread_finished", name: "worker", exit_code: 9, timed_out: true, timeout_reason: "deadline reached", usage: { input_tokens: 99 } }, 13),
    entry({ type: "run_finished", thread_name: "worker" }, 14),
  ], null);
  assert.equal(actions.filter((action) => action.callId === "internal-success").length, 1);
  const done = actions.find((action) => action.callId === "internal-success");
  assert.deepEqual(plain({ name: done.name, result: done.result, detail: done.detail, finishSequenceId: done.finishSequenceId }), {
    name: "Read", result: "Done", detail: "path: README.md · limit: 10", finishSequenceId: 6,
  });
  assert.doesNotMatch(done.detail, /internal-success|raw successful result/);
  const running = actions.find((action) => action.callId === "internal-running");
  assert.deepEqual(plain({ name: running.name, result: running.result, detail: running.detail }), {
    name: "Command", result: "Running", detail: "command: npm test · workdir: /repo",
  });
  const failed = actions.find((action) => action.callId === "internal-failure");
  assert.equal(failed.result, "Failed");
  assert.match(failed.detail, /^path: src\/app.js · old: 11 chars · new: 11 chars · Error: message: edit failed token=\[redacted\]$/);
  assert.doesNotMatch(failed.detail, /private old|private new|top-secret|Authorization|hidden/);
  const unknownTool = actions.find((action) => action.callId === "internal-unknown");
  assert.deepEqual(plain({ name: unknownTool.name, result: unknownTool.result, detail: unknownTool.detail }), {
    name: "Custom lookup", result: "Running", detail: "query: safe",
  });
  assert.ok(actions.some((action) => action.name === "Activity" && action.detail === "Activity recorded"));
  assert.ok(actions.some((action) => action.name === "error" && action.detail === "Explicit dispatch error"));
  assert.equal(actions.find((action) => action.name === "model").detail, "Model response text");
  assert.equal(actions.filter((action) => action.name === "agent run").length, 0);
  assert.equal(actions.find((action) => action.name === "thread").detail, "exit 9 · timed out: deadline reached");
  assert.ok(actions.every((action) => !/input 99|latest retained response/.test(action.detail || "")));
  const genericOnly = ui.threadActionsFromEntries([
    entry({ type: "run_started", thread_name: "worker", prompt_preview: "only start evidence" }, 20),
    entry({ type: "run_finished", thread_name: "worker" }, 21),
  ], null);
  assert.deepEqual(plain(genericOnly.map(({ name, result }) => ({ name, result }))), [
    { name: "agent run", result: "started" },
    { name: "agent run", result: "finished" }, ]);
});

scenario("Thread lifecycle, redaction, and coalescing", "tile thread actions use the same coalesced tool outcomes", () => {
  const actions = ui.buildThreadActions("worker", [
    agentEnvelope(1, { type: "tool_call_started", thread_name: "worker", call_id: "tile-call", name: "write", args_detail: '{"path":"out.txt","content":"private tile body"}' }),
    agentEnvelope(2, { type: "tool_call_finished", thread_name: "worker", call_id: "tile-call", name: "write", content_preview: "private result", is_error: false }),
  ], { thread_episodes: {}, thread_steering: [] });
  assert.equal(actions.length, 1);
  assert.deepEqual(plain({ name: actions[0].name, result: actions[0].result, detail: actions[0].detail }), {
    name: "Write", result: "Done", detail: "path: out.txt · content: 17 chars",
  });
  const html = ui.renderActionRows(actions, "empty");
  assert.doesNotMatch(html, /tile-call|private tile body|private result|persisted|observed|tool_call/);
});

scenario("Thread lifecycle, redaction, and coalescing", "durable steering evidence supplements observed actions without duplicating observed IDs", () => {
  const snapshot = { thread_episodes: {}, thread_steering: [
      { id: 1, thread_name: "worker", session_id: "session", status: "delivered", instruction: "already seen", created_at: "created-1", delivered_at: "delivered-1" },
      { id: 2, thread_name: "worker", session_id: "session", status: "expired", instruction: "durable only", created_at: "created-2", expired_at: "expired-2" },
    ], };
  const actions = ui.buildThreadActions("worker", [
    agentEnvelope(7, { type: "thread_steering_delivered", name: "worker", steering_id: 1, instruction_preview: "already seen" }),
    agentEnvelope(8, { type: "error", thread_name: "worker", message: "ordered failure" }),
  ], snapshot);
  assert.equal(actions.length, 3);
  assert.equal(actions.filter((action) => action.steeringId === 1).length, 1);
  assert.equal(actions.filter((action) => action.steeringId === 2).length, 1);
  assert.match(actions.at(-1).detail, /durable only · created created-2 · expired expired-2/);
});

scenario("Thread lifecycle, redaction, and coalescing", "thread tiles group live work first and order finished work by recency", () => {
  const snapshot = { active_threads: ["queued", "running"], threads: [
      { name: "finished-old", updated_at: "2026-01-01T00:00:00Z" },
      { name: "queued", updated_at: "2026-01-04T00:00:00Z" },
      { name: "finished-new", updated_at: "2026-01-03T00:00:00Z" },
      { name: "running", updated_at: "2026-01-02T00:00:00Z" }, ],
    thread_episodes: {}, thread_steering: [], thread_events: {
      running: [{ type: "thread_started", name: "running", action: "work" }],
      "finished-old": [
        { type: "thread_started", name: "finished-old", action: "work" },
        { type: "thread_finished", name: "finished-old", exit_code: 0, timed_out: false },
      ], "finished-new": [
        { type: "thread_started", name: "finished-new", action: "work" },
        { type: "thread_finished", name: "finished-new", exit_code: 0, timed_out: false },
      ], }, };
  assert.deepEqual(
    plain(ui.buildThreadModels(snapshot).map(({ name, state, compact }) => ({ name, state, compact }))),
    [ { name: "running", state: "running", compact: false },
      { name: "queued", state: "queued", compact: false },
      { name: "finished-new", state: "finished", compact: true },
      { name: "finished-old", state: "finished", compact: true }, ],
  );
});

scenario("Thread lifecycle, redaction, and coalescing", "a persisted exit wins over active membership when restoring thread state", () => {
  const models = ui.buildThreadModels({ active_threads: ["worker"],
    threads: [{ name: "worker", updated_at: "2026-01-01T00:00:00Z" }],
    thread_episodes: {}, thread_steering: [], thread_events: {
      worker: [
        { type: "thread_started", name: "worker", action: "work" },
        { type: "thread_finished", name: "worker", exit_code: 0, timed_out: false },
      ], }, });
  assert.equal(models[0].state, "finished");
  assert.equal(models[0].compact, false);
});

scenario("Thread lifecycle, redaction, and coalescing", "finished dispatches after the latest user turn remain full tiles", () => {
  ui.state.currentId = "cycle-dispatch";
  ui.state.threadCycles.clear();
  const models = ui.buildThreadModels({
    metadata: { session_id: "cycle-dispatch" }, active_threads: [],
    threads: [
      { name: "current", updated_at: "2026-01-02T00:00:00Z" },
      { name: "earlier", updated_at: "2026-01-01T00:00:00Z" }, ],
    thread_episodes: {}, thread_steering: [], thread_events: {},
    messages: [ { role: "user", content: "older request" },
      { role: "assistant", tool_calls: [{ function: { name: "thread", arguments: JSON.stringify({ name: "earlier" }) } }] },
      { role: "user", content: "current request" },
      { role: "assistant", tool_calls: [{ function: { name: "thread", arguments: JSON.stringify({ name: "current" }) } }] },
    ], });
  assert.deepEqual(
    plain(models.map(({ name, compact }) => ({ name, compact }))), [
      { name: "current", compact: false },
      { name: "earlier", compact: true }, ]);
});

scenario("Thread lifecycle, redaction, and coalescing", "activation enrolls a thread for the remainder of its current cycle", () => {
  ui.state.currentId = "cycle-activation";
  ui.state.threadCycles.clear();
  const base = { metadata: { session_id: "cycle-activation" },
    threads: [{ name: "resumed", updated_at: "2026-01-01T00:00:00Z" }],
    thread_episodes: {}, thread_steering: [],
    messages: [{ role: "user", content: "current request" }], };
  const active = ui.buildThreadModels({ ...base, active_threads: ["resumed"], thread_events: {} });
  assert.equal(active[0].compact, false);
  const finished = ui.buildThreadModels({ ...base, active_threads: [],
    thread_events: { resumed: [
        { type: "thread_started", name: "resumed", action: "resume" },
        { type: "thread_finished", name: "resumed", exit_code: 0, timed_out: false },
      ], }, });
  assert.equal(finished[0].state, "finished");
  assert.equal(finished[0].compact, false);
  const nextCycle = ui.buildThreadModels({ ...base,
    active_threads: [], thread_events: {}, messages: [
      { role: "user", content: "current request" },
      { role: "user", content: "next request" }, ], });
  assert.equal(nextCycle[0].compact, true);
});

scenario("Thread lifecycle, redaction, and coalescing", "compact thread strips contain only the title bar and fullscreen affordance", () => {
  const compact = ui.renderThreadTile({ name: "ancient/thread",
    state: "finished", compact: true,
    actions: [{ name: "read", result: "done", state: "done" }], });
  assert.match(compact, /thread-tile is-compact/);
  assert.match(compact, /ancient\/thread/);
  assert.match(compact, /data-focus-thread="ancient\/thread"/);
  assert.match(compact, /class="thread-state" aria-label="Finished">Finished<\/span>/);
  assert.doesNotMatch(compact, /action-ledger|action-name/);
});

scenario("Thread lifecycle, redaction, and coalescing", "thread action ledger retains model iterations and matched tool completion evidence", () => {
  const events = [
    agentEnvelope(1, { type: "model_call_started", thread_name: "worker", iteration: 1 }),
    agentEnvelope(2, { type: "tool_call_started",
      thread_name: "worker", call_id: "call-1",
      name: "mcp__exa_web_search__web_fetch_exa",
      args_detail: JSON.stringify({ maxCharacters: 6000, urls: ["https://example.com"] }),
    }), agentEnvelope(3, { type: "tool_call_finished",
      thread_name: "worker", call_id: "call-1",
      name: "mcp__exa_web_search__web_fetch_exa", is_error: false, }),
    agentEnvelope(4, { type: "assistant_message", thread_name: "worker", content: "Verified result" }),
    agentEnvelope(5, { type: "thread_finished", name: "worker", exit_code: 0, timed_out: false }),
  ];
  const snapshot = {
    thread_episodes: { worker: [{ action: "Research", content: "Full retained episode" }] },
    thread_steering: [], };
  const actions = ui.buildThreadActions("worker", events, snapshot);
  assert.deepEqual(plain(actions.map(({ name, result }) => ({ name, result }))), [
    { name: "model", result: "iteration 1" },
    { name: "Web fetch", result: "Done" },
    { name: "thread", result: "finished" }, ]);
  assert.equal(actions[0].detail, "Verified result");
  assert.equal(actions[1].detail, "url: https://example.com · urls: 1");
  assert.doesNotMatch(actions[1].detail, /call-1|Result preview|result:/);
  assert.equal(actions[2].detail, "exit 0 · not timed out");
});

scenario("Thread lifecycle, redaction, and coalescing", "retained thread actions use episodes without synthetic latest-action filler", () => {
  const actions = ui.buildRetainedThreadActions( "worker",
    { latest_action: "Inspect the database" }, { thread_episodes: {
        worker: [ { content: "First response" },
          { content: "Latest response" }, ], }, });
  assert.deepEqual(plain(actions.map(({ name, result }) => ({ name, result }))), [
    { name: "episode", result: "retained" },
    { name: "episode", result: "retained" }, ]);
  assert.match(actions.find((action) => action.name === "episode" && /Latest response/.test(action.detail)).detail, /Episode ID unavailable · Latest response/);
  assert.ok(actions.every((action) => action.name !== "latest action"));
});

scenario("Thread lifecycle, redaction, and coalescing", "persisted latest_action is omitted from ledgers while episode actions remain available", () => {
  ui.state.currentId = "latest-action-session";
  ui.state.events.set("latest-action-session", [
    agentEnvelope(1, { type: "thread_started", name: "worker/live", action: "live dispatch", source_threads: [] }),
  ]);
  const snapshot = {
    metadata: { session_id: "latest-action-session" }, messages: [],
    active_threads: ["worker/live"],
    threads: [{ name: "worker/live", session_id: "latest-action-session", latest_action: "Persisted <latest> action" }],
    thread_events: {},
    thread_episodes: { "worker/live": [{ id: 9, action: "Persisted <latest> action", content: "Retained response" }] },
    thread_steering: [], };
  const model = ui.buildThreadModels(snapshot)[0];
  assert.ok(model.actions.some((action) => action.name === "dispatch"));
  assert.ok(model.actions.every((action) => action.name !== "latest action"));
  assert.doesNotMatch(ui.renderThreadTile(model), /latest action|Persisted &lt;latest&gt; action/);
  const focus = ui.renderThreadFocus("worker/live", model, snapshot);
  assert.doesNotMatch(focus, /<strong>latest action<\/strong>|<span class="action-name">latest action<\/span>/);
  assert.match(focus, /<h3>Episodes<\/h3>[\s\S]*Persisted &lt;latest&gt; action/);
});

scenario("Thread lifecycle, redaction, and coalescing", "tile ledgers render exactly the five most recent actions", () => {
  const actions = Array.from({ length: 7 }, (_, index) => ({
    name: `action-${index + 1}`, result: "done", state: "done",
    detail: `<detail-${index + 1}>`, }));
  const html = ui.renderActionRows(actions, "empty");
  assert.equal(occurrences(html, /class="action-row/g), 5);
  assert.doesNotMatch(html, /action-1|action-2/);
  assert.match(html, /action-3/);
  assert.match(html, /&lt;detail-7&gt;/);
});

scenario("Thread lifecycle, redaction, and coalescing", "empty tile ledgers retain five rows and one quiet status message", () => {
  const html = ui.renderActionRows([], "Awaiting first action");
  assert.equal(occurrences(html, /class="action-row/g), 5);
  assert.equal(occurrences(html, /Awaiting first action/g), 1);
});

scenario("Thread lifecycle, redaction, and coalescing", "tool summaries cover native tools without exposing write, edit, or terminal content", () => {
  const format = (name, args) => ui.formatToolArguments(name, JSON.stringify(args), "");
  assert.equal(format("read", { path: "/repo/src/app.js", offset: 20, limit: 40 }), "path: /repo/src/app.js · offset: 20 · limit: 40");
  const command = format("exec_command", {
    cmd: `curl -H "Authorization: Bearer topsecret" --data '{"token":"also-secret"}' https://example.test?api_key=url-secret`,
    workdir: "/repo", });
  assert.match(command, /^command: curl -H \[redacted\] --data \[redacted\]/);
  assert.match(command, /api_key=\[redacted\].*workdir: \/repo/);
  assert.doesNotMatch(command, /topsecret|also-secret|url-secret/);
  assert.equal(format("shell", { command: "pwd", workdir: "/repo" }), "command: pwd · workdir: /repo");
  assert.equal(format("exec_command", { cmd: "apply_patch <<'PATCH'\n*** Begin Patch\nprivate patch\nPATCH" }), "command: apply_patch [content omitted]");
  const write = format("write", { path: "/tmp/out.txt", content: "SECRET body", token: "hidden" });
  assert.equal(write, "path: /tmp/out.txt · content: 11 chars");
  assert.doesNotMatch(write, /SECRET|hidden/);
  const edit = format("edit", { path: "/tmp/out.txt", old_text: "old secret", new_text: "new secret text", patch: "private patch" });
  assert.equal(edit, "path: /tmp/out.txt · old: 10 chars · new: 15 chars");
  assert.doesNotMatch(edit, /old secret|new secret|private patch/);
  assert.equal(format("write_stdin", { session_id: "term-7", chars: "" }), "session: term-7 · poll");
  assert.equal(format("write_stdin", { session_id: "term-7", chars: "<C-c>" }), "session: term-7 · input: 5 chars");
  assert.doesNotMatch(format("write_stdin", { session_id: "term-7", chars: "typed secret" }), /typed secret/);
});

scenario("Thread lifecycle, redaction, and coalescing", "tool summaries cover thread, workset, search, context, fetch, and safe unknown fallbacks", () => {
  const format = (name, args) => ui.formatToolArguments(name, JSON.stringify(args), "");
  assert.equal(format("thread", { name: "worker/a", action: "Inspect state", threads: ["one", "two"], timeout: 90 }), "name: worker/a · action: Inspect state · sources: 2");
  assert.equal(format("thread_read", { name: "worker/a" }), "name: worker/a");
  assert.equal(format("workset_define", { id: "ws-1", status: "active", workset_items: [{}, {}, {}], summary: "hidden body" }), "id: ws-1 · status: active · items: 3");
  assert.equal(format("mcp__grep_app__searchgithub", {
    query: "useState(", repo: "facebook/react", path: "src", language: ["TypeScript"], token: "hidden",
  }), "query: useState( · repo: facebook/react · path: src");
  assert.equal(format("mcp__context7__query_docs", { libraryId: "/vercel/next.js", query: "routing", authorization: "hidden" }), "query: routing · library: /vercel/next.js");
  assert.equal(format("mcp__exa_web_search__web_fetch_exa", {
    urls: ["https://user:pass@example.test/page?token=secret", "https://second.test"], maxCharacters: 6000,
  }), "url: https://[redacted]@example.test/page?token=[redacted] · urls: 2");
  const unknown = format("mcp__vendor__custom_lookup", {
    query: "safe context", path: "/repo", token: "never", headers: { Authorization: "never" }, body: "never", nested: { secret: "never" },
  });
  assert.equal(unknown, "query: safe context · path: /repo");
  assert.doesNotMatch(unknown, /never|headers|body|nested|\{|\}/);
  assert.equal(format("custom_tool", { query: "authorization: Bearer inline-secret" }), "query: authorization: [redacted]");
  assert.equal(ui.formatToolArguments("custom_tool", "{malformed", ""), "Arguments unavailable");
  assert.equal(format("custom_tool", { headers: { Authorization: "secret" }, body: "secret" }), "Arguments available but hidden");
  const bounded = format("custom_tool", { query: "x".repeat(500), path: "/" + "y".repeat(500) });
  assert.ok(bounded.length <= 280);
  assert.match(bounded, /…/);
  assert.equal(ui.compactActionDetail("  a\n b   c "), "a b c");
  assert.equal(ui.compactActionDetail("x".repeat(400), 20).length, 20);
});

scenario("Thread lifecycle, redaction, and coalescing", "tool summaries recursively redact structured values, encoded URLs, and failed previews", () => {
  const format = (name, args) => ui.formatToolArguments(name, JSON.stringify(args), "");
  const structured = format("mcp__vendor__custom_lookup", {
    query: JSON.stringify({
      headers: { Authorization: "HEADER_MAP_LEAK", "X-Api-Key": "HEADER_KEY_LEAK" },
      nested: { SeCrEt: "NESTED_SECRET_LEAK", Access_Token: "ACCESS_TOKEN_LEAK" },
      safe: "visible", }), });
  assert.match(structured, /query: .*headers.*\[redacted\].*nested.*SeCrEt.*\[redacted\]/);
  assert.match(structured, /safe.*visible/);
  assert.doesNotMatch(structured, /HEADER_MAP_LEAK|HEADER_KEY_LEAK|NESTED_SECRET_LEAK|ACCESS_TOKEN_LEAK/);
  const headerPairs = format("mcp__vendor__custom_lookup", {
    query: JSON.stringify({ nested: [["Authorization", "Basic NESTED_BASIC_LEAK"]] }),
  });
  assert.match(headerPairs, /Authorization.*\[redacted\]/);
  assert.doesNotMatch(headerPairs, /NESTED_BASIC_LEAK/);
  for (const sensitiveKey of [
    "authorization", "headers", "api_key", "access_token", "refresh_token", "id_token", "bearer", "cookie",
    "password", "passwd", "secret", "credentials", "client_secret", "private_key",
  ]) { const marker = `LEAK_${sensitiveKey}`;
    const summary = format("mcp__vendor__custom_lookup", { query: JSON.stringify({ [sensitiveKey]: marker }) });
    assert.match(summary, /\[redacted\]/, sensitiveKey);
    assert.doesNotMatch(summary, new RegExp(marker), sensitiveKey); }
  const plainHeader = format("mcp__vendor__custom_lookup", { query: "headers: Authorization: Basic PLAIN_HEADER_LEAK" });
  assert.equal(plainHeader, "query: headers: [redacted]");
  assert.doesNotMatch(plainHeader, /PLAIN_HEADER_LEAK/);
  const fetched = format("mcp__exa_web_search__web_fetch_exa", {
    urls: ["https://user:p@ssw0rd@example.test/p?refresh%5Ftoken=REFRESH_TOKEN_LEAK&safe=visible"],
  });
  assert.match(fetched, /^url: https:\/\/\[redacted\]@example\.test\/p\?/);
  assert.match(fetched, /refresh%5Ftoken=\[redacted\]/);
  assert.doesNotMatch(fetched, /user|ssw0rd|REFRESH_TOKEN_LEAK/);
  const doubleEncoded = format("mcp__exa_web_search__web_fetch_exa", {
    url: "https://example.test/p?id%255Ftoken=ID_TOKEN_LEAK",
  });
  assert.match(doubleEncoded, /id%255Ftoken=\[redacted\]/);
  assert.doesNotMatch(doubleEncoded, /ID_TOKEN_LEAK/);
  assert.equal(format("mcp__exa_web_search__web_fetch_exa", {
    url: "https://example.test/p?refresh%5Ftoken%3DENCODED_TOKEN_LEAK",
  }), "url: https://example.test/p?refresh_token=[redacted] · urls: 1");
  const encodedFragment = format("mcp__exa_web_search__web_fetch_exa", {
    url: "https://example.test/cb#AcCeSs%5FToKeN%3DFRAGMENT_URL_LEAK",
  });
  assert.match(encodedFragment, /#AcCeSs_ToKeN=\[redacted\]/);
  assert.doesNotMatch(encodedFragment, /FRAGMENT_URL_LEAK/);
  assert.equal(format("mcp__exa_web_search__web_fetch_exa", {
    url: "https://example.test/docs#section-2",
  }), "url: https://example.test/docs#section-2 · urls: 1");
  assert.equal(format("mcp__exa_web_search__web_fetch_exa", {
    url: "https://example.test/app#route?tab=details",
  }), "url: https://example.test/app#route?tab=details · urls: 1");
  const events = [
    { type: "tool_call_started", thread_name: "worker", call_id: "failed-redaction", name: "read", args_detail: '{"path":"safe.txt"}' },
    {
      type: "tool_call_finished", thread_name: "worker", call_id: "failed-redaction", name: "read", is_error: true,
      content_preview: '{"message":"upstream {\\"headers\\":{\\"Authorization\\":\\"FAIL_HEADER_LEAK\\"},\\"nested\\":{\\"PassWd\\":\\"FAIL_PASSWORD_LEAK\\"}} at https://user:p@ss@example.test/p?access%5Ftoken=FAIL_URL_LEAK"}',
    }, ];
  const expanded = ui.threadActionsFromEntries(events.map((event, index) => ({ event, provenance: "observed", sequenceId: index + 1 })), null);
  const tile = ui.buildThreadActions("worker", events, { thread_episodes: {}, thread_steering: [] });
  for (const action of [expanded[0], tile[0]]) {
    assert.equal(action.result, "Failed");
    assert.match(action.detail, /Error: message: upstream/);
    assert.match(action.detail, /\[redacted\]/);
    assert.doesNotMatch(action.detail, /FAIL_HEADER_LEAK|FAIL_PASSWORD_LEAK|FAIL_URL_LEAK|user:p@ss/);
  }
});

scenario("Thread lifecycle, redaction, and coalescing", "remaining header-pair and fragment redaction is shared by expanded and tile tool rows", () => {
  const events = [ {
      type: "tool_call_started", thread_name: "worker", call_id: "header-array", name: "mcp__vendor__custom_lookup",
      args_detail: JSON.stringify({ query: JSON.stringify({ nested: [["Authorization", "Basic NESTED_BASIC_LEAK"]] }) }),
    },
    { type: "tool_call_finished", thread_name: "worker", call_id: "header-array", name: "mcp__vendor__custom_lookup", is_error: false },
    {
      type: "tool_call_started", thread_name: "worker", call_id: "fragment-url", name: "mcp__exa_web_search__web_fetch_exa",
      args_detail: JSON.stringify({ url: "https://example.test/cb#AcCeSs%5FToKeN%3DFRAGMENT_URL_LEAK" }),
    }, {
      type: "tool_call_finished", thread_name: "worker", call_id: "fragment-url", name: "mcp__exa_web_search__web_fetch_exa", is_error: true,
      content_preview: '{"message":"redirect https://example.test/cb#refresh_token=FAIL_FRAGMENT_LEAK"}',
    }, ];
  const expanded = ui.threadActionsFromEntries(events.map((event, index) => ({ event, provenance: "observed", sequenceId: index + 1 })), null);
  const tile = ui.buildThreadActions("worker", events, { thread_episodes: {}, thread_steering: [] });
  for (const actions of [expanded, tile]) {
    const visible = actions.map((action) => action.detail).join(" | ");
    assert.match(visible, /Authorization.*\[redacted\]/);
    assert.match(visible, /AcCeSs_ToKeN=\[redacted\]/);
    assert.match(visible, /refresh_token=\[redacted\]/);
    assert.doesNotMatch(visible, /NESTED_BASIC_LEAK|FRAGMENT_URL_LEAK|FAIL_FRAGMENT_LEAK/);
  }
});

scenario("Thread lifecycle, redaction, and coalescing", "command summaries omit inline writers and patches while preserving ordinary commands", () => {
  const format = (cmd) => ui.formatToolArguments("exec_command", JSON.stringify({ cmd, workdir: "/repo" }), "");
  const cases = [
    ["printf 'RAW_WRITE_BODY_LEAK' > out.txt", "command: printf [content omitted] > out.txt · workdir: /repo"],
    ["printf 'INLINE_PATCH_BODY_LEAK' | apply_patch", "command: printf [content omitted] | apply_patch · workdir: /repo"],
    ["patch -p0 <<< $'--- a/secret.txt\\n+++ b/secret.txt\\n@@\\n-PATCH_OLD_SECRET\\n+PATCH_NEW_SECRET'", "command: patch -p0 <<< [content omitted] · workdir: /repo"],
    ["echo 'INLINE_BODY_LEAK' >> notes.txt", "command: echo [content omitted] >> notes.txt · workdir: /repo"],
    ["cat > generated.txt <<'EOF'\nCAT_BODY_LEAK\nEOF", "command: cat > generated.txt [content omitted] · workdir: /repo"],
    ["python -c 'PYTHON_BODY_LEAK' > generated.txt", "command: python [content omitted] > generated.txt · workdir: /repo"],
    ["python -c 'FD_BODY_LEAK' 1> generated.txt", "command: python [content omitted] 1> generated.txt · workdir: /repo"],
    ["patch -p0 $'--- a/file\\n+++ b/file\\n@@\\n-old\\n+INLINE_PATCH_LEAK'", "command: patch -p0 [content omitted] · workdir: /repo"],
    ["git apply <(printf $'diff --git a/a b/a\\n--- a/a\\n+++ b/a\\n@@ -1 +1 @@\\n-PATCH_OLD_LEAK\\n+PATCH_NEW_LEAK')", "command: git apply [content omitted] · workdir: /repo"],
  ];
  for (const [command, expected] of cases) {
    const summary = format(command);
    assert.equal(summary, expected);
    assert.doesNotMatch(summary, /RAW_WRITE_BODY_LEAK|INLINE_PATCH_BODY_LEAK|PATCH_OLD_SECRET|PATCH_NEW_SECRET|INLINE_BODY_LEAK|CAT_BODY_LEAK|PYTHON_BODY_LEAK|FD_BODY_LEAK|INLINE_PATCH_LEAK|PATCH_OLD_LEAK|PATCH_NEW_LEAK/);
  }
  const envAndHeader = format("ACCESS_TOKEN=ENV_TOKEN_LEAK curl --header='Authorization: Bearer CURL_HEADER_LEAK' https://example.test");
  assert.match(envAndHeader, /ACCESS_TOKEN=\[redacted\]/);
  assert.match(envAndHeader, /--header=\[redacted\]/);
  assert.doesNotMatch(envAndHeader, /ENV_TOKEN_LEAK|CURL_HEADER_LEAK/);
  const curlCredentials = format("curl --user user:CURL_PASSWORD_LEAK --cookie session=CURL_COOKIE_LEAK https://example.test");
  assert.match(curlCredentials, /--user \[redacted\].*--cookie \[redacted\]/);
  assert.doesNotMatch(curlCredentials, /CURL_PASSWORD_LEAK|CURL_COOKIE_LEAK/);
  const attachedCurlCredentials = format("curl -H'Authorization: Bearer ATTACHED_HEADER_LEAK' -u'user:ATTACHED_PASSWORD_LEAK' https://example.test");
  assert.match(attachedCurlCredentials, /-H\[redacted\].*-u\[redacted\]/);
  assert.doesNotMatch(attachedCurlCredentials, /ATTACHED_HEADER_LEAK|ATTACHED_PASSWORD_LEAK/);
  const credentialUrl = format("curl https://user:p@ss@example.test/p?api%5Fkey=CURL_URL_LEAK");
  assert.match(credentialUrl, /https:\/\/\[redacted\]@example\.test\/p\?api%5Fkey=\[redacted\]/);
  assert.doesNotMatch(credentialUrl, /CURL_URL_LEAK|user:p@ss/);
  const awsCredential = format("AWS_SECRET_ACCESS_KEY=AWS_SECRET_KEY_LEAK curl https://example.test");
  assert.match(awsCredential, /AWS_SECRET_ACCESS_KEY=\[redacted\]/);
  assert.doesNotMatch(awsCredential, /AWS_SECRET_KEY_LEAK/);
  const curlPassphrase = format("curl --pass PRIVATE_KEY_PASSPHRASE_LEAK --key key.pem https://example.test");
  assert.match(curlPassphrase, /--pass \[redacted\] --key key\.pem/);
  assert.doesNotMatch(curlPassphrase, /PRIVATE_KEY_PASSPHRASE_LEAK/);
  const unsafeKeyArgument = format("curl --key INLINE_PRIVATE_KEY_LEAK https://example.test");
  assert.match(unsafeKeyArgument, /--key \[redacted\]/);
  assert.doesNotMatch(unsafeKeyArgument, /INLINE_PRIVATE_KEY_LEAK/);
  const curlHereString = format("curl --pass HERE_STRING_PASSWORD_LEAK <<< request-body");
  assert.equal(curlHereString, "command: curl --pass [redacted] <<< [content omitted] · workdir: /repo");
  assert.doesNotMatch(curlHereString, /HERE_STRING_PASSWORD_LEAK|request-body/);
  assert.equal(format("AWS_REGION=us-east-1 curl --user-agent nac-test --key key.pem https://example.test"), "command: AWS_REGION=us-east-1 curl --user-agent nac-test --key key.pem https://example.test · workdir: /repo");
  assert.equal(format("git apply --check patches/fix.patch"), "command: git apply --check patches/fix.patch · workdir: /repo");
  assert.equal(format("git grep 'needle' -- src && pwd"), "command: git grep 'needle' -- src && pwd · workdir: /repo");
  assert.equal(format("cat README.md"), "command: cat README.md · workdir: /repo");
  assert.equal(format("cargo test -p nac-server 2>/dev/null"), "command: cargo test -p nac-server 2>/dev/null · workdir: /repo");
});

scenario("Thread lifecycle, redaction, and coalescing", "tool coalescing uses collision-safe occurrence queues in expanded and tile paths", () => {
  const events = [
    { type: "tool_call_started", thread_name: "worker", call_id: "X", name: "read", args_detail: '{"path":"first.txt"}' },
    { type: "tool_call_started", thread_name: "worker", call_id: "X", name: "write", args_detail: '{"path":"second.txt","content":"body"}' },
    { type: "tool_call_finished", thread_name: "worker", call_id: "X", name: "read", is_error: false },
    { type: "tool_call_finished", thread_name: "worker", call_id: "X", name: "write", is_error: false },
    { type: "tool_call_started", thread_name: "worker", call_id: "same", name: "read", args_detail: '{"path":"third.txt"}' },
    { type: "tool_call_started", thread_name: "worker", call_id: "same", name: "read", args_detail: '{"path":"fourth.txt"}' },
    { type: "tool_call_finished", thread_name: "worker", call_id: "same", name: "read", is_error: false },
    { type: "tool_call_finished", thread_name: "worker", call_id: "same", name: "read", is_error: false },
    { type: "tool_call_started", thread_name: "worker", call_id: "fallback", name: "read", args_detail: '{"path":"fallback.txt"}' },
    { type: "tool_call_finished", thread_name: "worker", call_id: "fallback", name: "write", is_error: false },
    { type: "tool_call_started", thread_name: "worker", call_id: "start-only", name: "exec_command", args_detail: '{"cmd":"pwd"}' },
    { type: "tool_call_finished", thread_name: "worker", call_id: "finish-only", name: "exec_command", is_error: false },
  ];
  const project = (actions) => actions.map(({ name, result, detail, callId }) => ({ name, result, detail, callId }));
  const expanded = project(ui.threadActionsFromEntries(events.map((event, index) => ({
    event, provenance: "observed", sequenceId: index + 1, eventId: 100 + index,
  })), null));
  const tile = project(ui.buildThreadActions("worker", events, { thread_episodes: {}, thread_steering: [] }));
  assert.deepEqual(plain(expanded), plain(tile));
  assert.deepEqual(plain(expanded), [
    { name: "Read", result: "Done", detail: "path: first.txt", callId: "X" },
    { name: "Write", result: "Done", detail: "path: second.txt · content: 4 chars", callId: "X" },
    { name: "Read", result: "Done", detail: "path: third.txt", callId: "same" },
    { name: "Read", result: "Done", detail: "path: fourth.txt", callId: "same" },
    { name: "Read", result: "Done", detail: "path: fallback.txt", callId: "fallback" },
    { name: "Command", result: "Running", detail: "command: pwd", callId: "start-only" },
    { name: "Command", result: "Done", detail: "", callId: "finish-only" },
  ]);
});

test("orchestrator actions restore persisted calls and cap the live ledger", () => {
  ui.state.currentId = "session";
  ui.state.events.set("session", []);
  const persisted = ui.buildOrchestratorActions({ thread_steering: [],
    messages: [ { role: "assistant",
        tool_calls: [{ id: "1", function: { name: "thread", arguments: JSON.stringify({ name: "worker", action: "Inspect" }) } }],
      }, { role: "tool", tool_call_id: "1", content: "done" },
      { role: "assistant", content: "Completed" }, ], });
  assert.deepEqual(plain(persisted.map(({ name, result }) => ({ name, result }))), [
    { name: "thread", result: "completed" },
    { name: "response", result: "persisted" }, ]);
  assert.match(persisted[0].detail, /call 1/);
  assert.match(persisted[0].detail, /result: done/);
  ui.state.events.set( "session",
    Array.from({ length: 8 }, (_, index) => ({ sequence_id: index + 1,
      event: { type: "run_started", prompt_preview: `prompt-${index + 1}` },
    })));
  const live = ui.buildOrchestratorActions({ thread_steering: [], messages: [] });
  assert.equal(live.length, 5);
  assert.equal(live[0].detail, "prompt-4");
  assert.equal(live.at(-1).detail, "prompt-8");
});

test("thread fullscreen episodes keep counting labels and expose durable identity", () => {
  const html = ui.renderThreadEpisodes([
    { id: 41, session_id: "session-a", thread_name: "worker", created_at: "created-41", action: "Inspect <schema> fully", content: "First response" },
    { id: 99, session_id: "session-a", thread_name: "worker", created_at: "created-99", action: "Verify migration", content: "Second response" },
  ]);
  assert.match(html, /Episode 1 · ID 41/);
  assert.match(html, /Episode 2 · ID 99/);
  assert.equal(occurrences(html, /<details class="focus-episode"/g), 2);
  assert.equal(occurrences(html, /<details class="focus-episode"[^>]* open/g), 1);
  assert.match(html, /<dt>Durable episode ID<\/dt><dd>99<\/dd>/);
  assert.match(html, /<dt>Session ID<\/dt><dd>session-a<\/dd>/);
  assert.match(html, /<dt>Thread<\/dt><dd>worker<\/dd>/);
  assert.match(html, /<dt>Created<\/dt><dd>created-99<\/dd>/);
  assert.doesNotMatch(html, /<dt>Action<\/dt>/);
  assert.equal(occurrences(html, /<span>Action<\/span>/g), 2);
  assert.match(html, /Inspect &lt;schema&gt; fully/);
  assert.match(html, /<span>Action<\/span><p>Verify migration<\/p>/);
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
  const snapshot = { active_run: { run_id: "run-live" },
    response_timing: { cumulative_token_usage: { input_tokens: 100,
        output_tokens: 20, cache_read_tokens: 40,
        cache_write_tokens: 5, reasoning_tokens: 7, total_tokens: 500,
      }, }, };
  const events = [
    { run_id: "older-run", event: { type: "agent", event: {
      type: "token_usage_updated", thread_name: null,
      usage: { input_tokens: 999, output_tokens: 999, cache_read_tokens: 999, total_tokens: 999 },
    } } }, { run_id: "run-live", event: { type: "agent", event: {
      type: "token_usage_updated", thread_name: null,
      usage: { input_tokens: 10, output_tokens: 2, cache_read_tokens: 3, cache_write_tokens: 1, reasoning_tokens: 1, total_tokens: 600 },
    } } }, { run_id: "run-live", event: { type: "agent", event: {
      type: "token_usage_updated", thread_name: "research/ui",
      usage: { input_tokens: 20, output_tokens: 4, cache_read_tokens: 8, cache_write_tokens: 2, reasoning_tokens: 2, total_tokens: 240 },
    } } }, { run_id: "run-live", event: { type: "agent", event: {
      type: "token_usage_updated", thread_name: null,
      usage: { input_tokens: 30, output_tokens: 6, cache_read_tokens: 12, cache_write_tokens: 3, reasoning_tokens: 3, total_tokens: 700 },
    } } }, ];
  const usage = ui.displayedTokenUsage(snapshot, "session", events);
  assert.deepEqual(plain(usage), { input_tokens: 160,
    output_tokens: 32, cache_read_tokens: 63, cache_write_tokens: 11,
    reasoning_tokens: 13, total_tokens: 700, });
  assert.equal(ui.orchestratorContextTokens(usage), 700);
  assert.equal(ui.tokenUsageSummary(usage), "↑160 R63 ↓32");
  assert.equal(ui.tokenUsageTitle(usage), "input 160 · cache read 63 · output 32");
});

test("completed replay events do not double-count persisted token usage", () => {
  const snapshot = { active_run: null, response_timing: {
      cumulative_token_usage: { input_tokens: 100, output_tokens: 20,
        cache_read_tokens: 40, total_tokens: 500, }, }, };
  const events = [
    { run_id: "run-done", event: { type: "run_started" } },
    { run_id: "run-done", event: { type: "agent", event: {
      type: "token_usage_updated", thread_name: null,
      usage: { input_tokens: 10, output_tokens: 2, cache_read_tokens: 3, total_tokens: 600 },
    } } }, { run_id: "run-done", event: { type: "run_completed" } },
  ];
  assert.equal(ui.usageRunId(snapshot, events), null);
  assert.deepEqual(plain(ui.displayedTokenUsage(snapshot, "session", events)), {
    input_tokens: 100, output_tokens: 20, cache_read_tokens: 40,
    cache_write_tokens: 0, reasoning_tokens: 0, total_tokens: 500, });
});

scenario("Settings values and safety", "settings consumes valid raw headers and preserves malformed persisted text", () => {
  const valid = ui.rawHeadersFromConfig(persistedConfig({
    extra_headers_json: '{"X-Trace":"yes","X-Mode":"strict"}', }));
  assert.deepEqual(plain(valid.value), { "X-Trace": "yes", "X-Mode": "strict" });
  assert.equal(valid.invalid, false);
  assert.match(valid.text, /\n  "X-Trace": "yes"/);
  const malformedText = '{broken<&"';
  const malformed = ui.rawHeadersFromConfig(persistedConfig({ extra_headers_json: malformedText }));
  assert.equal(malformed.text, malformedText);
  assert.equal(malformed.invalid, true);
  assert.deepEqual(plain(malformed.value), {});
  const nonStringText = '{"X-Retry":7}';
  const nonString = ui.rawHeadersFromConfig(persistedConfig({ extra_headers_json: nonStringText }));
  assert.equal(nonString.text, nonStringText);
  assert.equal(nonString.invalid, true);
  assert.deepEqual(plain(nonString.value), {});
  assert.throws(() => ui.serializeSettingsHeaders(nonStringText), /value for "X-Retry" must be a string/);
  assert.deepEqual(plain(ui.rawHeadersFromConfig(persistedConfig({ extra_headers_json: null }))), {
    text: "", value: {}, invalid: false, });
});

scenario("Settings values and safety", "settings renderer shows every diagnostic and the exact malformed header draft", () => {
  ui.state.currentId = "settings-session";
  ui.state.settingsFocus = { sessionId: "settings-session",
    requestGeneration: 1, status: "ready", error: null, message: "",
    config: persistedConfig({ backend: "auto<&",
      reasoning_effort: "ultra", extra_headers_json: '{broken<&"',
      diagnostics: [ "unsupported stored backend 'auto<&'",
        "unsupported stored reasoning effort 'ultra'",
        "malformed stored extra headers: expected value", ], }), };
  const html = ui.renderFocusSettings();
  assert.equal(occurrences(html, /<li>/g), 3);
  assert.match(html, /unsupported stored backend &#39;auto&lt;&amp;&#39;/);
  assert.match(html, /unsupported stored reasoning effort &#39;ultra&#39;/);
  assert.match(html, /malformed stored extra headers: expected value/);
  assert.match(html, /<textarea[^>]*>\{broken&lt;&amp;&quot;<\/textarea>/);
  assert.match(html, /Existing headers are unchanged unless this field is edited/);
  assert.match(html, /Blank or <code>\{\}<\/code> removes all extra headers/);
});

scenario("Settings values and safety", "settings selectors preserve unsupported values and expose unset, none, and minimal", () => {
  const backend = ui.backendOptions('legacy<&"');
  assert.match(backend, /value="legacy&lt;&amp;&quot;" selected/);
  assert.match(backend, /legacy&lt;&amp;&quot; \(unsupported — select a replacement\)/);
  assert.match(backend, /value="openai-responses"/);
  const effort = ui.effortOptions("ultra<&");
  assert.match(effort, /value="ultra&lt;&amp;" selected/);
  assert.match(effort, /value="__unset__"[^>]*>unset \(backend default\)<\/option>/);
  assert.match(effort, /value="none"[^>]*>none<\/option>/);
  assert.match(effort, /value="minimal"[^>]*>minimal<\/option>/);
  assert.match(ui.effortOptions(null), /value="__unset__" selected/);
});

scenario("Settings values and safety", "settings PATCH is sparse, semantic, and explicitly clears optional values", () => {
  const initial = ui.settingsValuesFromConfig(persistedConfig());
  const unchanged = settingsFormElement().values;
  assert.deepEqual(plain(ui.buildSettingsPatch(unchanged, initial)), {});
  assert.deepEqual(plain(ui.buildSettingsPatch({ ...unchanged, model: " gpt-5.1 " }, initial)), {
    model: "gpt-5.1", });
  assert.deepEqual(plain(ui.buildSettingsPatch({ ...unchanged,
    extra_headers: '{ "X-Trace" : "yes" }', }, initial)), {});
  assert.deepEqual(plain(ui.buildSettingsPatch({ ...unchanged,
    reasoning_effort: "__unset__", api_key_env: "",
    extra_headers: "{}", }, initial)), { reasoning_effort: null,
    api_key_env: null, extra_headers: {}, });
  assert.deepEqual(plain(ui.buildSettingsPatch({ ...unchanged,
    reasoning_effort: "none",
  }, initial)), { reasoning_effort: "none" });
  assert.deepEqual(plain(ui.buildSettingsPatch({ ...unchanged,
    reasoning_effort: "minimal",
  }, initial)), { reasoning_effort: "minimal" });
  assert.deepEqual(plain(ui.buildSettingsPatch({ ...unchanged,
    extra_headers: "", }, initial)), { extra_headers: {} });
});

scenario("Settings values and safety", "settings PATCH preserves null and unsupported selector values until explicitly replaced", () => {
  const missingConfig = persistedConfig({ backend: null, reasoning_effort: null });
  const missingInitial = ui.settingsValuesFromConfig(missingConfig);
  assert.equal(missingInitial.backend, null);
  assert.equal(missingInitial.reasoning_effort, null);
  assert.deepEqual(plain(ui.buildSettingsPatch(settingsFormElement({
    backend: "", reasoning_effort: "__unset__",
  }).values, missingInitial)), {});
  assert.match(ui.backendOptions(null), /value="" selected disabled>select a backend to repair/);
  const unsupportedConfig = persistedConfig({ backend: "legacy-backend", reasoning_effort: "ultra" });
  const unsupportedInitial = ui.settingsValuesFromConfig(unsupportedConfig);
  assert.deepEqual(plain(ui.buildSettingsPatch(settingsFormElement({
    backend: "legacy-backend", reasoning_effort: "ultra",
  }).values, unsupportedInitial)), {});
  assert.deepEqual(plain(ui.buildSettingsPatch(settingsFormElement({
    backend: "legacy-backend", reasoning_effort: "ultra",
    model: "gpt-5.1",
  }).values, unsupportedInitial)), { model: "gpt-5.1" });
});

scenario("Settings values and safety", "managed backend repair omits an unchanged blank stored base URL", () => {
  const initial = ui.settingsValuesFromConfig(persistedConfig({
    backend: null, base_url: "", }));
  const patch = ui.buildSettingsPatch(settingsFormElement({
    backend: "openai-responses", base_url: "", }).values, initial);
  assert.deepEqual(plain(patch), { backend: "openai-responses" });
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "base_url"), false);
});

scenario("Settings values and safety", "an unrelated save never clears malformed or valid existing headers", () => {
  const malformedConfig = persistedConfig({ backend: " auto ",
    reasoning_effort: "", extra_headers_json: "{broken", });
  const malformedInitial = ui.settingsValuesFromConfig(malformedConfig);
  assert.deepEqual(plain(ui.buildSettingsPatch({
    ...settingsFormElement({ model: "gpt-5.1", backend: " auto ",
      reasoning_effort: "", extra_headers: "{broken", }).values,
  }, malformedInitial)), { model: "gpt-5.1" });
  const newlineNormalizedInitial = ui.settingsValuesFromConfig(persistedConfig({
    extra_headers_json: "{\r\nbroken", }));
  assert.deepEqual(plain(ui.buildSettingsPatch(settingsFormElement({
    extra_headers: "{\nbroken",
  }).values, newlineNormalizedInitial)), {});
  assert.throws(() => ui.buildSettingsPatch({
    ...settingsFormElement({ model: "gpt-5.1", extra_headers: "{still-broken" }).values,
  }, malformedInitial), /Extra headers must be valid JSON/);
  const validInitial = ui.settingsValuesFromConfig(persistedConfig({
    extra_headers_json: '{"Authorization":"preserved"}', }));
  assert.deepEqual(plain(ui.buildSettingsPatch({
    ...settingsFormElement({ model: "gpt-5.1",
      extra_headers: '{\n  "Authorization": "preserved"\n}',
    }).values, }, validInitial)), { model: "gpt-5.1" });
});

test("model configuration repair guidance persists without a snapshot", () => {
  ui.el.configRepairNotice = { hidden: true };
  ui.el.configRepairDetail = fakeElement();
  ui.el.configRepairAction = fakeElement();
  const detail = "unsupported stored backend 'auto'; malformed stored extra headers";
  ui.renderConfigRepairGuidance({ model_config_error: detail });
  assert.equal(ui.el.configRepairNotice.hidden, false);
  assert.equal(ui.el.configRepairDetail.textContent, detail);
  assert.match(ui.el.configRepairAction.getAttribute("aria-label"), /Repair model configuration.*unsupported stored backend/);
  ui.state.currentId = "repair-session";
  ui.state.sessions = [{ summary: { session_id: "repair-session", model_config_error: detail } }];
  ui.state.settingsFocus = { sessionId: "repair-session",
    requestGeneration: 2, status: "error", config: null,
    error: "snapshot and config attach failed", message: "", };
  const errorHtml = ui.renderFocusSettings();
  assert.match(errorHtml, /Configuration could not be loaded/);
  assert.match(errorHtml, /snapshot and config attach failed/);
  assert.match(errorHtml, /unsupported stored backend/);
  assert.match(errorHtml, /data-retry-settings/);
});

scenario("Settings values and safety", "same-session settings GET generations and view guards reject stale responses", async () => {
  const first = deferred();
  const second = deferred();
  const guarded = loadApp({ fetch: (() => {
      const queue = [first, second];
      return () => queue.shift().promise; })(), });
  settingsViewElements(guarded);
  guarded.state.currentId = "same-session";
  guarded.state.focusView = { type: "settings" };
  guarded.state.settingsRequestGeneration = 1;
  guarded.state.settingsFocus = { sessionId: "same-session", requestGeneration: 1, status: "loading" };
  const firstLoad = guarded.loadFocusSettings({ requestGeneration: 1 });
  guarded.state.settingsRequestGeneration = 2;
  guarded.state.settingsFocus = { sessionId: "same-session", requestGeneration: 2, status: "loading" };
  const secondLoad = guarded.loadFocusSettings({ requestGeneration: 2 });
  second.resolve(jsonResponse(persistedConfig({ model: "current-model" })));
  await secondLoad;
  first.resolve(jsonResponse(persistedConfig({ model: "stale-model" })));
  await firstLoad;
  assert.equal(guarded.state.settingsFocus.config.model, "current-model");
  assert.equal(guarded.state.settingsFocus.requestGeneration, 2);
  const viewLoad = deferred();
  const viewGuarded = loadApp({ fetch: () => viewLoad.promise });
  settingsViewElements(viewGuarded);
  viewGuarded.state.currentId = "same-session";
  viewGuarded.state.focusView = { type: "settings" };
  viewGuarded.state.settingsRequestGeneration = 3;
  viewGuarded.state.settingsFocus = { sessionId: "same-session", requestGeneration: 3, status: "loading" };
  const pending = viewGuarded.loadFocusSettings({ requestGeneration: 3 });
  viewGuarded.state.focusView = { type: "info" };
  viewLoad.resolve(jsonResponse(persistedConfig({ model: "wrong-view-model" })));
  await pending;
  assert.equal(viewGuarded.state.settingsFocus.config, null);
});

test("settings controller reports No changes without issuing PATCH", async () => {
  let requestCount = 0;
  const isolated = loadApp({ FormData: FakeFormData,
    fetch: async () => { requestCount += 1; return jsonResponse({}); },
  });
  const form = settingsFormElement();
  isolated.state.currentId = "settings-session";
  isolated.state.focusView = { type: "settings" };
  isolated.state.settingsRequestGeneration = 4;
  isolated.state.settingsFocus = { sessionId: "settings-session",
    requestGeneration: 4, status: "ready", config: persistedConfig(),
  };
  await isolated.handleDrawerSubmit({ target: form, preventDefault() {} });
  assert.equal(requestCount, 0);
  assert.equal(form.status.textContent, "No changes");
  assert.equal(form.inert, false);
});

test("settings controller suppresses duplicate submissions while a save is pending", async () => {
  const patch = deferred();
  let requestCount = 0;
  const isolated = loadApp({ FormData: FakeFormData,
    fetch: () => { requestCount += 1; return patch.promise; }, });
  const form = settingsFormElement({ model: "gpt-5.1" });
  isolated.el.focusContent = { querySelector: () => form };
  isolated.state.currentId = "settings-session";
  isolated.state.focusView = { type: "settings" };
  isolated.state.settingsRequestGeneration = 5;
  isolated.state.settingsFocus = { sessionId: "settings-session",
    requestGeneration: 5, status: "ready", config: persistedConfig(),
  };
  const first = isolated.handleDrawerSubmit({ target: form, preventDefault() {} });
  const duplicate = isolated.handleDrawerSubmit({ target: form, preventDefault() {} });
  assert.equal(requestCount, 1);
  assert.equal(form.inert, true);
  assert.equal(form.submit.disabled, true);
  patch.resolve({ ok: false, status: 422,
    statusText: "Unprocessable Content",
    async text() { return JSON.stringify({ error: "save failed" }); },
  });
  await Promise.all([first, duplicate]);
  assert.equal(requestCount, 1);
  assert.equal(isolated.state.settingsSubmission, null);
  assert.equal(form.status.textContent, "save failed");
  assert.equal(form.status.classList.contains("is-error"), true);
  assert.equal(form.inert, false);
  assert.equal(form.submit.disabled, false);
});

test("closing and reopening settings retains the deferred PATCH guard and reconciles the newer view", async () => {
  const patch = deferred();
  const requests = [];
  const isolated = loadApp({ FormData: FakeFormData,
    requestAnimationFrame: () => 1,
    fetch: async (path, options = {}) => {
      requests.push([path, options]);
      if (options.method === "PATCH") return patch.promise;
      if (path === "/sessions/settings-session/config") {
        return jsonResponse(persistedConfig({ model: "authoritative-model", config_version: 3 }));
      }
      if (path.startsWith("/sessions/settings-session?")) {
        return jsonResponse({
          metadata: { session_id: "settings-session" }, messages: [], active_run: null,
          worksets: { items: [] }, }); }
      if (path === "/sessions") { return jsonResponse([{ summary: {
          session_id: "settings-session", cwd: "/repo", model: "authoritative-model", backend: "openai-responses",
          title: null, pinned: false, sandboxed: false, visible_message_count: 0,
        } }]); }
      throw new Error(`unexpected request ${path}`); }, });
  settingsViewElements(isolated);
  isolated.el.pickerSessionTotal = fakeElement();
  isolated.el.sessionGrid = { innerHTML: "", contains() { return false; } };
  const originalForm = settingsFormElement({ model: "submitted-model" });
  const reopenedForm = settingsFormElement({ model: "newer-unsent-view" });
  isolated.el.focusContent.querySelector = (selector) => selector === "#settingsForm" ? reopenedForm : null;
  isolated.state.currentId = "settings-session";
  isolated.state.focusView = { type: "settings" };
  isolated.state.settingsRequestGeneration = 1;
  isolated.state.settingsFocus = {
    sessionId: "settings-session", requestGeneration: 1, status: "ready", config: persistedConfig(),
  };
  const first = isolated.handleDrawerSubmit({ target: originalForm, preventDefault() {} });
  assert.equal(requests.length, 1);
  const submission = isolated.state.settingsSubmission;
  assert.ok(submission);
  // Closing and reopening invalidates the old GET view but must not release its write guard.
  isolated.state.focusView = null;
  isolated.state.settingsFocus = null;
  isolated.state.settingsRequestGeneration = 2;
  isolated.state.focusView = { type: "settings" };
  isolated.state.settingsRequestGeneration = 3;
  isolated.state.settingsFocus = {
    sessionId: "settings-session", requestGeneration: 3, status: "ready", config: persistedConfig(),
  };
  assert.equal(isolated.state.settingsSubmission, submission);
  assert.match(isolated.renderFocusSettings(), /<form[^>]* inert aria-busy="true"/);
  assert.match(isolated.renderFocusSettings(), /data-settings-submit type="submit" disabled/);
  await isolated.handleDrawerSubmit({ target: reopenedForm, preventDefault() {} });
  assert.equal(requests.length, 1, "the reopened view must not start a second PATCH");
  patch.resolve({ ok: true, status: 200, statusText: "OK", async text() { return ""; } });
  await first;
  assert.equal(requests.filter(([, options]) => options.method === "PATCH").length, 1);
  assert.deepEqual(requests.slice(1).map(([path]) => path).sort(), [
    "/sessions", "/sessions/settings-session/config",
    "/sessions/settings-session?message_limit=24&thread_event_limit=24",
  ]);
  assert.equal(isolated.state.settingsSubmission, null);
  assert.equal(isolated.state.settingsFocus.config.model, "authoritative-model");
  assert.equal(isolated.state.settingsFocus.requestGeneration, 4);
  assert.equal(reopenedForm.inert, false);
  assert.equal(reopenedForm.submit.disabled, false);
  assert.equal(reopenedForm.status.textContent, "Saved");
});

test("empty PATCH responses reload config and reconcile snapshot and session state with the exact sparse body", async () => {
  const requests = [];
  const isolated = loadApp({ FormData: FakeFormData,
    requestAnimationFrame: () => 1,
    fetch: async (path, options = {}) => {
      requests.push([path, options]);
      if (options.method === "PATCH") {
        return { ok: true, status: 200, statusText: "OK", async text() { return ""; } };
      }
      if (path === "/sessions/settings-session/config") {
        return jsonResponse(persistedConfig({ model: "gpt-5.1", config_version: 2 }));
      }
      if (path.startsWith("/sessions/settings-session?")) {
        return jsonResponse({
          metadata: { session_id: "settings-session" }, messages: [], active_run: null,
          worksets: { items: [] }, }); }
      if (path === "/sessions") { return jsonResponse([{ summary: {
          session_id: "settings-session", cwd: "/repo", model: "gpt-5.1", backend: "openai-responses",
          title: null, pinned: false, sandboxed: false, visible_message_count: 0,
        } }]); }
      throw new Error(`unexpected request ${path}`); }, });
  settingsViewElements(isolated);
  isolated.el.pickerSessionTotal = fakeElement();
  isolated.el.sessionGrid = { innerHTML: "", contains() { return false; } };
  const form = settingsFormElement({ model: "gpt-5.1" });
  isolated.state.currentId = "settings-session";
  isolated.state.focusView = { type: "settings" };
  isolated.state.settingsRequestGeneration = 6;
  isolated.state.settingsFocus = { sessionId: "settings-session",
    requestGeneration: 6, status: "ready", config: persistedConfig(),
  };
  await isolated.handleDrawerSubmit({ target: form, preventDefault() {} });
  assert.equal(requests.length, 4);
  assert.equal(requests[0][0], "/sessions/settings-session/config");
  assert.equal(requests[0][1].method, "PATCH");
  assert.deepEqual(JSON.parse(requests[0][1].body), { model: "gpt-5.1" });
  assert.deepEqual(requests.slice(1).map(([path]) => path).sort(), [
    "/sessions", "/sessions/settings-session/config",
    "/sessions/settings-session?message_limit=24&thread_event_limit=24",
  ]);
  assert.equal(isolated.state.settingsFocus.config.model, "gpt-5.1");
  assert.equal(isolated.state.snapshots.get("settings-session").metadata.session_id, "settings-session");
  assert.equal(isolated.state.settingsSubmission, null);
});

test("selector helpers include supported backends and reasoning levels", () => {
  const backends = ui.backendOptions("arcee-auth");
  assert.match(backends, /value="arcee-auth" selected/);
  assert.match(backends, /value="arcee-api"/);
  assert.doesNotMatch(backends, /value="auto"/);
  const efforts = ui.effortOptions("xhigh");
  assert.match(efforts, /value="xhigh" selected/);
  assert.match(efforts, /value="__unset__">unset \(backend default\)<\/option>/);
  assert.match(efforts, /value="none">none<\/option>/);
  assert.match(efforts, /value="minimal">minimal<\/option>/);
});

test("HTML escaping covers action names and user-provided labels", () => {
  assert.equal(ui.escapeHtml(`<script data-x="1">'&`),
    "&lt;script data-x=&quot;1&quot;&gt;&#39;&amp;");
});

scenario("Launch modes and defaults", "launch CWD drafts isolate local and sandbox paths from persistent SSH drafts", () => {
  const root = "/server/local/repository";
  let transition = ui.transitionLaunchCwdDrafts( "local", "ssh", root,
    { localSandbox: root, ssh: null }, root);
  assert.equal(transition.cwd, "~");
  assert.notEqual(transition.cwd, root);
  assert.deepEqual(plain(transition.drafts), { localSandbox: root, ssh: "~" });
  transition = ui.transitionLaunchCwdDrafts("ssh", "local", "~/remote/project", transition.drafts, root);
  assert.equal(transition.cwd, root);
  assert.equal(transition.drafts.ssh, "~/remote/project");
  transition = ui.transitionLaunchCwdDrafts("local", "sandbox", "/local/draft", transition.drafts, root);
  assert.equal(transition.cwd, "/local/draft");
  transition = ui.transitionLaunchCwdDrafts("sandbox", "ssh", "/local/sandbox-draft", transition.drafts, root);
  assert.equal(transition.cwd, "~/remote/project");
  assert.equal(transition.drafts.localSandbox, "/local/sandbox-draft");
  transition = ui.transitionLaunchCwdDrafts("ssh", "local", "", transition.drafts, root);
  transition = ui.transitionLaunchCwdDrafts("local", "ssh", "/another/local", transition.drafts, root);
  assert.equal(transition.cwd, "", "an explicit blank remote draft must not be replaced by the local root");
});

scenario("Launch modes and defaults", "launch execution controls expose only the selected target-specific fields", () => {
  ui.el.launchExecutionModes = fakeElement();
  ui.el.launchCwd = { value: "/repo", placeholder: "", dataset: {} };
  ui.el.launchCwdLabel = fakeElement();
  ui.el.launchSshField = { hidden: false, inert: false };
  ui.el.launchSshHost = { disabled: false, required: false };
  ui.el.sandboxFields = { hidden: false, inert: false };
  const sandboxControls = ["sandboxImage", "sandboxGpu", "sandboxWorkdir", "sandboxShm", "sandboxMounts", "sandboxNoMount"];
  for (const name of sandboxControls) ui.el[name] = { disabled: false };
  ui.syncLaunchExecutionFields("local");
  assert.equal(ui.el.launchExecutionModes.dataset.mode, "local");
  assert.equal(ui.el.launchCwd.dataset.mode, "local");
  assert.equal(ui.el.launchSshField.hidden, true);
  assert.equal(ui.el.launchSshField.inert, true);
  assert.equal(ui.el.launchSshHost.disabled, true);
  assert.equal(ui.el.sandboxFields.hidden, true);
  assert.equal(ui.el.sandboxFields.inert, true);
  assert.ok(sandboxControls.every((name) => ui.el[name].disabled));
  ui.syncLaunchExecutionFields("ssh");
  assert.equal(ui.el.launchExecutionModes.dataset.mode, "ssh");
  assert.equal(ui.el.launchCwdLabel.textContent, "remote working directory");
  assert.equal(ui.el.launchCwd.placeholder, "~");
  assert.equal(ui.el.launchSshField.hidden, false);
  assert.equal(ui.el.launchSshHost.disabled, false);
  assert.equal(ui.el.launchSshHost.required, true);
  assert.equal(ui.el.sandboxFields.hidden, true);
  assert.ok(sandboxControls.every((name) => ui.el[name].disabled));
  ui.syncLaunchExecutionFields("sandbox");
  assert.equal(ui.el.launchExecutionModes.dataset.mode, "sandbox");
  assert.equal(ui.el.launchCwdLabel.textContent, "working directory");
  assert.equal(ui.el.launchSshField.hidden, true);
  assert.equal(ui.el.launchSshHost.required, false);
  assert.equal(ui.el.sandboxFields.hidden, false);
  assert.equal(ui.el.sandboxFields.inert, false);
  assert.ok(sandboxControls.every((name) => !ui.el[name].disabled));
});

scenario("Launch modes and defaults", "launch request construction preserves omitted, null, and concrete model options", () => {
  assert.deepEqual(plain(ui.buildLaunchSessionRequest(launchValues({
    cwd: " /repo ", ssh_host: "hidden@example.test",
    sandbox: { no_mount_cwd: true, image: "must-not-leak",
      gpus: "0", workdir: "/hidden", shm_size: "2g",
      mounts: "/hidden:/hidden", },
  }))), { cwd: "/repo" });
  assert.deepEqual(plain(ui.buildLaunchSessionRequest(launchValues({
    cwd: "/repo", reasoning_mode: "unset", api_key_mode: "none",
    extra_headers: "{}", }))), { cwd: "/repo", reasoning_effort: null,
    api_key_env: null, extra_headers: null, });
  assert.deepEqual(plain(ui.buildLaunchSessionRequest(launchValues({ mode: "ssh",
    cwd: "~/work", ssh_host: " deploy@example.test ",
    backend: " arcee-api ", model: " coder ",
    base_url: " https://api.example.test/v1 ",
    reasoning_mode: "minimal", api_key_mode: "named",
    api_key_env: " ARCEE_API_KEY ",
    extra_headers: '{"X-Trace":"yes"}',
    sandbox: { image: "must-not-leak" }, }))), { cwd: "~/work",
    ssh_host: "deploy@example.test", backend: "arcee-api",
    model: "coder",
    base_url: "https://api.example.test/v1",
    reasoning_effort: "minimal", api_key_env: "ARCEE_API_KEY",
    extra_headers: { "X-Trace": "yes" }, });
  const sandbox = plain(ui.buildLaunchSessionRequest(launchValues({
    mode: "sandbox", cwd: "/repo", reasoning_mode: "none",
    ssh_host: "hidden-ssh@example.test",
    sandbox: { no_mount_cwd: true, image: " image:latest ",
      gpus: "0, 1", workdir: "/workspace", shm_size: "2g",
      mounts: "/one:/one, /two:/two", }, })));
  assert.equal(sandbox.reasoning_effort, "none");
  assert.equal(Object.hasOwn(sandbox, "ssh_host"), false);
  assert.deepEqual(sandbox.sandbox, { enabled: true,
    no_mount_cwd: true, image: "image:latest", gpus: ["0", "1"],
    workdir: "/workspace", shm_size: "2g",
    mounts: ["/one:/one", "/two:/two"], mounts_ro: [], });
  for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh"]) {
    assert.equal(ui.buildLaunchSessionRequest(launchValues({ reasoning_mode: effort })).reasoning_effort, effort);
  }
  assert.equal(Object.hasOwn(ui.buildLaunchSessionRequest(launchValues()), "reasoning_effort"), false);
  assert.equal(ui.buildLaunchSessionRequest(launchValues({ reasoning_mode: "unset" })).reasoning_effort, null);
  assert.throws(() => ui.buildLaunchSessionRequest(launchValues({
    api_key_mode: "named", api_key_env: " ",
  })), /API key environment variable name/);
  assert.throws(() => ui.buildLaunchSessionRequest(launchValues({
    extra_headers: '{"X":7}',
  })), /must be a string/);
});

test("session creation serializes every execution mode through the exclusive request builder", async () => {
  const requests = [];
  const isolated = loadApp({ FormData: FakeFormData,
    fetch: async (path, options) => {
      requests.push({ path, options });
      return errorResponse(422, { error: "captured request" }); }, });
  const submit = { disabled: false };
  isolated.el.launchForm = { mode: "local", querySelector: () => submit };
  isolated.el.launchStatus = fakeElement();
  isolated.el.launchCwd = { value: "/local/repo" };
  isolated.el.launchSshHost = { value: "hidden@example.test" };
  isolated.el.launchBackend = { value: "openai-responses" };
  isolated.el.launchEffort = { value: "unset" };
  isolated.el.launchModel = { value: "model" };
  isolated.el.launchBaseUrl = { value: "https://api.example.test" };
  isolated.el.launchApiKeyMode = { value: "none" };
  isolated.el.launchApiKeyEnv = { value: "HIDDEN_KEY" };
  isolated.el.launchExtraHeaders = { value: "" };
  isolated.el.sandboxNoMount = { checked: true };
  isolated.el.sandboxImage = { value: "hidden-image" };
  isolated.el.sandboxGpu = { value: "0" };
  isolated.el.sandboxWorkdir = { value: "/hidden-workdir" };
  isolated.el.sandboxShm = { value: "2g" };
  isolated.el.sandboxMounts = { value: "/hidden:/hidden" };
  await isolated.createSession({ preventDefault() {} });
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    cwd: "/local/repo", backend: "openai-responses", model: "model",
    base_url: "https://api.example.test",
    reasoning_effort: null, api_key_env: null, });
  isolated.el.launchForm.mode = "sandbox";
  isolated.el.launchEffort.value = "none";
  isolated.el.launchApiKeyMode.value = "named";
  isolated.el.launchApiKeyEnv.value = "SANDBOX_KEY";
  await isolated.createSession({ preventDefault() {} });
  const sandboxBody = JSON.parse(requests[1].options.body);
  assert.equal(Object.hasOwn(sandboxBody, "ssh_host"), false);
  assert.deepEqual(sandboxBody.sandbox, { enabled: true,
    no_mount_cwd: true, image: "hidden-image", gpus: ["0"],
    workdir: "/hidden-workdir", shm_size: "2g",
    mounts: ["/hidden:/hidden"], mounts_ro: [], });
  assert.equal(sandboxBody.reasoning_effort, "none");
  assert.equal(sandboxBody.api_key_env, "SANDBOX_KEY");
  isolated.el.launchForm.mode = "ssh";
  isolated.el.launchCwd.value = "";
  isolated.el.launchSshHost.value = " deploy@example.test ";
  isolated.el.launchEffort.value = "minimal";
  isolated.el.launchApiKeyMode.value = "inherit";
  await isolated.createSession({ preventDefault() {} });
  const sshBody = JSON.parse(requests[2].options.body);
  assert.equal(sshBody.cwd, "~");
  assert.equal(sshBody.ssh_host, "deploy@example.test");
  assert.equal(sshBody.reasoning_effort, "minimal");
  assert.equal(Object.hasOwn(sshBody, "api_key_env"), false);
  assert.equal(Object.hasOwn(sshBody, "sandbox"), false);
  assert.deepEqual(requests.map(({ path }) => path), ["/sessions", "/sessions", "/sessions"]);
  assert.ok(requests.every(({ options }) => options.method === "POST"));
  assert.equal(submit.disabled, false);
});

test("created sessions remain openable and initial-prompt dispatch precedes a fallible list refresh", async () => {
  const isolated = loadApp({
    fetch: async () => errorResponse(503, { error: "list unavailable" }),
    window: { setTimeout: () => 1, clearTimeout() {} }, });
  isolated.el.sessionWorkspace = { hidden: true };
  isolated.el.pickerNavStatus = fakeElement();
  isolated.el.sessionNavStatus = fakeElement();
  isolated.el.pickerSessionTotal = fakeElement();
  isolated.el.sessionGrid = fakeElement();
  const snapshot = {
    metadata: { session_id: "created-session", cwd: "/repo", model: "model", backend: "backend", sandbox_status: "off" },
    messages: [], active_run: null, sessions: [{
      session_id: "created-session", cwd: "/repo", model: "model", backend: "backend",
      visible_message_count: 0, last_user_prompt: null, sandboxed: false, ssh_host: null,
      title: null, pinned: false, sort_order: 0, presentation_version: 0, created_at: "created", updated_at: "created",
    }], };
  isolated.upsertCreatedSession(snapshot, {});
  assert.equal(isolated.state.sessions[0].summary.session_id, "created-session");
  assert.equal(await isolated.loadSessions({ workspaceStats: true, preserveSessionId: "created-session" }), null);
  assert.equal(isolated.state.sessions[0].summary.session_id, "created-session");
});

scenario("Launch modes and defaults", "launch-default requests use local CWD or exact SSH topology", () => {
  assert.deepEqual(plain(ui.buildLaunchDefaultsRequest({ mode: "local", cwd: " /repo ", sshHost: "" })), {
    ready: true, body: { cwd: "/repo" }, });
  assert.deepEqual(plain(ui.buildLaunchDefaultsRequest({ mode: "sandbox", cwd: "/repo", sshHost: "ignored" })), {
    ready: true, body: { cwd: "/repo" }, });
  assert.deepEqual(plain(ui.buildLaunchDefaultsRequest({ mode: "ssh", cwd: "", sshHost: " build-box " })), {
    ready: true, body: { cwd: "~", ssh_host: "build-box" }, });
  const waiting = ui.buildLaunchDefaultsRequest({ mode: "ssh", cwd: "~", sshHost: " " });
  assert.equal(waiting.ready, false);
  assert.match(waiting.message, /Enter an SSH host/);
});

scenario("Launch modes and defaults", "launch-default preview limits claims and explains managed canonical URL and stored credentials", () => {
  const ready = ui.renderLaunchDefaultsPreviewHtml({ status: "ready",
    data: { configured_model_backend: "chatgpt-codex-responses",
      configured_model_base_url: "https://chatgpt.com/backend-api",
      model: "must-not-render", credential: "super-secret", }, });
  assert.match(ready, /Configured backend/);
  assert.match(ready, /chatgpt-codex-responses/);
  assert.match(ready, /Configured base URL/);
  assert.match(ready, /Canonical URL: <code>https:\/\/chatgpt\.com\/backend-api<\/code>/);
  assert.match(ready, /server-stored ChatGPT login/);
  assert.match(ready, /secret values are never returned/);
  assert.match(ready, /reports configured backend and base URL only/);
  assert.match(ready, /does not validate model availability/);
  assert.match(ready, /credentials will work/);
  assert.doesNotMatch(ready, /must-not-render|super-secret/);
  const arcee = ui.managedLaunchDefaults("arcee-auth", "https://custom.example.test");
  assert.equal(arcee.usesCanonicalUrl, false);
  assert.equal(arcee.canonicalUrl, "https://api.arcee.ai/api/v1");
  const noncanonical = ui.renderLaunchDefaultsPreviewHtml({
    status: "ready",
    data: { configured_model_backend: "arcee-auth", configured_model_base_url: "https://custom.example.test" },
  });
  assert.match(noncanonical, /Default canonical URL/);
  assert.match(noncanonical, /configured base URL above remains authoritative/);
  assert.match(ui.renderLaunchDefaultsPreviewHtml({ status: "loading" }), /Loading configured backend/);
  assert.match(ui.renderLaunchDefaultsPreviewHtml({ status: "error", error: "bad <cwd>" }), /role="alert"/);
  assert.match(ui.renderLaunchDefaultsPreviewHtml({ status: "error", error: "bad <cwd>" }), /bad &lt;cwd&gt;/);
});

test("launch-default generation guards reject stale same-dialog responses", async () => {
  const requests = [];
  const isolated = loadApp({ fetch: (path, options) => {
      const pending = deferred();
      requests.push({ path, options, pending });
      return pending.promise; }, });
  isolated.el.launchDefaultsPreview = fakeElement();
  isolated.el.launchDefaultsBody = { innerHTML: "" };
  isolated.el.refreshLaunchDefaults = { disabled: false };
  const first = isolated.loadLaunchDefaultsPreview({ mode: "local", cwd: "/old", sshHost: "" });
  const second = isolated.loadLaunchDefaultsPreview({ mode: "ssh", cwd: "~/new", sshHost: "build-box" });
  assert.equal(requests.length, 2);
  assert.equal(isolated.state.launchDefaultsPreview.status, "loading");
  assert.equal(isolated.el.launchDefaultsPreview.dataset.state, "loading");
  assert.equal(isolated.el.refreshLaunchDefaults.disabled, true);
  assert.equal(requests[0].path, "/sessions/launch-defaults");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), { cwd: "/old" });
  assert.deepEqual(JSON.parse(requests[1].options.body), { cwd: "~/new", ssh_host: "build-box" });
  requests[1].pending.resolve(jsonResponse({
    configured_model_backend: "arcee-auth",
    configured_model_base_url: "https://api.arcee.ai/api/v1",
  }));
  await second;
  requests[0].pending.resolve(jsonResponse({
    configured_model_backend: "openai-responses",
    configured_model_base_url: "https://stale.example.test",
  }));
  await first;
  assert.equal(isolated.state.launchDefaultsPreview.status, "ready");
  assert.equal(isolated.el.launchDefaultsPreview.dataset.state, "ready");
  assert.equal(isolated.el.refreshLaunchDefaults.disabled, false);
  assert.equal(isolated.state.launchDefaultsPreview.data.configured_model_backend, "arcee-auth");
  assert.match(isolated.el.launchDefaultsBody.innerHTML, /server-stored Arcee login/);
  assert.doesNotMatch(isolated.el.launchDefaultsBody.innerHTML, /stale\.example/);
});

test("launch-default errors remain refreshable and accessible", async () => {
  const isolated = loadApp({ fetch: async () => ({ ok: false,
      status: 422, statusText: "Unprocessable Content",
      async text() { return JSON.stringify({ error: "invalid local <cwd>" }); },
    }), });
  isolated.el.launchDefaultsPreview = fakeElement();
  isolated.el.launchDefaultsBody = { innerHTML: "" };
  isolated.el.refreshLaunchDefaults = { disabled: false };
  await isolated.loadLaunchDefaultsPreview({ mode: "local", cwd: "/missing", sshHost: "" });
  assert.equal(isolated.state.launchDefaultsPreview.status, "error");
  assert.equal(isolated.el.launchDefaultsPreview.dataset.state, "error");
  assert.equal(isolated.el.launchDefaultsPreview.getAttribute("aria-busy"), "false");
  assert.equal(isolated.el.refreshLaunchDefaults.disabled, false);
  assert.match(isolated.el.launchDefaultsBody.innerHTML, /role="alert"/);
  assert.match(isolated.el.launchDefaultsBody.innerHTML, /invalid local &lt;cwd&gt;/);
});

scenario("Launch modes and defaults", "managed defaults safely select no-env while explicit API-key mode remains user controlled", () => {
  ui.el.launchBackend = { value: "" };
  ui.el.launchApiKeyMode = { value: "inherit" };
  ui.el.launchApiKeyEnvField = { hidden: false };
  ui.el.launchApiKeyEnv = { disabled: false, required: false };
  ui.el.launchApiKeyHelp = fakeElement();
  ui.state.launchDefaultsPreview = { status: "ready",
    data: { configured_model_backend: "arcee-auth", configured_model_base_url: "https://api.arcee.ai/api/v1" },
  };
  ui.syncLaunchApiKeyMode();
  assert.equal(ui.el.launchApiKeyMode.value, "none");
  assert.equal(ui.el.launchApiKeyEnvField.hidden, true);
  assert.equal(ui.el.launchApiKeyEnv.disabled, true);
  assert.match(ui.el.launchApiKeyHelp.textContent, /selected automatically because server-stored Arcee login supplies credentials/);
  ui.state.launchDefaultsPreview.data.configured_model_backend = "openai-responses";
  ui.syncLaunchApiKeyMode();
  assert.equal(ui.el.launchApiKeyMode.value, "inherit");
  ui.el.launchApiKeyMode.value = "named";
  ui.syncLaunchApiKeyMode({ user: true });
  assert.equal(ui.el.launchApiKeyEnvField.hidden, false);
  assert.equal(ui.el.launchApiKeyEnv.disabled, false);
  assert.equal(ui.el.launchApiKeyEnv.required, true);
  ui.state.launchDefaultsPreview.data.configured_model_backend = "arcee-auth";
  ui.syncLaunchApiKeyMode();
  assert.equal(ui.el.launchApiKeyMode.value, "named", "managed defaults must not replace explicit credential intent");
  assert.match(ui.el.launchApiKeyHelp.textContent, /explicit credential mode is preserved/);
  ui.el.launchApiKeyMode.value = "inherit";
  ui.syncLaunchApiKeyMode({ user: true });
  ui.syncLaunchApiKeyMode();
  assert.equal(ui.el.launchApiKeyMode.value, "inherit", "an explicitly selected inherit mode remains authoritative");
});

test("session cards expose authoritative local, sandbox, and exact SSH topology", () => {
  const base = { session_id: "topology-session",
    cwd: "/workspace/repo", model: "model", pinned: false,
    visible_message_count: 0, };
  assert.equal(ui.sessionExecutionTopology({ ...base }).detail, "local");
  assert.equal(ui.sessionExecutionTopology({ ...base, sandboxed: true }).detail, "sandbox");
  assert.deepEqual(plain(ui.sessionExecutionTopology({ ...base, ssh_host: "deploy@host.example" })), {
    mode: "ssh", label: "ssh", host: "deploy@host.example",
    detail: "ssh deploy@host.example", });
  const local = ui.renderSessionCard({ summary: { ...base } });
  const sandbox = ui.renderSessionCard({ summary: { ...base, session_id: "sandbox", sandboxed: true } });
  const ssh = ui.renderSessionCard({ summary: { ...base, session_id: "ssh", ssh_host: "deploy@host.example" } });
  assert.match(local, /card-topology" data-mode="local"[^>]*>local<\/span><span class="card-workspace-location">repo/);
  assert.match(sandbox, /card-topology" data-mode="sandbox"[^>]*>sandbox<\/span><span class="card-workspace-location">repo/);
  assert.match(ssh, /card-topology" data-mode="ssh"[^>]*>ssh deploy@host\.example<\/span><span class="card-workspace-location">repo/);
  const escapedSsh = ui.renderSessionCard({ summary: { ...base, session_id: "ssh-escaped", ssh_host: "deploy@<host>" } });
  assert.match(escapedSsh, /data-mode="ssh"[^>]*>ssh deploy@&lt;host&gt;<\/span>/);
  assert.match(escapedSsh, /title="Execution target: ssh deploy@&lt;host&gt;"/);
  assert.doesNotMatch(escapedSsh, /deploy@<host>/);
  const header = fakeElement();
  const localLocation = ui.sessionExecutionLocationPresentation(base, null, { repo_label: "repo", branch: "main" });
  ui.applySessionExecutionLocation(header, localLocation);
  assert.equal(header.textContent, "local · repo · main · /workspace/repo");
  assert.equal(header.dataset.mode, "local");
  const sandboxLocation = ui.sessionExecutionLocationPresentation({ ...base, sandboxed: true }, null, { branch: "sandbox-work" });
  ui.applySessionExecutionLocation(header, sandboxLocation);
  assert.equal(header.textContent, "sandbox · sandbox-work · /workspace/repo");
  assert.equal(header.dataset.mode, "sandbox");
  const unsafeHost = "deploy@host-<exact>.example";
  const sshLocation = ui.sessionExecutionLocationPresentation({ ...base, ssh_host: unsafeHost }, null, { branch: "remote" });
  ui.applySessionExecutionLocation(header, sshLocation);
  assert.equal(header.textContent, `ssh ${unsafeHost} · remote · /workspace/repo`);
  assert.equal(header.title, header.textContent);
  assert.equal(header.dataset.mode, "ssh");
  assert.equal(header.getAttribute("aria-label"), `Execution target: ssh ${unsafeHost}. Working directory: /workspace/repo.`);
});

test("workspace summaries distinguish clean, not-loaded, and error states on cards and header metrics", () => {
  const summary = { session_id: "workspace-summary",
    cwd: "/workspace/repo", model: "model", pinned: false,
    visible_message_count: 0, };
  const clean = ui.renderSessionCard({ summary, workspace_diff: { total_additions: 0, total_deletions: 0 } });
  const unavailable = ui.renderSessionCard({ summary: { ...summary, session_id: "unavailable" } });
  const failed = ui.renderSessionCard({
    summary: { ...summary, session_id: "failed" },
    workspace_diff: { error: "git <failed> \"safely\"" }, });
  assert.match(clean, /class="changes" data-state="clean"[^>]*>\+0 −0<\/span>/);
  assert.match(clean, /title="Working tree clean\."/);
  assert.match(unavailable, /class="changes" data-state="unavailable"[^>]*>not loaded<\/span>/);
  assert.match(unavailable, /Workspace summary has not been loaded/);
  assert.match(failed, /class="changes" data-state="error"[^>]*>workspace error<\/span>/);
  assert.match(failed, /title="git &lt;failed&gt; &quot;safely&quot;"/);
  assert.doesNotMatch(failed, /git <failed>/);
  const metric = fakeElement();
  ui.applyWorkspaceSummaryMetric(metric, ui.workspaceSummaryPresentation({ total_additions: 0, total_deletions: 0 }));
  assert.equal(metric.textContent, "+0 −0");
  assert.equal(metric.dataset.state, "clean");
  assert.equal(metric.title, "Working tree clean.");
  assert.equal(metric.getAttribute("aria-label"), "Workspace changes: 0 additions and 0 deletions");
  ui.applyWorkspaceSummaryMetric(metric, ui.workspaceSummaryPresentation(null));
  assert.equal(metric.textContent, "not loaded");
  assert.equal(metric.dataset.state, "unavailable");
  ui.applyWorkspaceSummaryMetric(metric, ui.workspaceSummaryPresentation({ error: "workspace unavailable" }));
  assert.equal(metric.textContent, "workspace error");
  assert.equal(metric.dataset.state, "error");
  assert.equal(metric.title, "workspace unavailable");
  assert.equal(metric.getAttribute("aria-label"), "Workspace error: workspace unavailable");
});

test("workspace focus shows repository context and preserves every changed-file row", () => {
  ui.state.currentId = "workspace-session";
  const workspace = workspaceFixture({ repo_label: "acme/<unsafe>",
    branch: "feature/diffs", workspace_display: "/work/<repo>",
    total_additions: 12, total_deletions: 4, changed_files: [
      { status: "M", path: "src/one.js", additions: 8, deletions: 2 },
      { status: "A", path: "src/two.js", additions: 4, deletions: 0 },
      { status: "D", path: "src/three.js", additions: 0, deletions: 2 },
    ], });
  const html = ui.renderWorkspaceFocus(workspace, null);
  assert.match(html, /Workspace repository context/);
  assert.match(html, /acme\/&lt;unsafe&gt;/);
  assert.match(html, /feature\/diffs/);
  assert.match(html, /\/work\/&lt;repo&gt;/);
  assert.equal(occurrences(html, /data-focus-workspace-file=/g), 3);
  for (const path of ["src/one.js", "src/two.js", "src/three.js"]) assert.match(html, new RegExp(path.replace(".", "\\.")));
  assert.match(html, /Workspace totals: 12 additions and 4 deletions/);
});

test("multi-section workspace diffs retain section, hunk, line, and accessible table semantics", () => {
  const html = ui.renderWorkspaceFocusDiff("src/full.js", {
    status: "ready", diff: { path: "src/full.js", sections: [ {
          stage: "staged", status: "modified", binary: false,
          too_large: false, truncated: false, additions: 1,
          deletions: 1, error: null, hunks: [{ old_start: 10,
            old_lines: 2, new_start: 20, new_lines: 2,
            function_context: "function render<unsafe>()", lines: [
              { kind: "context", old_lineno: 10, new_lineno: 20, content: "  unchanged();", has_trailing_newline: true },
              { kind: "delete", old_lineno: 11, new_lineno: null, content: "remove(<old>);", has_trailing_newline: true },
              { kind: "insert", old_lineno: null, new_lineno: 21, content: "add(<new>);", has_trailing_newline: true },
            ], }], }, { stage: "unstaged", status: "added",
          binary: false, too_large: false, truncated: false,
          additions: 2, deletions: 0, error: null, hunks: [{
            old_start: 0, old_lines: 0, new_start: 1, new_lines: 2,
            function_context: null,
            lines: [{ kind: "insert", old_lineno: null, new_lineno: 1, content: "full content", has_trailing_newline: true }],
          }], }, ], }, });
  assert.match(html, /data-section-count="2"/);
  assert.match(html, /<dt>Sections<\/dt><dd>2<\/dd>/);
  assert.match(html, /<dt>Additions<\/dt><dd>\+3<\/dd>/);
  assert.match(html, /<dt>Deletions<\/dt><dd>−1<\/dd>/);
  assert.match(html, /Section 1 of 2/);
  assert.match(html, /staged · modified/);
  assert.match(html, /unstaged · added/);
  assert.match(html, /@@ -10,2 \+20,2 @@/);
  assert.match(html, /function render&lt;unsafe&gt;\(\)/);
  assert.equal(occurrences(html, /<caption>/g), 2);
  for (const heading of ["Old", "New", "Mark", "Content"]) assert.match(html, new RegExp(`<th scope="col">${heading}</th>`));
  assert.match(html, /aria-label="Context" data-marker=" "/);
  assert.match(html, /aria-label="Deletion" data-marker="−"/);
  assert.match(html, /aria-label="Addition" data-marker="\+"/);
  assert.match(html, /<td class="diff-line-number">10<\/td>/);
  assert.match(html, /No old line number/);
  assert.match(html, /remove\(&lt;old&gt;\);/);
  assert.match(html, /add\(&lt;new&gt;\);/);
  assert.doesNotMatch(html, /remove\(<old>\)/);
});

scenario("Workspace presentation", "workspace diff exceptional sections never collapse into the empty-diff state", () => {
  const render = (section) => ui.renderWorkspaceFocusDiff("asset.bin", {
    status: "ready", diff: { path: "asset.bin", sections: [section] },
  });
  const base = { stage: "unstaged", status: "modified", additions: 0, deletions: 0, hunks: [] };
  const fixtures = [
    [{ ...base, error: "cannot read <file>" }, /Section error[\s\S]*cannot read &lt;file&gt;/],
    [{ ...base, binary: true }, /Binary content cannot be shown inline/],
    [{ ...base, too_large: true }, /exceeds the inline diff size limit/],
  ];
  for (const [section, message] of fixtures) {
    const html = render(section);
    assert.match(html, message);
    assert.doesNotMatch(html, /No diff sections were returned|This section has no inline hunks/);
  }
  const truncated = render({ ...base, truncated: true, additions: 1,
    hunks: [{
      old_start: 1, old_lines: 1, new_start: 1, new_lines: 2, function_context: "partial",
      lines: [{ kind: "insert", old_lineno: null, new_lineno: 2, content: "retained line", has_trailing_newline: true }],
    }], });
  assert.match(truncated, /Truncated diff/);
  assert.match(truncated, /retained line/);
  assert.doesNotMatch(truncated, /No diff sections were returned|This section has no inline hunks/);
});

scenario("Workspace presentation", "workspace diff lines preserve newline evidence and full whitespace content", () => {
  const withNewline = ui.renderDiffLine({
    kind: "context", old_lineno: 7, new_lineno: 7, content: "\tconst value = '  spaced  ';", has_trailing_newline: true,
  });
  const withoutNewline = ui.renderDiffLine({
    kind: "delete", old_lineno: 8, new_lineno: null, content: "final line", has_trailing_newline: false,
  });
  assert.match(withNewline, /<code>\tconst value = &#39;  spaced  &#39;;<\/code>/);
  assert.doesNotMatch(withNewline, /No newline at end of file/);
  assert.match(withoutNewline, /\\ No newline at end of file/);
  assert.match(withoutNewline, /role="note"/);
});

scenario("Workspace presentation", "rename and copy file rows explain unsupported diffs and never fetch", async () => {
  let fetchCount = 0;
  const isolated = loadApp({ fetch: async () => { fetchCount += 1; return jsonResponse({}); } });
  const workspace = { repo_label: "acme/repo", branch: "main",
    changed_files: [
      { status: "R", path: "old.js -> new.js", additions: 1, deletions: 1 },
      { status: "C", path: "source.js -> copy.js", additions: 3, deletions: 0 },
      { status: "M", path: "supported.js", additions: 1, deletions: 0 },
    ], total_additions: 5, total_deletions: 1, };
  isolated.state.currentId = "rename-session";
  isolated.state.focusView = { type: "workspace", path: "old.js -> new.js" };
  isolated.state.snapshots.set("rename-session", { workspace });
  const html = isolated.renderWorkspaceFocus(workspace, "old.js -> new.js");
  assert.equal(occurrences(html, /data-diff-supported="false"/g), 2);
  assert.equal(occurrences(html, / disabled title=/g), 2);
  assert.match(html, /Renamed-path diffs are not available/);
  assert.match(html, /Copied-path diffs are not available/);
  assert.match(html, /no diff request will be made/);
  assert.equal(isolated.firstWorkspaceDiffPath(workspace), "supported.js");
  assert.equal(await isolated.loadFocusWorkspaceDiff("old.js -> new.js"), false);
  isolated.state.focusView.path = "source.js -> copy.js";
  assert.equal(await isolated.loadFocusWorkspaceDiff("source.js -> copy.js"), false);
  assert.equal(fetchCount, 0);
  assert.equal(isolated.state.workspaceDiffs.size, 0);
});

test("workspace diff request failures are accessible, escaped, and retryable rather than empty diffs", () => {
  const html = ui.renderWorkspaceFocusDiff("src/<fail>.js", { status: "error", message: "request <failed>" });
  assert.match(html, /role="alert"/);
  assert.match(html, /Diff request failed/);
  assert.match(html, /request &lt;failed&gt;/);
  assert.match(html, /data-retry-workspace-diff="src\/&lt;fail&gt;\.js"/);
  assert.match(html, /aria-label="Retry diff for src\/&lt;fail&gt;\.js"/);
  assert.doesNotMatch(html, /No diff sections were returned/);
  assert.doesNotMatch(html, /request <failed>/);
  const rootError = ui.renderWorkspaceFocusDiff("root.js", {
    status: "ready",
    diff: { path: "root.js", error: "root <error>", sections: [] },
  });
  assert.match(rootError, /Diff unavailable/);
  assert.match(rootError, /root &lt;error&gt;/);
  assert.match(rootError, /data-retry-workspace-diff="root\.js"/);
  assert.doesNotMatch(rootError, /No diff sections were returned/);
});

test("workspace diff cache hits, explicit invalidation, and force retry use fresh responses", async () => {
  const requests = [];
  const responses = [
    jsonResponse({ path: "src/cache.js", sections: [{ stage: "unstaged", status: "modified", additions: 1, deletions: 0, hunks: [] }] }),
    errorResponse(503, { error: "temporary <failure>" }),
    jsonResponse({ path: "src/cache.js", sections: [{ stage: "staged", status: "modified", additions: 2, deletions: 1, hunks: [] }] }),
  ];
  const isolated = loadApp({ fetch: async (path) => {
      requests.push(path);
      return responses.shift(); }, });
  settingsViewElements(isolated);
  const workspace = workspaceFixture({
    changed_files: [{ status: "M", path: "src/cache.js", additions: 1, deletions: 0 }],
    total_additions: 1, });
  isolated.state.currentId = "cache-session";
  isolated.state.focusView = { type: "workspace", path: "src/cache.js" };
  isolated.state.snapshots.set("cache-session", { workspace });
  assert.equal(await isolated.loadFocusWorkspaceDiff("src/cache.js"), true);
  assert.equal(isolated.state.workspaceDiffs.get("cache-session:src/cache.js").status, "ready");
  assert.equal(await isolated.loadFocusWorkspaceDiff("src/cache.js"), false);
  assert.equal(requests.length, 1);
  assert.equal(isolated.invalidateWorkspaceDiffs("cache-session", "src/cache.js"), 1);
  assert.equal(await isolated.loadFocusWorkspaceDiff("src/cache.js"), true);
  assert.equal(isolated.state.workspaceDiffs.get("cache-session:src/cache.js").status, "error");
  assert.match(isolated.el.focusContent.innerHTML, /temporary &lt;failure&gt;/);
  assert.match(isolated.el.focusContent.innerHTML, /data-retry-workspace-diff="src\/cache\.js"/);
  assert.equal(await isolated.loadFocusWorkspaceDiff("src/cache.js"), false);
  assert.equal(requests.length, 2);
  const retryButton = {
    dataset: { retryWorkspaceDiff: "src/cache.js" },
    closest(selector) { return selector === "[data-retry-workspace-diff]" ? this : null; },
  };
  assert.equal(await isolated.handleFocusClick({ target: retryButton }), true);
  const refreshed = isolated.state.workspaceDiffs.get("cache-session:src/cache.js");
  assert.equal(refreshed.status, "ready");
  assert.equal(refreshed.diff.sections[0].stage, "staged");
  assert.equal(requests.length, 3);
  assert.deepEqual(requests, Array(3).fill("/sessions/cache-session/workspace/diff?path=src%2Fcache.js&stage=all&context=3"));
});

test("successful snapshot refresh invalidates only that session's workspace diff cache", async () => {
  const isolated = loadApp({
    fetch: async () => jsonResponse({ metadata: { session_id: "refresh-session" }, messages: [], workspace: { changed_files: [] } }),
  });
  isolated.state.workspaceDiffs.set("refresh-session:one.js", { status: "ready", diff: { path: "one.js" } });
  isolated.state.workspaceDiffs.set("refresh-session:two.js", { status: "error", message: "old" });
  isolated.state.workspaceDiffs.set("other-session:one.js", { status: "ready", diff: { path: "one.js" } });
  assert.ok(await isolated.loadSnapshot("refresh-session"));
  assert.equal(isolated.state.workspaceDiffs.has("refresh-session:one.js"), false);
  assert.equal(isolated.state.workspaceDiffs.has("refresh-session:two.js"), false);
  assert.equal(isolated.state.workspaceDiffs.has("other-session:one.js"), true);
});

test("invalidated in-flight workspace requests cannot overwrite a newer cache entry", async () => {
  const older = deferred();
  const newer = deferred();
  const pending = [older, newer];
  const isolated = loadApp({ fetch: () => pending.shift().promise });
  settingsViewElements(isolated);
  const workspace = workspaceFixture({
    changed_files: [{ status: "M", path: "src/race.js", additions: 1, deletions: 0 }],
    total_additions: 1, });
  isolated.state.currentId = "race-session";
  isolated.state.focusView = { type: "workspace", path: "src/race.js" };
  isolated.state.snapshots.set("race-session", { workspace });
  const olderLoad = isolated.loadFocusWorkspaceDiff("src/race.js");
  assert.equal(isolated.state.workspaceDiffs.get("race-session:src/race.js").status, "loading");
  assert.equal(isolated.invalidateWorkspaceDiffs("race-session"), 1);
  const newerLoad = isolated.loadFocusWorkspaceDiff("src/race.js");
  newer.resolve(jsonResponse({ path: "src/race.js", sections: [{ stage: "new", status: "modified", additions: 2, deletions: 0, hunks: [] }] }));
  assert.equal(await newerLoad, true);
  assert.equal(isolated.state.workspaceDiffs.get("race-session:src/race.js").diff.sections[0].stage, "new");
  older.resolve(jsonResponse({ path: "src/race.js", sections: [{ stage: "stale", status: "modified", additions: 1, deletions: 0, hunks: [] }] }));
  assert.equal(await olderLoad, true);
  assert.equal(isolated.state.workspaceDiffs.get("race-session:src/race.js").diff.sections[0].stage, "new");
});

test("store metadata fetch exposes the exact path and preserves an accessible failure state", async () => {
  const requests = [];
  const loaded = loadApp({ fetch: async (path) => {
      requests.push(path);
      return jsonResponse({ root_cwd: "/srv/root",
        store_path: "/srv/state/nac sessions/store.sqlite3",
        worker_executable: "/srv/bin/nac-worker", }); }, });
  loaded.el.pickerStorePath = fakeElement();
  const info = await loaded.loadStoreInfo();
  assert.deepEqual(requests, ["/store"]);
  assert.equal(info.store_path, "/srv/state/nac sessions/store.sqlite3");
  assert.equal(loaded.el.pickerStorePath.textContent, "/srv/state/nac sessions/store.sqlite3");
  assert.equal(loaded.el.pickerStorePath.dataset.state, "ready");
  assert.equal(loaded.el.pickerStorePath.title, "/srv/state/nac sessions/store.sqlite3");
  assert.equal(loaded.el.pickerStorePath.getAttribute("aria-label"), "Session store: /srv/state/nac sessions/store.sqlite3");
  const failed = loadApp({ fetch: async () => ({ ok: false,
      status: 503, statusText: "Unavailable",
      async text() { return JSON.stringify({ error: "store lookup failed" }); },
    }), });
  failed.el.pickerStorePath = fakeElement();
  assert.equal(await failed.loadStoreInfo(), null);
  assert.equal(failed.state.store, null);
  assert.equal(failed.state.storeError, "store lookup failed");
  assert.equal(failed.el.pickerStorePath.textContent, "Store unavailable");
  assert.equal(failed.el.pickerStorePath.dataset.state, "error");
  assert.match(failed.el.pickerStorePath.getAttribute("aria-label"), /Session store unavailable: store lookup failed/);
});

test("session info renders only complete requested identity and execution fields", () => {
  const summary = { session_id: "session-<full>-0123456789",
    title: "Compact title",
    cwd: "/remote/work trees/<complete>/repository",
    model: "stale-model", backend: "stale-backend", sandboxed: false,
    ssh_host: "deploy@host-<exact>.example",
    model_config_error: "excluded-config-error", };
  const snapshot = { metadata: { session_id: summary.session_id,
      cwd: summary.cwd,
      model: "provider/model-with-a-very-long-<identity>",
      backend: "anthropic-<messages>", sandbox_status: "off",
      store_path: "/fallback/store.db",
      base_url: "https://excluded.example/secret-base",
      api_key_env: "EXCLUDED_SECRET_SELECTOR",
      extra_headers: { Authorization: "EXCLUDED_SECRET_HEADER" }, },
  };
  const html = ui.renderSessionInfo(summary, snapshot, {
    root_cwd: "/excluded/server/root",
    store_path: "/var/lib/nac/<exact store>.sqlite",
    worker_executable: "/excluded/worker", });
  for (const label of ["Session ID", "Working directory", "Execution topology", "SSH host", "Sandbox state", "Backend", "Model", "Store path"]) {
    assert.match(html, new RegExp(`<dt>${label}</dt>`)); }
  for (const exactValue of [ "session-&lt;full&gt;-0123456789",
    "/remote/work trees/&lt;complete&gt;/repository",
    "ssh deploy@host-&lt;exact&gt;.example",
    "deploy@host-&lt;exact&gt;.example", "anthropic-&lt;messages&gt;",
    "provider/model-with-a-very-long-&lt;identity&gt;",
    "/var/lib/nac/&lt;exact store&gt;.sqlite",
  ]) assert.match(html, new RegExp(exactValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /<dt>Sandbox state<\/dt><dd>off<\/dd>/);
  for (const excluded of ["secret-base", "EXCLUDED_SECRET_SELECTOR", "EXCLUDED_SECRET_HEADER", "excluded/server/root", "excluded/worker", "excluded-config-error"]) {
    assert.doesNotMatch(html, new RegExp(excluded)); }
  assert.match(ui.renderSessionInfo({ ...summary, ssh_host: null, sandboxed: true }, {
    metadata: { ...snapshot.metadata, sandbox_status: "running: podman" },
  }, { store_path: "/store.db" }), /<dt>Execution topology<\/dt><dd>sandbox<\/dd>[\s\S]*<dt>Sandbox state<\/dt><dd>running: podman<\/dd>/);
  assert.match(ui.renderSessionInfo({ ...summary, ssh_host: null, sandboxed: false }, null, { store_path: "/store.db" }), /<dt>Execution topology<\/dt><dd>local<\/dd>/);
});

test("compact session and thread surfaces recover full identities through titles and ARIA", () => {
  const summary = { session_id: "12345678-full-session-identity",
    title: "A compact session title",
    cwd: "/very/long/workspace/path/that/must/remain/recoverable",
    model: "provider/a-model-name-that-is-longer-than-twenty-four-characters",
    backend: "openai-responses", sandboxed: false, pinned: true,
    visible_message_count: 2, };
  const card = ui.renderSessionCard({ summary }, 0, [{ summary }]);
  assert.match(card, /title="A compact session title · session 12345678-full-session-identity"/);
  assert.match(card, /title="local · \/very\/long\/workspace\/path\/that\/must\/remain\/recoverable"/);
  assert.match(card, /title="provider\/a-model-name-that-is-longer-than-twenty-four-characters" aria-label="Model: provider\/a-model-name-that-is-longer-than-twenty-four-characters"/);
  assert.match(card, /aria-label="A compact session title · session 12345678-full-session-identity\. local\. Working directory \/very\/long\/workspace\/path\/that\/must\/remain\/recoverable\. Model provider\/a-model-name-that-is-longer-than-twenty-four-characters\. Workspace changes not loaded\."/);
  const thread = ui.renderThreadTile({
    name: "worker/a-very-long-thread-name-<with-context>",
    state: "running", compact: false, actions: [], });
  assert.match(thread, /class="thread-name" title="worker\/a-very-long-thread-name-&lt;with-context&gt;"/);
  assert.match(thread, /aria-label="Target worker\/a-very-long-thread-name-&lt;with-context&gt; for steering"/);
  assert.match(thread, /aria-label="Open worker\/a-very-long-thread-name-&lt;with-context&gt; fullscreen"/);
  assert.doesNotMatch(thread, /<with-context>/);
});

test("failed reorder announces the authoritative reloaded position instead of a stale original position", async () => {
  const body = fakeElement();
  const document = { addEventListener() {}, hidden: false, body };
  const authoritative = [
    { summary: { session_id: "session-B", title: "Beta", pinned: false, cwd: "/b", model: "m", visible_message_count: 0 } },
    { summary: { session_id: "session-A", title: "Alpha", pinned: false, cwd: "/a", model: "m", visible_message_count: 0 } },
  ];
  const requests = [];
  const isolated = loadApp({ document,
    fetch: async (path, options) => {
      requests.push({ path, method: options?.method || "GET" });
      if (path === "/sessions/order") return errorResponse(409, { error: "version conflict" });
      if (path === "/sessions") return jsonResponse(authoritative);
      throw new Error(`unexpected request ${path}`); },
    window: { setTimeout: () => 1, clearTimeout() {} }, });
  const grid = { ...fakeElement(), querySelectorAll() { return []; },
    querySelector() { return null; }, };
  const card = { ...fakeElement(), style: { removeProperty() {} },
    removeAttribute() {}, };
  isolated.el.sessionGrid = grid;
  isolated.el.pickerSessionTotal = fakeElement();
  isolated.el.reorderLive = fakeElement();
  isolated.el.sessionWorkspace = { hidden: true };
  isolated.el.pickerNavStatus = fakeElement();
  isolated.el.sessionNavStatus = fakeElement();
  isolated.state.sessions = [authoritative[1], authoritative[0]];
  const reorder = { kind: "keyboard", sessionId: "session-A",
    pinned: false, originalIds: ["session-A", "session-B"],
    currentIds: ["session-B", "session-A"], grid, card,
    placeholder: null, };
  isolated.state.sessionReorder = reorder;
  await isolated.commitSessionReorder(reorder);
  assert.deepEqual(requests, [
    { path: "/sessions/order", method: "PUT" },
    { path: "/sessions", method: "GET" }, ]);
  assert.deepEqual(plain(isolated.state.sessions.map((entry) => entry.summary.session_id)), ["session-B", "session-A"]);
  assert.match(isolated.el.reorderLive.textContent, /Alpha, position 2 of 2 in sessions\. Save failed; authoritative server order reloaded\. version conflict/);
  assert.doesNotMatch(isolated.el.reorderLive.textContent, /original order restored/i);
});

scenario("Focus and reorder", "picker polling rerenders restore the exact session, pin, and reorder control focus", () => {
  let document;
  const controls = [];
  const makeControl = (action, connected = true) => ({
    dataset: { action, sessionId: "picker-session" },
    tagName: "BUTTON", id: "", name: "", hidden: false,
    disabled: false, isConnected: connected,
    getAttribute() { return null; },
    closest(selector) { return selector === "[data-action][data-session-id]" ? this : null; },
    focus() { document.activeElement = this; this.focused = true; },
  });
  const grid = { _html: "",
    contains(target) { return target?.dataset?.sessionId === "picker-session"; },
    querySelectorAll() { return controls; }, set innerHTML(value) {
      this._html = value;
      controls.splice(0, controls.length,
        makeControl("open-session"), makeControl("toggle-pin"), makeControl("move-session"));
    }, get innerHTML() { return this._html; }, };
  document = {
    addEventListener() {}, hidden: false, body: {}, documentElement: {}, activeElement: null,
    querySelectorAll() { return []; }, };
  const isolated = loadApp({ document });
  isolated.el.pickerSessionTotal = fakeElement();
  isolated.el.sessionGrid = grid;
  isolated.state.sessions = [{ summary: {
    session_id: "picker-session", cwd: "/repo", model: "model", backend: "openai-responses",
    title: "Picker", pinned: false, sandboxed: false, visible_message_count: 0,
  } }];
  for (const action of ["open-session", "toggle-pin", "move-session"]) {
    const oldControl = makeControl(action);
    document.activeElement = oldControl;
    isolated.renderPicker();
    oldControl.isConnected = false;
    assert.equal(document.activeElement.dataset.action, action);
    assert.equal(document.activeElement.dataset.sessionId, "picker-session");
    assert.equal(document.activeElement.focused, true); }
});

scenario("Focus and reorder", "session reorder labels and announcements retain group, position, and save context", () => {
  ui.state.sessions = [{ summary: { session_id: "pinned-session", title: "Pinned one", pinned: true } }];
  assert.equal(ui.sessionReorderControlLabel(ui.state.sessions[0].summary, 1, 4), "Reorder Pinned one; position 2 of 4 in pinned sessions");
  assert.equal(ui.reorderAnnouncement("pinned-session", 2, 4, true, "Saved."), "Pinned one, position 3 of 4 in pinned sessions. Saved.");
});

test("settings and launch credential help describes selectors without soliciting secrets", () => {
  ui.state.currentId = "settings-session";
  ui.state.settingsFocus = { sessionId: "settings-session",
    status: "ready", config: persistedConfig(), };
  assert.match(ui.renderFocusSettings(), /Enter the environment-variable name only, never a key value\. Blank removes the session-specific selector/);
});

test("event-driven workspace renders coalesce to one animation frame and stay session-bound", () => {
  const frames = [];
  const isolated = loadApp({ requestAnimationFrame: (callback) => {
    frames.push(callback);
    return frames.length; } });
  isolated.state.currentId = "session-A";
  let renders = 0;
  assert.equal(isolated.scheduleWorkspaceRender("session-A", () => { renders += 1; }), true);
  assert.equal(isolated.scheduleWorkspaceRender("session-A", () => { renders += 1; }), false);
  assert.equal(isolated.scheduleWorkspaceRender("session-A", () => { renders += 1; }), false);
  assert.equal(frames.length, 1);
  assert.equal(renders, 0);
  frames.shift()();
  assert.equal(renders, 1);
  assert.equal(isolated.scheduleWorkspaceRender("session-A", () => { renders += 1; }), true);
  isolated.state.currentId = "session-B";
  frames.shift()();
  assert.equal(renders, 1, "a queued render must not migrate to a newly selected session");
});

test("control, form, and inner or outer scroll restoration helpers preserve live UI state", () => {
  const oldInput = { id: "draft-field", tagName: "TEXTAREA",
    name: "draft", dataset: {}, value: "unsaved draft",
    checked: false, selectionStart: 4, selectionEnd: 9,
    isConnected: true,
    getAttribute(name) { return name === "name" ? this.name : null; },
  };
  const oldRoot = { querySelectorAll: () => [oldInput] };
  const captured = ui.captureFormControlStates(oldRoot);
  oldInput.isConnected = false;
  const replacement = { ...oldInput, value: "server render",
    selectionStart: 0, selectionEnd: 0, isConnected: true,
    focused: false, focus() { this.focused = true; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
  };
  const newRoot = {
    getElementById(id) { return id === replacement.id ? replacement : null; },
    querySelectorAll() { return [replacement]; }, };
  ui.restoreFormControlStates(captured, newRoot);
  assert.equal(replacement.value, "unsaved draft");
  assert.equal(replacement.selectionStart, 4);
  assert.equal(replacement.selectionEnd, 9);
  assert.equal(ui.restoreFocusTarget(captured[0].target, newRoot), replacement);
  assert.equal(replacement.focused, true);
  const outer = { scrollTop: 73, scrollLeft: 5, scrollHeight: 900, clientHeight: 300 };
  const episodes = { scrollTop: 211, scrollLeft: 0, scrollHeight: 1200, clientHeight: 420 };
  const scroll = ui.captureScrollPositions([["focus-content", outer], ["thread-episodes", episodes]]);
  const newOuter = { scrollTop: 0, scrollLeft: 0 };
  const newEpisodes = { scrollTop: 0, scrollLeft: 0 };
  ui.restoreScrollPositions(scroll, [["focus-content", newOuter], ["thread-episodes", newEpisodes]]);
  assert.deepEqual(
    plain([newOuter.scrollTop, newOuter.scrollLeft, newEpisodes.scrollTop]),
    [73, 5, 211]);
});

test("fullscreen focus entry targets its heading, clears leaked state, and close restores its opener", () => {
  let document;
  const body = { id: "body", isConnected: true };
  const focusable = (id, tagName = "BUTTON") => ({ ...fakeElement(),
    id, tagName, name: "", isConnected: true,
    focus() { document.activeElement = this; }, });
  const opener = focusable("sessionInfo");
  document = { addEventListener() {}, hidden: false, body,
    documentElement: {}, activeElement: opener,
    getElementById(id) { return id === opener.id ? opener : null; },
    querySelectorAll() { return []; }, };
  const isolated = loadApp({ document });
  const focusTitle = focusable("focusTitle", "H2");
  const focusContent = { innerHTML: "",
    querySelector() { return null; },
    querySelectorAll() { return []; }, };
  isolated.el.sessionInfo = opener;
  isolated.el.sessionLayout = fakeElement();
  isolated.el.focusPanel = { ...fakeElement(), hidden: true };
  isolated.el.focusTitle = focusTitle;
  isolated.el.focusState = fakeElement();
  isolated.el.focusState.dataset.state = "failed";
  isolated.el.focusContent = focusContent;
  isolated.el.threadGrid = { innerHTML: "", querySelector() { return null; } };
  isolated.el.composerTarget = { hidden: true };
  isolated.el.composerTargetName = fakeElement();
  isolated.el.sendPrompt = { disabled: false };
  isolated.el.promptInput = { ...focusable("promptInput", "TEXTAREA"), placeholder: "", setAttribute() {} };
  isolated.state.currentId = "focus-session";
  isolated.state.sessions = [{ summary: {
    session_id: "focus-session", title: "Focus", cwd: "/repo", model: "m",
    backend: "openai-responses", sandboxed: false, pinned: false,
  } }];
  isolated.openFocusView("info");
  assert.equal(document.activeElement, focusTitle);
  assert.equal(isolated.el.focusState.dataset.state, "local");
  assert.equal(isolated.state.focusOpener.id, "sessionInfo");
  isolated.state.focusView = { type: "worksets", name: null, path: null };
  isolated.renderFocusView(null);
  assert.equal(Object.hasOwn(isolated.el.focusState.dataset, "state"), false, "views without a state token must clear the prior token");
  isolated.closeFocusView();
  assert.equal(document.activeElement, opener);
  assert.equal(isolated.state.focusOpener, null);
  opener.hidden = true;
  document.activeElement = focusTitle;
  isolated.state.focusView = { type: "settings", name: null, path: null };
  isolated.state.focusOpener = isolated.captureFocusTarget(opener);
  isolated.state.settingsFocus = { sessionId: "focus-session", requestGeneration: 1, status: "ready", config: {} };
  isolated.closeFocusView();
  assert.equal(document.activeElement, isolated.el.promptInput, "a hidden remembered opener must fall back to the visible default control");
});

test("utility drawer applies modal background semantics, contains Tab, and restores its opener", () => {
  let document;
  const focusable = (id) => ({ ...fakeElement(), id,
    tagName: "BUTTON", isConnected: true, hidden: false,
    disabled: false, focus() { document.activeElement = this; }, });
  const opener = focusable("drawer-opener");
  const close = focusable("closeDrawer");
  const action = focusable("drawer-action");
  document = {
    addEventListener() {}, hidden: false, body: {}, documentElement: {}, activeElement: opener,
    getElementById(id) { return id === opener.id ? opener : null; },
    querySelectorAll() { return []; }, };
  const isolated = loadApp({ document });
  isolated.el.app = { ...fakeElement(), inert: false };
  isolated.el.drawerTitle = fakeElement();
  isolated.el.drawerContent = { innerHTML: "" };
  isolated.el.drawerBackdrop = { hidden: true };
  isolated.el.closeDrawer = close;
  isolated.el.utilityDrawer = { ...fakeElement(), hidden: true,
    querySelectorAll() { return [close, action]; },
    contains(item) { return item === close || item === action; }, };
  isolated.openDrawer("commands", "<button>action</button>");
  assert.equal(document.activeElement, close);
  assert.equal(isolated.el.app.inert, true);
  assert.equal(isolated.el.app.getAttribute("aria-hidden"), "true");
  document.activeElement = action;
  let prevented = false;
  isolated.handleDrawerKeydown({ key: "Tab", shiftKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(document.activeElement, close);
  isolated.closeDrawer();
  assert.equal(isolated.el.app.inert, false);
  assert.equal(isolated.el.app.getAttribute("aria-hidden"), null);
  assert.equal(document.activeElement, opener);
});

test("boot starts store and session requests concurrently and does not await a hung store", async () => {
  const store = deferred();
  const requests = [];
  const isolated = loadApp({ fetch: async (path) => {
      requests.push(path);
      if (path === "/store") return store.promise;
      if (path === "/sessions?workspace_stats=true") return jsonResponse([]);
      throw new Error(`unexpected request ${path}`); },
    window: { setInterval: () => 41, clearInterval() {} }, });
  isolated.el.pickerStorePath = fakeElement();
  isolated.el.pickerSessionTotal = fakeElement();
  isolated.el.sessionGrid = { innerHTML: "" };
  await isolated.boot();
  assert.deepEqual(requests, ["/store", "/sessions?workspace_stats=true"]);
  assert.equal(isolated.state.pollTimer, 41);
  assert.equal(isolated.el.pickerSessionTotal.textContent, 0);
  assert.equal(isolated.el.pickerStorePath.textContent, "Loading store…");
});

test("late store metadata does not overwrite an already-started launch draft", async () => {
  const response = deferred();
  const isolated = loadApp({ fetch: async () => response.promise });
  isolated.el.pickerStorePath = fakeElement();
  isolated.el.launchCwd = { value: "/typed/before/store" };
  const loading = isolated.loadStoreInfo();
  isolated.state.launchCwdDrafts = { localSandbox: "/typed/before/store", ssh: "~/remote-draft" };
  response.resolve(jsonResponse({ root_cwd: "/server/root", store_path: "/store.db" }));
  await loading;
  assert.equal(isolated.el.launchCwd.value, "/typed/before/store");
  assert.deepEqual(plain(isolated.state.launchCwdDrafts), {
    localSandbox: "/typed/before/store", ssh: "~/remote-draft", });
});

for (const [group, rows] of scenarioGroups) {
  test(`${group} scenarios`, async () => {
    const failures = [];
    for (const [name, run] of rows) {
      ui = loadApp();
      try { await run(); }
      catch (error) {
        error.message = `${name}: ${error.message}`;
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, `${group} scenarios failed`);
  });
}
