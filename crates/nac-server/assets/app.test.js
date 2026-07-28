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
    URL,
    module: { exports: {} },
  };
  vm.runInNewContext(
    `${appSource}\nmodule.exports = {
      state, el, boot, openSession, sessionStatus, syncSessionRunIndicators, noteSessionRunEvent,
      emptyCompactionOperation, compactionOperationBusy, reduceCompactionOperation,
      sessionCompactionOperation, transitionSessionCompaction, sessionCompactionBusy,
      reconcileSessionCompactionSnapshot, noteSessionCompactionEvent,
      clearSessionAttention, buildThreadModels, projectThreadActions, mergeThreadEvidence,
      orchestratorLifecycle, buildOrchestratorActions, renderActionRows, selectTileActions,
      renderThreadEpisodes, renderThreadTile, renderFocusMessage, renderOrchestratorChatRail,
      renderSessionCard, sessionExecutionTopology, sessionExecutionLocationPresentation,
      applySessionExecutionLocation, sessionReorderControlLabel, reorderAnnouncement,
      commitSessionReorder, mergeSnapshotMessageWindow, prependMessageWindow,
      workspaceSummaryPresentation, applyWorkspaceSummaryMetric, renderPicker, loadStoreInfo,
      renderSessionInfo, loadSessions, loadSnapshot, acceptSnapshot, loadOlderOrchestratorMessages,
      orchestratorHistoryNeedsFill, ensureOrchestratorScrollableHistory,
      normalizedSubmittedMessage, pendingMessageCoveredByCanonical, captureAcceptedRun,
      effectiveActiveRun, effectivePendingMessages, reconcileAcceptedRun,
      responseDurationAssignments, runTimingPresentation, updateRuntimeMetric,
      threadCycleSeed, displaySessionTitle, shortId, basename, shortModel, formatNumber,
      formatTokenCount, backendOptions, renderFocusMarkdown, renderMarkdownImageToken,
      safeMarkdownHref, renderMarkdownLinkOpen, renderMarkdownLinkClose,
      displayedTokenUsage, usageRunId, orchestratorContextTokens, tokenUsageSummary,
      tokenUsageTitle, effortOptions, escapeHtml, rawHeadersFromConfig, settingsValuesFromConfig,
      serializeSettingsHeaders, buildSettingsPatch, loadFocusSettings, renderFocusSettings,
      handleDrawerSubmit, scheduleWorkspaceRender, renderWorkspace, renderComposerTarget,
      captureFocusTarget, restoreFocusTarget,
      captureFormControlStates, restoreFormControlStates, captureScrollPositions,
      restoreScrollPositions, openFocusView, closeFocusView, renderFocusView, renderCommandReference,
      handleOrchestratorChatScroll,
      renderConfigRepairGuidance, recordSessionEnvelope,
      connectEventStream, worksetsPresentation, renderWorksetsFocus,
      firstWorkspaceDiffPath, invalidateWorkspaceDiffs, renderWorkspaceFocus,
      renderWorkspaceFocusDiff, renderDiffLine, loadFocusWorkspaceDiff, handleFocusClick,
      transitionLaunchCwdDrafts, syncLaunchExecutionFields, buildLaunchDefaultsRequest,
      loadLaunchDefaultsPreview, managedLaunchDefaults, renderLaunchDefaultsPreviewHtml,
      syncLaunchApiKeyMode, buildLaunchSessionRequest, persistComposerDraft, restoreComposerDraft,
      clearComposerDraftIfUnchanged, compactSession, submitComposer, runCommand, upsertCreatedSession, createSession,
      confirmSessionDeletion, showPicker, renderCommandMenu, handleComposerKeydown,
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

function agentEnvelope(sequenceId, event, epochId = "test-epoch") {
  return { epoch_id: epochId, sequence_id: sequenceId, event: { type: "agent", event } };
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
      if (typeof payload !== "string" && ["replay_boundary", "session_event"].includes(type) && !payload.epoch_id) {
        payload = { epoch_id: "test-epoch", ...payload };
      }
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

function sessionListEntry(sessionId, overrides = {}) {
  return {
    active_run: null,
    ...overrides,
    summary: {
      session_id: sessionId, cwd: `/${sessionId}`, model: "test-model", backend: "test",
      pinned: false, visible_message_count: 0, ...overrides.summary,
    },
  };
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
    orchestrator_compaction_threshold: null,
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
      orchestrator_compaction_threshold: "",
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

function installWorkspaceElements(uiInstance) {
  const element = () => ({ ...fakeElement(), style: {}, value: "", scrollHeight: 40,
    hidden: false, innerHTML: "", querySelector() { return null; }, querySelectorAll() { return []; }, });
  for (const name of [
    "sessionPicker", "sessionWorkspace", "sessionTitle", "renameSession", "sessionLocation",
    "metricModel", "metricContext", "metricTokens", "metricRun", "metricChanges", "stopRun",
    "orchestratorChatContent",
    "threadGrid", "composerTarget", "composerTargetName",
    "sendPrompt", "promptInput", "commandMenu", "focusContent", "sessionLayout", "focusPanel", "focusState",
    "pickerSessionTotal", "sessionGrid", "pickerNavStatus", "sessionNavStatus",
  ]) uiInstance.el[name] = element();
}

function installComposerElements(uiInstance, sessionId, draft = "") {
  installWorkspaceElements(uiInstance);
  uiInstance.state.currentId = sessionId;
  uiInstance.state.sessions = [sessionListEntry(sessionId)];
  uiInstance.state.snapshots.set(sessionId, sessionSnapshot(sessionId));
  uiInstance.state.composerDrafts.set(sessionId, draft);
  uiInstance.el.sessionWorkspace.hidden = false;
  uiInstance.el.sessionPicker.hidden = true;
  uiInstance.el.promptInput.value = draft;
  uiInstance.el.promptInput.focus = function focus() { this.focused = true; };
  return uiInstance;
}

test("production shell preserves privacy and mobile chat-only access", () => {
  for (const id of ["sessionPicker", "sessionWorkspace", "focusPanel", "promptInput"]) {
    assert.match(indexSource, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(indexSource, /Session Events/i);
  assert.match(redesignSource, /\.session-layout \{[^}]*grid-template-columns: min\(780px, 48vw\) minmax\(0, 1fr\)/s);
  assert.match(redesignSource, /\.orchestrator-chat-content \{/);
});

test("session opening renders the workspace and starts snapshot and SSE without removed-surface references", () => {
  const { FakeEventSource, instances } = eventSourceHarness();
  const requests = [];
  const isolated = loadApp({ EventSource: FakeEventSource,
    fetch(path) { requests.push(path); return new Promise(() => {}); }, });
  installWorkspaceElements(isolated);
  isolated.el.sessionWorkspace.hidden = true;
  Object.defineProperty(isolated.el.promptInput, "scrollHeight", {
    get() { return isolated.el.sessionWorkspace.hidden ? 0 : 50; },
  });
  isolated.state.sessions = [{ summary: { session_id: "release-session", cwd: "/repo", model: "gpt-5" } }];
  isolated.state.snapshots.set("release-session", sessionSnapshot("release-session"));
  assert.doesNotThrow(() => isolated.openSession("release-session"));
  assert.equal(isolated.el.sessionWorkspace.hidden, false);
  assert.equal(isolated.el.promptInput.style.height, "50px");
  assert.deepEqual(requests, ["/sessions/release-session?message_limit=24&thread_event_limit=24&include_sessions=false"]);
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
  isolated.noteSessionCompactionEvent(sessionId, {
    type: "orchestrator_compaction_failed", compaction_id: "old-terminal", reason: "manual", failure: "cancelled",
  });
  isolated.noteSessionCompactionEvent(sessionId, {
    type: "orchestrator_compaction_started", compaction_id: "old-active", reason: "manual",
  });
  isolated.state.snapshots.set(sessionId, {
    metadata: { session_id: sessionId }, messages: [], active_run: { run_id: "old" },
    active_compaction: { compaction_id: "old-active" },
  });
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
  assert.equal(isolated.state.snapshots.get(sessionId).active_compaction, null);
  assert.equal(isolated.sessionCompactionBusy(sessionId), false);
  assert.deepEqual(plain(isolated.sessionCompactionOperation(sessionId).terminalCompactionIds), []);
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
  isolated.noteSessionCompactionEvent(sessionId, {
    type: "orchestrator_compaction_started", compaction_id: "gap-active", reason: "manual",
  });
  isolated.connectEventStream(sessionId);
  const first = instances[0];
  first.emit("replay_boundary", { replay_boundary_sequence_id: 10 });
  first.emit("session_event", { session_id: sessionId, sequence_id: 11, event: { type: "future", value: "before lag" } });
  first.emit("replay_gap", { replay_gap: { missing_from_sequence_id: 2, missing_to_sequence_id: 9 } });
  assert.equal(isolated.sessionCompactionBusy(sessionId), true,
    "a replay gap fences snapshots but keeps known busy state until reconciliation");
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
  const refreshDrain = isolated.state.snapshotRefreshCoordinators.get(sessionId)?.promise;
  assert.ok(refreshDrain);
  await refreshDrain;
  assert.equal(isolated.sessionCompactionBusy(sessionId), false,
    "the authoritative post-gap snapshot clears the active compaction");
  assert.equal(requests.filter((path) => path.startsWith(`/sessions/${sessionId}?`)).length, 2,
    "gap, lag, and malformed-stream invalidations coalesce into one sequential trailing refresh");
});

scenario("SSE", "replay-gap compaction reconciliation retries a snapshot invalidated by historical lifecycle events", async () => {
  const { FakeEventSource, instances } = eventSourceHarness();
  const firstSnapshot = deferred();
  const trailingSnapshot = deferred();
  const responses = [firstSnapshot, trailingSnapshot];
  const requests = [];
  const isolated = loadApp({
    EventSource: FakeEventSource,
    fetch(path) {
      requests.push(path);
      const response = responses.shift();
      assert.ok(response, "snapshot reconciliation must not loop");
      return response.promise;
    },
  });
  const sessionId = "gap-compaction-fence";
  isolated.state.currentId = sessionId;
  isolated.connectEventStream(sessionId);
  const source = instances[0];
  source.emit("replay_boundary", { replay_boundary_sequence_id: 1 });
  source.emit("replay_gap", { replay_gap: { missing_from_sequence_id: 1, missing_to_sequence_id: 1 } });
  const refreshDrain = isolated.state.snapshotRefreshCoordinators.get(sessionId)?.promise;
  assert.ok(refreshDrain);
  assert.equal(requests.length, 1, "the replay gap starts the fenced authoritative snapshot");

  source.emit("session_event", agentEnvelope(1, {
    type: "orchestrator_compaction_started", compaction_id: "terminal-missed-in-gap", reason: "manual",
  }));
  assert.equal(isolated.sessionCompactionBusy(sessionId), true);

  firstSnapshot.resolve(jsonResponse(sessionSnapshot(sessionId, { active_compaction: null })));
  await flushPromises();
  await flushPromises();
  await flushPromises();
  assert.equal(requests.length, 2,
    "discarding the snapshot at the old lifecycle revision starts a trailing authoritative refresh");
  assert.equal(isolated.sessionCompactionBusy(sessionId), true,
    "the invalidated first snapshot cannot clear newer lifecycle state");

  trailingSnapshot.resolve(jsonResponse(sessionSnapshot(sessionId, { active_compaction: null })));
  await refreshDrain;
  assert.equal(requests.length, 2, "the accepted trailing snapshot does not create a refresh loop");
  assert.equal(isolated.sessionCompactionOperation(sessionId).activeCompactionId, null);
  assert.equal(isolated.sessionCompactionBusy(sessionId), false,
    "the trailing null snapshot reconciles a terminal missed by replay");
  assert.equal(isolated.state.snapshots.get(sessionId).active_compaction, null);
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
    session_id: sessionId, epoch_id: "test-epoch", sequence_id: 3,
    event: { type: "run_started", prompt_preview: "new run", started_at_epoch_ms: 2 },
  }), true);
  assert.equal(isolated.state.sessionRunActivity.get(sessionId), true);
});

test("workset presentation exposes authoritative status, item counts, errors, and empty state", () => {
  for (const snapshot of [{}, { worksets: null }, { worksets: { items: null, error: null } }]) {
    const presentation = ui.worksetsPresentation(snapshot);
    assert.equal(presentation.state, "error");
    assert.match(presentation.error, /unavailable/i); }
  const errPresentation = ui.worksetsPresentation({ worksets: { items: [], error: "database <offline>" } });
  assert.equal(errPresentation.state, "error");
  assert.match(errPresentation.error, /database <offline>/);
  const emptyPresentation = ui.worksetsPresentation({ worksets: { items: [], error: null } });
  assert.equal(emptyPresentation.state, "empty");
  const populatedPresentation = ui.worksetsPresentation({ worksets: { error: null, items: [{
        id: "plan-<ui>", status: "in_review",
        summary: "Restore <all> fields",
        items: [{ title: "one", status: "invented-item-status" }, { title: "two" }],
      }], }, });
  assert.equal(populatedPresentation.state, "populated");
  assert.equal(populatedPresentation.items.length, 1);
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
  ui.state.sessions = [running];
  ui.noteSessionRunEvent("attention-session", "run_started", "run-1");
  ui.noteSessionRunEvent("attention-session", "run_completed", "run-1");
  assert.equal(ui.sessionStatus(running), "attention");
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

scenario("Semantic orchestrator transcript", "tool turns are compact, grouped, and omit result rows", () => {
  ui.el.orchestratorChatContent = fakeElement();
  ui.renderOrchestratorChatRail({
    messages: [
      { role: "user", content: "build the feature" },
      { role: "assistant", content: "private intermediate narration", reasoning_text: "private reasoning", tool_calls: [
        { id: "call-workset", function: { name: "workset_define", arguments: '{"id":"ui-refresh","goal":"RAW_WORKSET_GOAL"}' } },
        { id: "call-one", function: { name: "thread", arguments: '{"name":"impl/shell","action":"RAW_THREAD_ACTION"}' } },
        { id: "call-two", function: { name: "thread", arguments: '{"name":"verify/ui","action":"RAW_THREAD_ACTION_TWO"}' } },
      ] },
      { role: "tool", tool_call_id: "call-workset", content: "RAW_WORKSET_RESULT" },
      { role: "tool", tool_call_id: "call-one", content: "RAW_THREAD_RESULT" },
      { role: "assistant", content: "The feature is complete.", reasoning_text: null, tool_calls: null },
    ],
    active_run: null,
  });
  const html = ui.el.orchestratorChatContent.innerHTML;
  assert.match(html, /build the feature/);
  assert.match(html, /The feature is complete\./);
  assert.match(html, /focus-tool-summary/);
  assert.match(html, /workset_define/);
  assert.match(html, /ui-refresh/);
  assert.match(html, /threads dispatched/);
  assert.match(html, /impl\/shell, verify\/ui/);
  assert.doesNotMatch(html, /data-role="tool"|Tool result|RAW_WORKSET_RESULT|RAW_THREAD_RESULT/);
  assert.doesNotMatch(html, /private intermediate narration|private reasoning|RAW_WORKSET_GOAL|RAW_THREAD_ACTION/);
});

test("compaction activity correlates lifecycle IDs and safely renders every terminal state", () => {
  ui.state.currentId = "compaction-activity";
  ui.state.events.set("compaction-activity", [
    agentEnvelope(1, {
      type: "orchestrator_compaction_started", compaction_id: "completed-id", reason: "manual",
      summary: "SECRET START SUMMARY", checkpoint: "/private/start-checkpoint",
    }),
    agentEnvelope(2, {
      type: "orchestrator_compaction_completed", compaction_id: "completed-id", reason: "manual",
      summary: "SECRET COMPLETED SUMMARY", raw_error: "RAW COMPLETION ERROR",
    }),
    agentEnvelope(3, {
      type: "orchestrator_compaction_skipped", compaction_id: "skipped-without-start", reason: "auto",
      cause: "no_eligible_boundary", summary: "SECRET SKIP SUMMARY",
    }),
    agentEnvelope(4, {
      type: "orchestrator_compaction_failed", compaction_id: "failed-without-start", reason: "manual",
      failure: "checkpoint_persistence_failed", error: "database at /private/path failed",
    }),
    agentEnvelope(5, {
      type: "orchestrator_compaction_started", compaction_id: "running-id", reason: "auto",
      prompt: "SECRET PROMPT",
    }),
    agentEnvelope(6, {
      type: "orchestrator_compaction_failed", compaction_id: "unknown-safe", reason: "unexpected reason",
      failure: "raw failure <script>alert(1)</script>", raw_error: "RAW UNKNOWN FAILURE",
    }),
  ]);

  const actions = plain(ui.buildOrchestratorActions({ messages: [] }, { limit: false }));
  assert.equal(actions.filter(({ name }) => name === "context compaction").length, 5,
    "a correlated start and terminal occupy one logical row");
  assert.deepEqual(actions.filter(({ name }) => name === "context compaction").map((action) => ({
    id: action.compactionId, result: action.result, state: action.state, detail: action.detail,
    finishSequenceId: action.finishSequenceId ?? null,
  })), [
    { id: "completed-id", result: "completed", state: "done", detail: "Manual", finishSequenceId: 2 },
    { id: "skipped-without-start", result: "unchanged", state: "recorded", detail: "Automatic · Nothing to compact", finishSequenceId: null },
    { id: "failed-without-start", result: "failed", state: "error", detail: "Manual · Failed to save checkpoint", finishSequenceId: null },
    { id: "running-id", result: "running", state: "live", detail: "Automatic", finishSequenceId: null },
    { id: "unknown-safe", result: "failed", state: "error", detail: "Not triggered · failure type unavailable", finishSequenceId: null },
  ]);
});

scenario("SSE", "compaction replay retains correlated activity and reconciles manual busy state", () => {
  const { FakeEventSource, instances } = eventSourceHarness();
  const isolated = loadApp({ EventSource: FakeEventSource });
  const sessionId = "compaction-replay";
  isolated.state.currentId = sessionId;
  isolated.connectEventStream(sessionId);
  const source = instances[0];
  source.emit("replay_boundary", { replay_boundary_sequence_id: 4 });
  source.emit("session_event", agentEnvelope(1, {
    type: "orchestrator_compaction_started", compaction_id: "replayed-manual", reason: "manual",
  }));
  assert.equal(isolated.sessionCompactionBusy(sessionId), true);
  source.emit("session_event", agentEnvelope(2, {
    type: "orchestrator_compaction_completed", compaction_id: "replayed-manual", reason: "manual",
  }));
  source.emit("session_event", agentEnvelope(3, {
    type: "orchestrator_compaction_started", compaction_id: "replayed-auto", reason: "auto",
  }));
  source.emit("session_event", agentEnvelope(4, {
    type: "orchestrator_compaction_skipped", compaction_id: "replayed-auto", reason: "auto",
    cause: "already_compacted",
  }));
  assert.equal(isolated.sessionCompactionBusy(sessionId), false);
  assert.ok(isolated.sessionCompactionOperation(sessionId).terminalCompactionIds.includes("replayed-manual"));
  assert.equal(isolated.state.lastSequence.get(sessionId), 4);
  const actions = isolated.buildOrchestratorActions({ messages: [] }, { limit: false });
  assert.deepEqual(plain(actions.map(({ result, detail }) => ({ result, detail }))), [
    { result: "completed", detail: "Manual" },
    { result: "unchanged", detail: "Automatic · Already compacted" },
  ]);
});

scenario("Transcript privacy", "shared transcript message rendering excludes system rows without dropping supported message fields", () => {
  const system = ui.renderFocusMessage({ role: "system", content: "policy <root>" }, { ordinal: 25 });
  assert.equal(system, "");
  const assistant = ui.renderFocusMessage({ role: "assistant",
    reasoning_text: "reason <carefully>", content: "answer <safely>",
    tool_calls: [{ id: "call-<42>",
      function: { name: "thread", arguments: '{"name":"review/<unsafe>","action":"RAW_TOOL_ARGUMENT_CANARY"}' },
    }], }, { ordinal: 26, durationMs: 2_500 });
  assert.match(assistant, /focus-message is-tool-turn/);
  assert.match(assistant, /threads dispatched/);
  assert.match(assistant, /review\/&lt;unsafe&gt;/);
  assert.doesNotMatch(assistant, /RAW_TOOL_ARGUMENT_CANARY|call-&lt;42&gt;|reason &lt;carefully&gt;|answer &lt;safely&gt;|response 00:00:02/);
  assert.doesNotMatch(assistant, /<unsafe>|<carefully>|<safely>/);
  const tool = ui.renderFocusMessage({ role: "tool", tool_call_id: "call-<42>", content: "RAW_TOOL_RESULT_CANARY" }, { ordinal: 27 });
  assert.equal(tool, "");
  const empty = ui.renderFocusMessage({ role: "assistant", content: null, reasoning_text: null, tool_calls: [] }, { ordinal: 28 });
  assert.match(empty, /focus-message-copy is-empty/);
  assert.match(empty, /empty message/);
  assert.match(empty, /\[empty\]/);
  const pending = ui.renderFocusMessage({
    role: "user", content: "just accepted", pending: true, pendingSource: "accepted response <client>",
  });
  assert.match(pending, /class="focus-message is-pending"/);
  assert.match(pending, /Sending…/);
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
  ui.el.orchestratorChatContent = fakeElement();
  ui.renderOrchestratorChatRail(sessionSnapshot("reasoning-session", {
    messages: [
      { role: "system", content: "private system prompt with AGENTS.md instructions <never-show>" },
      { role: "user", content: "visible user prompt" }, message, ],
    message_page: { start: 0, end: 3, total: 3, has_older: false }, }));
  const transcript = ui.el.orchestratorChatContent.innerHTML;
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
  assert.equal(urls[0], "/sessions/page%2Fsession?message_limit=24&thread_event_limit=24&include_sessions=false");
  isolated.state.currentId = "page/session";
  isolated.el.orchestratorChatContent = fakeElement();
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

test("orchestrator history auto-fills an underflowing viewport until scrolling is possible", () => {
  const windowState = { hasOlder: true, loading: false };
  assert.equal(ui.orchestratorHistoryNeedsFill({ scrollHeight: 620, clientHeight: 900 }, windowState), true);
  assert.equal(ui.orchestratorHistoryNeedsFill({ scrollHeight: 902, clientHeight: 900 }, windowState), false);
  assert.equal(ui.orchestratorHistoryNeedsFill({ scrollHeight: 620, clientHeight: 900 }, { ...windowState, loading: true }), false);
  assert.equal(ui.orchestratorHistoryNeedsFill({ scrollHeight: 620, clientHeight: 900 }, { ...windowState, hasOlder: false }), false);

  const requests = [];
  const isolated = loadApp({ fetch(url) {
      requests.push(url);
      return new Promise(() => {});
    }, });
  const scroller = { scrollHeight: 620, clientHeight: 900, scrollTop: 0,
    querySelector() { return null; }, };
  isolated.state.currentId = "underfilled-session";
  isolated.state.focusRenderId = 7;
  isolated.state.snapshots.set("underfilled-session", sessionSnapshot("underfilled-session"));
  isolated.state.messageWindows.set("underfilled-session", {
    start: 24, end: 48, total: 80, hasOlder: true, loading: false, messages: [],
  });
  isolated.el.orchestratorChatContent = scroller;
  isolated.ensureOrchestratorScrollableHistory(7);
  assert.deepEqual(requests, ["/sessions/underfilled-session/messages?before=24&limit=24"]);
  assert.equal(isolated.state.messageWindows.get("underfilled-session").loading, true);
});

test("session-list refreshes coalesce bursts, strengthen options, and accept only the final fresh ordering", async () => {
  const first = deferred();
  const trailing = deferred();
  const final = deferred();
  const pending = [first, trailing, final];
  const requests = [];
  const isolated = loadApp({ fetch(path) {
      requests.push(path);
      return pending.shift().promise;
    }, });
  isolated.el.pickerSessionTotal = fakeElement();
  isolated.el.sessionGrid = fakeElement();
  isolated.state.sessions = [sessionListEntry("baseline")];

  const initialLoad = isolated.loadSessions();
  let queuedSettled = false;
  const burstLoad = isolated.loadSessions();
  const strengthenedLoad = isolated.loadSessions({ workspaceStats: true });
  strengthenedLoad.then(() => { queuedSettled = true; });
  assert.equal(initialLoad, burstLoad);
  assert.equal(burstLoad, strengthenedLoad);
  assert.deepEqual(requests, ["/sessions"], "a request burst never overlaps the active list GET");

  first.resolve(jsonResponse([sessionListEntry("stale-first")]));
  await flushPromises();
  await flushPromises();
  await flushPromises();
  assert.deepEqual(requests, ["/sessions", "/sessions?workspace_stats=true"],
    "a false-to-true trigger strengthens the sequential trailing request");
  assert.deepEqual(plain(isolated.state.sessions.map((entry) => entry.summary.session_id)), ["baseline"]);
  assert.equal(queuedSettled, false);

  const dirtiedTrailingLoad = isolated.loadSessions();
  assert.equal(dirtiedTrailingLoad, initialLoad);
  assert.equal(requests.length, 2);
  trailing.resolve(jsonResponse([sessionListEntry("stale-trailing")]));
  await flushPromises();
  await flushPromises();
  await flushPromises();
  assert.deepEqual(requests, ["/sessions", "/sessions?workspace_stats=true", "/sessions?workspace_stats=true"],
    "dirty state observed during a trailing GET schedules one stronger final GET");
  assert.deepEqual(plain(isolated.state.sessions.map((entry) => entry.summary.session_id)), ["baseline"],
    "invalidated responses never overwrite the displayed list");
  assert.equal(queuedSettled, false, "queued callers wait for the coordinator to drain");

  final.resolve(jsonResponse([sessionListEntry("fresh-second"), sessionListEntry("fresh-first")]));
  const results = await Promise.all([initialLoad, burstLoad, strengthenedLoad, dirtiedTrailingLoad]);
  assert.deepEqual(plain(results.map((sessions) => sessions.map((entry) => entry.summary.session_id))),
    Array(4).fill(null).map(() => ["fresh-second", "fresh-first"]));
  assert.deepEqual(plain(isolated.state.sessions.map((entry) => entry.summary.session_id)), ["fresh-second", "fresh-first"],
    "authoritative picker ordering comes from the final response");
  assert.ok(isolated.state.statsLoadedAt > 0);
  assert.equal(isolated.state.sessionListRefreshCoordinator, null);
});

test("a failed list GET yields to its strengthened trailing refresh and retains every queued created session", async () => {
  const failed = deferred();
  const recovered = deferred();
  const pending = [failed, recovered];
  const requests = [];
  const isolated = loadApp({ fetch(path) {
      requests.push(path);
      return pending.shift().promise;
    }, });
  isolated.el.sessionWorkspace = { hidden: true };
  isolated.el.pickerNavStatus = fakeElement();
  isolated.el.sessionNavStatus = fakeElement();
  isolated.el.pickerSessionTotal = fakeElement();
  isolated.el.sessionGrid = fakeElement();
  isolated.state.sessions = [sessionListEntry("existing")];

  const initialLoad = isolated.loadSessions();
  const createdA = sessionSnapshot("created-A", {
    metadata: { session_id: "created-A", cwd: "/a", model: "a-model", backend: "test" },
    sessions: [sessionListEntry("created-A").summary],
  });
  isolated.upsertCreatedSession(createdA);
  const preserveA = isolated.loadSessions({ workspaceStats: true, preserveSessionId: "created-A" });
  const createdB = sessionSnapshot("created-B", {
    metadata: { session_id: "created-B", cwd: "/b", model: "b-model", backend: "test" },
    sessions: [sessionListEntry("created-B").summary],
  });
  isolated.upsertCreatedSession(createdB);
  const preserveB = isolated.loadSessions({ preserveSessionId: "created-B" });
  assert.equal(initialLoad, preserveA);
  assert.equal(preserveA, preserveB);
  assert.deepEqual(plain(isolated.state.sessions.map((entry) => entry.summary.session_id)),
    ["existing", "created-A", "created-B"]);

  failed.resolve(errorResponse(503, { error: "superseded list failure" }));
  await flushPromises();
  await flushPromises();
  await flushPromises();
  assert.deepEqual(requests, ["/sessions", "/sessions?workspace_stats=true"],
    "failure of an invalidated request cannot suppress its queued trailing GET");
  assert.equal(isolated.el.pickerNavStatus.textContent, "", "superseded failures remain silent");
  assert.deepEqual(plain(isolated.state.sessions.map((entry) => entry.summary.session_id)),
    ["existing", "created-A", "created-B"], "failure leaves the current and created entries untouched");

  recovered.resolve(jsonResponse([sessionListEntry("server-first"), sessionListEntry("existing")]));
  const results = await Promise.all([initialLoad, preserveA, preserveB]);
  assert.deepEqual(plain(results.map((sessions) => sessions.map((entry) => entry.summary.session_id))),
    Array(3).fill(null).map(() => ["server-first", "existing", "created-A", "created-B"]));
  assert.deepEqual(plain(isolated.state.sessions.map((entry) => entry.summary.session_id)),
    ["server-first", "existing", "created-A", "created-B"],
    "all queued preserve entries survive an authoritative response that does not list them yet");
  assert.equal(isolated.state.sessionListRefreshCoordinator, null);
});

test("a successfully deleted preserved session cannot be resurrected by its active list coordinator", async () => {
  const active = deferred();
  const trailing = deferred();
  const requests = [];
  let listRequestCount = 0;
  const isolated = loadApp({
    fetch(path, options = {}) {
      const method = options.method || "GET";
      requests.push({ path, method });
      if (method === "DELETE" && path === "/sessions/created-session") return jsonResponse({});
      if (method === "GET" && path.startsWith("/sessions")) {
        listRequestCount += 1;
        return listRequestCount === 1 ? active.promise : trailing.promise;
      }
      throw new Error(`unexpected request ${method} ${path}`);
    },
    window: { setTimeout: () => 84, clearTimeout() {} },
  });
  installWorkspaceElements(isolated);
  isolated.el.focusContent = { innerHTML: "", querySelector: () => null };
  isolated.state.currentId = "created-session";
  isolated.upsertCreatedSession(sessionSnapshot("created-session", {
    metadata: { session_id: "created-session", cwd: "/created", model: "model", backend: "test" },
    sessions: [sessionListEntry("created-session").summary],
  }));

  const preservingLoad = isolated.loadSessions({ preserveSessionId: "created-session" });
  const deletionStatus = fakeElement();
  const deletion = isolated.confirmSessionDeletion({
    querySelector(selector) { return selector === "[data-delete-status]" ? deletionStatus : null; },
  });
  await flushPromises();
  await flushPromises();

  const coordinator = isolated.state.sessionListRefreshCoordinator;
  assert.ok(coordinator);
  assert.equal(coordinator.preservedSessions.has("created-session"), false,
    "successful deletion removes the captured created-session entry before joining the refresh");
  assert.equal(coordinator.deletedSessionIds.has("created-session"), true);
  assert.deepEqual(requests, [
    { path: "/sessions", method: "GET" },
    { path: "/sessions/created-session", method: "DELETE" },
  ]);

  active.resolve(jsonResponse([]));
  await flushPromises();
  await flushPromises();
  await flushPromises();
  assert.deepEqual(requests, [
    { path: "/sessions", method: "GET" },
    { path: "/sessions/created-session", method: "DELETE" },
    { path: "/sessions?workspace_stats=true", method: "GET" },
  ]);
  trailing.resolve(jsonResponse([]));

  const [loaded] = await Promise.all([preservingLoad, deletion]);
  assert.deepEqual(plain(loaded), []);
  assert.deepEqual(plain(isolated.state.sessions), [],
    "the authoritative empty response cannot be overwritten by the old preservation entry");
  assert.equal(isolated.state.sessionListRefreshCoordinator, null);
  assert.equal(deletionStatus.classList.contains("is-error"), false);
});

test("session-list polling skips slow active drains and resumes on the next poll", async () => {
  const store = deferred();
  const slowPoll = deferred();
  const laterPoll = deferred();
  const requests = [];
  let interval = null;
  let sessionRequestCount = 0;
  const isolated = loadApp({
    fetch(path) {
      requests.push(path);
      if (path === "/store") return store.promise;
      sessionRequestCount += 1;
      if (sessionRequestCount === 1) return Promise.resolve(jsonResponse([sessionListEntry("boot")]));
      if (sessionRequestCount === 2) return slowPoll.promise;
      if (sessionRequestCount === 3) return laterPoll.promise;
      throw new Error(`unexpected session request ${path}`);
    },
    window: {
      setInterval(callback, delay) { interval = { callback, delay }; return 85; },
      clearInterval() {},
    },
  });
  isolated.el.pickerStorePath = fakeElement();
  isolated.el.pickerSessionTotal = fakeElement();
  isolated.el.sessionGrid = { innerHTML: "" };
  await isolated.boot();
  assert.deepEqual(requests, ["/store", "/sessions?workspace_stats=true"]);
  assert.equal(interval.delay, 5_000);

  isolated.state.statsLoadedAt = 0;
  interval.callback();
  const slowDrain = isolated.state.sessionListRefreshCoordinator.promise;
  let slowDrainSettled = false;
  slowDrain.then(() => { slowDrainSettled = true; });
  for (let elapsed = 5_000; elapsed <= 20_000; elapsed += 5_000) interval.callback();
  assert.deepEqual(requests, [
    "/store",
    "/sessions?workspace_stats=true",
    "/sessions?workspace_stats=true",
  ], "workspace-stat poll ticks do not dirty or chain behind an active slow list request");

  slowPoll.resolve(jsonResponse([sessionListEntry("slow-fresh")]));
  assert.deepEqual(plain((await slowDrain).map((entry) => entry.summary.session_id)), ["slow-fresh"]);
  assert.equal(slowDrainSettled, true);
  assert.equal(isolated.state.sessionListRefreshCoordinator, null);
  assert.deepEqual(plain(isolated.state.sessions.map((entry) => entry.summary.session_id)), ["slow-fresh"]);

  interval.callback();
  assert.deepEqual(requests, [
    "/store",
    "/sessions?workspace_stats=true",
    "/sessions?workspace_stats=true",
    "/sessions",
  ], "a later poll starts normally after the slow coordinator drains");
  const laterDrain = isolated.state.sessionListRefreshCoordinator.promise;
  laterPoll.resolve(jsonResponse([sessionListEntry("later-fresh")]));
  assert.deepEqual(plain((await laterDrain).map((entry) => entry.summary.session_id)), ["later-fresh"]);
  assert.equal(isolated.state.sessionListRefreshCoordinator, null);
  assert.deepEqual(plain(isolated.state.sessions.map((entry) => entry.summary.session_id)), ["later-fresh"]);
});

test("session-list acceptance retains the navigation identity guard without ejecting the selected session", async () => {
  const navigation = deferred();
  const isolated = loadApp({ fetch: () => navigation.promise });
  isolated.el.pickerSessionTotal = fakeElement();
  isolated.el.sessionGrid = fakeElement();
  isolated.state.sessions = [sessionListEntry("selected-session")];
  const startedFromPicker = isolated.loadSessions();
  isolated.state.currentId = "selected-session";
  navigation.resolve(jsonResponse([]));
  assert.equal(await startedFromPicker, null);
  assert.equal(isolated.state.currentId, "selected-session");
  assert.deepEqual(plain(isolated.state.sessions.map((entry) => entry.summary.session_id)), ["selected-session"]);
  assert.equal(isolated.state.sessionListRefreshCoordinator, null);
});

test("snapshot refreshes coalesce bursts, carry dirty state through trailing requests, and accept only the final fresh response", async () => {
  const first = deferred();
  const trailing = deferred();
  const final = deferred();
  const pending = [first, trailing, final];
  const requests = [];
  const isolated = loadApp({
    fetch(path) {
      requests.push(path);
      return pending.shift().promise;
    },
    window: { setTimeout: () => 81, clearTimeout() {} },
  });
  isolated.el.sessionWorkspace = { hidden: false };
  isolated.el.pickerNavStatus = fakeElement();
  isolated.el.sessionNavStatus = fakeElement();
  isolated.state.currentId = "snapshot-session";

  const initialLoad = isolated.loadSnapshot("snapshot-session");
  let queuedSettled = false;
  const announcedLoad = isolated.loadSnapshot("snapshot-session", true);
  announcedLoad.then(() => { queuedSettled = true; });
  const burstLoad = isolated.loadSnapshot("snapshot-session");
  assert.equal(initialLoad, announcedLoad);
  assert.equal(announcedLoad, burstLoad);
  assert.equal(requests.length, 1, "a burst during the active GET queues only one trailing GET");

  first.resolve(jsonResponse({ metadata: { session_id: "snapshot-session", model: "stale-first" }, messages: [] }));
  await flushPromises();
  await flushPromises();
  await flushPromises();
  assert.equal(requests.length, 2);
  assert.equal(queuedSettled, false);
  assert.equal(isolated.state.snapshots.has("snapshot-session"), false, "an invalidated response is never accepted");
  assert.equal(isolated.el.sessionNavStatus.textContent, "", "announcement waits for an accepted refresh");

  const dirtiedTrailingLoad = isolated.loadSnapshot("snapshot-session");
  assert.equal(dirtiedTrailingLoad, initialLoad);
  assert.equal(requests.length, 2, "dirtying a trailing GET does not overlap it");
  trailing.resolve(jsonResponse({ metadata: { session_id: "snapshot-session", model: "stale-trailing" }, messages: [] }));
  await flushPromises();
  await flushPromises();
  await flushPromises();
  assert.equal(requests.length, 3, "dirty state observed during the trailing GET schedules a sequential final GET");
  assert.equal(queuedSettled, false, "queued callers wait until the coordinator drains");
  assert.equal(isolated.state.snapshots.has("snapshot-session"), false);

  final.resolve(jsonResponse({ metadata: { session_id: "snapshot-session", model: "fresh-final" }, messages: [] }));
  const results = await Promise.all([initialLoad, announcedLoad, burstLoad, dirtiedTrailingLoad]);
  assert.deepEqual(results.map((snapshot) => snapshot.metadata.model), Array(4).fill("fresh-final"));
  assert.equal(isolated.state.snapshots.get("snapshot-session").metadata.model, "fresh-final");
  assert.equal(isolated.el.sessionNavStatus.textContent, "Session refreshed", "queued announce intent reaches the final accepted request");
  assert.equal(isolated.state.snapshotRefreshCoordinators.has("snapshot-session"), false);
  assert.deepEqual(requests, Array(3).fill("/sessions/snapshot-session?message_limit=24&thread_event_limit=24&include_sessions=false"));
});

test("a failed invalidated snapshot GET yields to its successful trailing refresh while terminal errors remain visible", async () => {
  const failed = deferred();
  const recovered = deferred();
  const terminal = deferred();
  const pending = [failed, recovered, terminal];
  const isolated = loadApp({
    fetch: () => pending.shift().promise,
    window: { setTimeout: () => 82, clearTimeout() {} },
  });
  isolated.el.sessionWorkspace = { hidden: false };
  isolated.el.pickerNavStatus = fakeElement();
  isolated.el.sessionNavStatus = fakeElement();
  isolated.state.currentId = "recovery-session";

  const initialLoad = isolated.loadSnapshot("recovery-session");
  const queuedLoad = isolated.loadSnapshot("recovery-session");
  failed.resolve(errorResponse(503, { error: "superseded failure" }));
  await flushPromises();
  await flushPromises();
  assert.equal(isolated.el.sessionNavStatus.textContent, "", "a superseded error does not replace the pending trailing result");
  recovered.resolve(jsonResponse({ metadata: { session_id: "recovery-session", model: "recovered" }, messages: [] }));
  assert.equal((await initialLoad).metadata.model, "recovered");
  assert.equal((await queuedLoad).metadata.model, "recovered");

  const terminalLoad = isolated.loadSnapshot("recovery-session");
  terminal.resolve(errorResponse(500, { error: "latest refresh failed" }));
  assert.equal(await terminalLoad, null);
  assert.equal(isolated.state.snapshots.get("recovery-session").metadata.model, "recovered");
  assert.equal(isolated.el.sessionNavStatus.textContent, "latest refresh failed");
  assert.equal(isolated.el.sessionNavStatus.classList.contains("is-error"), true);
});

test("snapshot coordinators remain independent across navigation and retain response identity guards", async () => {
  const sessionA = deferred();
  const sessionB = deferred();
  const mismatch = deferred();
  const pending = [sessionA, sessionB, mismatch];
  const requests = [];
  const isolated = loadApp({
    fetch(path) {
      requests.push(path);
      return pending.shift().promise;
    },
    window: { setTimeout: () => 83, clearTimeout() {} },
  });
  isolated.el.sessionWorkspace = { hidden: false };
  isolated.el.pickerNavStatus = fakeElement();
  isolated.el.sessionNavStatus = fakeElement();
  isolated.state.currentId = "session-A";
  const loadA = isolated.loadSnapshot("session-A");
  isolated.state.currentId = "session-B";
  const loadB = isolated.loadSnapshot("session-B");
  assert.equal(requests.length, 2, "different sessions may load concurrently");
  assert.equal(isolated.state.snapshotRefreshCoordinators.size, 2);

  sessionA.resolve(jsonResponse({ metadata: { session_id: "session-A", model: "stale-after-navigation" }, messages: [] }));
  sessionB.resolve(jsonResponse({ metadata: { session_id: "session-B", model: "current-B" }, messages: [] }));
  assert.equal(await loadA, null);
  assert.equal((await loadB).metadata.model, "current-B");
  assert.equal(isolated.state.snapshots.has("session-A"), false, "navigation rejects the response started in the stale view");
  assert.equal(isolated.state.snapshots.get("session-B").metadata.model, "current-B");

  isolated.state.currentId = "session-A";
  const mismatchedLoad = isolated.loadSnapshot("session-A");
  mismatch.resolve(jsonResponse({ metadata: { session_id: "different-session", model: "wrong-model" }, messages: [] }));
  assert.equal(await mismatchedLoad, null);
  assert.equal(isolated.state.snapshots.has("session-A"), false);
  assert.match(isolated.el.sessionNavStatus.textContent, /Snapshot identity mismatch: requested session-A, received different-session/);
  assert.deepEqual(requests, [
    "/sessions/session-A?message_limit=24&thread_event_limit=24&include_sessions=false",
    "/sessions/session-B?message_limit=24&thread_event_limit=24&include_sessions=false",
    "/sessions/session-A?message_limit=24&thread_event_limit=24&include_sessions=false",
  ]);
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
  ui.el.orchestratorChatContent = fakeElement();
  ui.renderOrchestratorChatRail(snapshot);
  const html = ui.el.orchestratorChatContent.innerHTML;
  assert.match(html, /Sending…/);
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
  isolated.el.promptInput.value = "draft A ";
  assert.equal(isolated.clearComposerDraftIfUnchanged("session-A", "draft A"), false);
  assert.equal(isolated.state.composerDrafts.get("session-A"), "draft A",
    "a byte-different visible draft prevents clearing the stored origin");
  isolated.el.promptInput.value = "draft A";
  assert.equal(isolated.clearComposerDraftIfUnchanged("session-A", "different submission"), false);
  assert.equal(isolated.state.composerDrafts.get("session-A"), "draft A");
});

test("compaction operation reducer has pure, table-driven transitions and bounded terminal tombstones", () => {
  const request = {};
  const secondRequest = {};
  let operation = ui.emptyCompactionOperation();
  const transitions = [
    [{ type: "request_started", request, draft: " \t/compact\n" }, { busy: true, active: null, draft: " \t/compact\n", terminals: [] }],
    [{ type: "navigation" }, { busy: true, active: null, draft: " \t/compact\n", terminals: [] }],
    [{ type: "replay_gap" }, { busy: true, active: null, draft: " \t/compact\n", terminals: [] }],
    [{ type: "epoch_reset" }, { busy: true, active: null, draft: " \t/compact\n", terminals: [] }],
    [{ type: "request_failed", request }, { busy: false, active: null, draft: null, terminals: [] }],
    [{ type: "snapshot", activeCompaction: { compaction_id: "snapshot-active" } }, { busy: true, active: "snapshot-active", draft: null, terminals: [] }],
    [{ type: "lifecycle_terminal", reason: "manual", compactionId: "unrelated" }, { busy: true, active: "snapshot-active", draft: null, terminals: ["unrelated"] }],
    [{ type: "lifecycle_terminal", reason: "manual", compactionId: "snapshot-active" }, { busy: false, active: null, draft: null, terminals: ["unrelated", "snapshot-active"] }],
    [{ type: "snapshot", activeCompaction: { compaction_id: "snapshot-active" } }, { busy: false, active: null, draft: null, terminals: ["unrelated", "snapshot-active"] }],
    [{ type: "lifecycle_started", reason: "manual", compactionId: "snapshot-active" }, { busy: false, active: null, draft: null, terminals: ["unrelated", "snapshot-active"] }],
    [{ type: "lifecycle_started", reason: "auto", compactionId: "automatic" }, { busy: false, active: null, draft: null, terminals: ["unrelated", "snapshot-active"] }],
    [{ type: "request_started", request: secondRequest, draft: "/compact" }, { busy: true, active: null, draft: "/compact", terminals: ["unrelated", "snapshot-active"] }],
    [{ type: "lifecycle_started", reason: "manual", compactionId: "request-result" }, { busy: true, active: "request-result", draft: "/compact", terminals: ["unrelated", "snapshot-active"] }],
    [{ type: "request_succeeded", request: secondRequest, compactionId: "request-result" }, { busy: false, active: null, draft: null, terminals: ["unrelated", "snapshot-active", "request-result"] }],
  ];

  for (const [transition, expected] of transitions) {
    const before = operation;
    const beforeProjection = {
      revision: before.revision,
      request: before.request,
      active: before.activeCompactionId,
      terminals: [...before.terminalCompactionIds],
    };
    operation = ui.reduceCompactionOperation(operation, transition);
    assert.deepEqual(plain({
      busy: ui.compactionOperationBusy(operation),
      active: operation.activeCompactionId,
      draft: operation.request?.draft ?? null,
      terminals: operation.terminalCompactionIds,
    }), expected, transition.type);
    assert.equal(before.revision, beforeProjection.revision, `${transition.type} preserves the input revision`);
    assert.equal(before.request, beforeProjection.request, `${transition.type} preserves the input request`);
    assert.equal(before.activeCompactionId, beforeProjection.active, `${transition.type} preserves the input active ID`);
    assert.deepEqual(plain(before.terminalCompactionIds), beforeProjection.terminals,
      `${transition.type} preserves the input tombstones`);
  }

  operation = ui.reduceCompactionOperation(operation, { type: "epoch_reset" });
  for (let index = 0; index < 40; index += 1) {
    operation = ui.reduceCompactionOperation(operation, {
      type: "lifecycle_terminal", reason: "manual", compactionId: `terminal-${index}`,
    });
  }
  assert.equal(operation.terminalCompactionIds.length, 32);
  assert.deepEqual(plain(operation.terminalCompactionIds), Array.from({ length: 32 }, (_, index) => `terminal-${index + 8}`));
});

test("exact /compact posts once without run, steering, transcript, or snapshot side effects", async () => {
  const completion = deferred();
  const requests = [];
  const isolated = loadApp({
    fetch(path, options = {}) {
      requests.push({ path, method: options.method, body: options.body });
      return completion.promise;
    },
    window: { setTimeout: () => 41, clearTimeout() {} },
  });
  const rawDraft = " \t/compact \n";
  installComposerElements(isolated, "compact/session", rawDraft);
  const snapshot = isolated.state.snapshots.get("compact/session");
  snapshot.messages.push({ role: "user", content: "keep transcript byte-for-byte" });
  const transcriptBefore = JSON.stringify(snapshot.messages);
  const submission = isolated.submitComposer({ preventDefault() {} });

  assert.deepEqual(requests, [{
    path: "/sessions/compact%2Fsession/compact", method: "POST", body: "{}",
  }]);
  assert.equal(isolated.sessionCompactionBusy("compact/session"), true);
  assert.equal(isolated.el.sendPrompt.disabled, true);
  assert.equal(isolated.el.promptInput.value, rawDraft, "the exact raw command remains editable while admission is pending");
  assert.equal(isolated.state.composerDrafts.get("compact/session"), rawDraft);
  assert.equal(isolated.sessionCompactionOperation("compact/session").request.draft, rawDraft);
  assert.equal(isolated.state.acceptedRuns.size, 0);
  assert.equal(isolated.state.submittingSessions.size, 0);
  assert.equal(isolated.state.snapshotTimers.size, 0);
  assert.equal(JSON.stringify(snapshot.messages), transcriptBefore);

  completion.resolve(jsonResponse({ status: "compacted", compaction_id: "compaction-1" }));
  assert.equal(await submission, undefined);
  assert.equal(isolated.el.sessionNavStatus.textContent, "Context compacted");
  assert.equal(isolated.sessionCompactionBusy("compact/session"), false);
  assert.equal(isolated.el.promptInput.value, "");
  assert.equal(isolated.state.composerDrafts.get("compact/session"), "");
  assert.equal(isolated.el.sendPrompt.disabled, false);
  assert.equal(isolated.state.snapshotTimers.size, 0);
  assert.equal(JSON.stringify(snapshot.messages), transcriptBefore);
  assert.ok(requests.every(({ path }) => !/\/runs|\/steering|cancel-active-run/.test(path)));
});

test("/compact rejects arguments, prevents duplicates and ordinary submissions, and uses safe result notices", async () => {
  const completion = deferred();
  const requests = [];
  const isolated = loadApp({
    fetch(path) { requests.push(path); return completion.promise; },
    window: { setTimeout: () => 42, clearTimeout() {} },
  });
  installComposerElements(isolated, "compact-busy", "/compact now");

  await isolated.submitComposer({ preventDefault() {} });
  assert.deepEqual(requests, []);
  assert.equal(isolated.el.sessionNavStatus.textContent, "usage: /compact");
  assert.equal(isolated.el.promptInput.value, "/compact now");
  assert.equal(isolated.state.composerDrafts.get("compact-busy"), "/compact now");

  isolated.el.promptInput.value = "/compact";
  isolated.state.composerDrafts.set("compact-busy", "/compact");
  const first = isolated.submitComposer({ preventDefault() {} });
  assert.deepEqual(requests, ["/sessions/compact-busy/compact"]);
  isolated.el.promptInput.value = "/compact";
  isolated.state.composerDrafts.set("compact-busy", "/compact");
  await isolated.submitComposer({ preventDefault() {} });
  assert.deepEqual(requests, ["/sessions/compact-busy/compact"]);
  assert.equal(isolated.el.promptInput.value, "/compact", "a rejected duplicate keeps its exact draft");
  assert.equal(isolated.el.sessionNavStatus.textContent, "Session is busy");

  isolated.el.promptInput.value = "ordinary prompt must wait";
  await isolated.submitComposer({ preventDefault() {} });
  assert.deepEqual(requests, ["/sessions/compact-busy/compact"]);
  assert.equal(isolated.state.acceptedRuns.size, 0);
  assert.equal(isolated.state.snapshotTimers.size, 0);
  completion.resolve(jsonResponse({
    status: "unchanged", compaction_id: "compaction-2", reason: "already_compacted",
    summary: "SECRET SUMMARY MUST NOT RENDER",
  }));
  await first;
  assert.equal(isolated.el.sessionNavStatus.textContent, "Nothing new to compact");
  assert.equal(isolated.el.promptInput.value, "ordinary prompt must wait",
    "success cannot clear a draft edited after the originating request");
  assert.equal(isolated.state.composerDrafts.get("compact-busy"), "ordinary prompt must wait");
  assert.equal(isolated.sessionCompactionBusy("compact-busy"), false);
  assert.doesNotMatch(isolated.el.sessionNavStatus.textContent, /SECRET|already_compacted/);
});

test("manual compaction preserves the exact draft across 404, 409, 500, network, and invalid-response failures", async () => {
  const cases = [
    { name: "not-found", response: errorResponse(404, { error: "session not found", detail: "SECRET 404" }), notice: "session not found" },
    { name: "busy", response: errorResponse(409, { error: "session is busy", detail: "SECRET 409" }), notice: "session is busy" },
    { name: "server", response: errorResponse(500, {
      error: "compaction failed", summary: "SECRET SUMMARY", checkpoint: "/private/checkpoint", detail: "RAW PROVIDER FAILURE",
    }), notice: "compaction failed" },
    { name: "network", error: new Error("network exposed /private/transport"), notice: "compaction failed" },
    { name: "invalid", response: jsonResponse({ status: "compacted", compaction_id: "", summary: "SECRET INVALID" }), notice: "compaction failed" },
    { name: "invalid-unchanged", response: jsonResponse({ status: "unchanged", compaction_id: "invalid-unchanged" }), notice: "compaction failed" },
  ];
  for (const failure of cases) {
    const requests = [];
    const isolated = loadApp({
      fetch(path) {
        requests.push(path);
        if (failure.error) throw failure.error;
        return failure.response;
      },
      window: { setTimeout: () => 45, clearTimeout() {} },
    });
    const sessionId = `compact-error-${failure.name}`;
    const rawDraft = "\t/compact\n";
    installComposerElements(isolated, sessionId, rawDraft);
    await isolated.submitComposer({ preventDefault() {} });
    assert.deepEqual(requests, [`/sessions/${sessionId}/compact`]);
    assert.equal(isolated.el.promptInput.value, rawDraft, `${failure.name} preserves the DOM draft byte-for-byte`);
    assert.equal(isolated.state.composerDrafts.get(sessionId), rawDraft, `${failure.name} preserves stored draft bytes`);
    assert.equal(isolated.el.sessionNavStatus.textContent, failure.notice);
    assert.doesNotMatch(isolated.el.sessionNavStatus.textContent, /SECRET|checkpoint|provider|private|transport/i);
    assert.equal(isolated.sessionCompactionBusy(sessionId), false);
    assert.equal(isolated.state.acceptedRuns.size, 0);
    assert.equal(isolated.state.snapshotTimers.size, 0);
  }
});

test("manual compaction failure is navigation-safe and preserves both originating and destination composers", async () => {
  const completion = deferred();
  const requests = [];
  const isolated = loadApp({
    fetch(path) { requests.push(path); return completion.promise; },
    window: { setTimeout: () => 43, clearTimeout() {} },
  });
  installComposerElements(isolated, "session-A", "/compact");
  const compact = isolated.submitComposer({ preventDefault() {} });
  isolated.state.currentId = "session-B";
  isolated.state.sessions.push(sessionListEntry("session-B"));
  isolated.state.snapshots.set("session-B", sessionSnapshot("session-B"));
  isolated.state.composerDrafts.set("session-B", "destination draft");
  isolated.el.promptInput.value = "destination draft";
  isolated.el.promptInput.focused = false;
  isolated.el.sessionNavStatus.textContent = "destination notice";

  completion.resolve(errorResponse(500, {
    error: "compaction failed", detail: "RAW INTERNAL ERROR MUST STAY HIDDEN",
  }));
  await compact;
  assert.deepEqual(requests, ["/sessions/session-A/compact"]);
  assert.equal(isolated.el.promptInput.value, "destination draft");
  assert.equal(isolated.state.composerDrafts.get("session-A"), "/compact");
  assert.equal(isolated.state.composerDrafts.get("session-B"), "destination draft");
  assert.equal(isolated.el.sessionNavStatus.textContent, "destination notice");
  assert.equal(isolated.el.promptInput.focused, false);
  assert.equal(isolated.sessionCompactionBusy("session-A"), false);
  assert.doesNotMatch(isolated.el.sessionNavStatus.textContent, /RAW INTERNAL/);
});

test("manual compaction success clears only an unchanged originating draft after navigation", async () => {
  const completion = deferred();
  const isolated = loadApp({
    fetch: () => completion.promise,
    window: { setTimeout: () => 46, clearTimeout() {} },
  });
  const rawDraft = " \n/compact\t";
  installComposerElements(isolated, "success-A", rawDraft);
  const compact = isolated.submitComposer({ preventDefault() {} });
  isolated.state.currentId = "success-B";
  isolated.state.sessions.push(sessionListEntry("success-B"));
  isolated.state.snapshots.set("success-B", sessionSnapshot("success-B"));
  isolated.state.composerDrafts.set("success-B", "destination draft");
  isolated.el.promptInput.value = "destination draft";
  isolated.el.promptInput.focused = false;
  isolated.el.sessionNavStatus.textContent = "destination notice";

  completion.resolve(jsonResponse({ status: "compacted", compaction_id: "navigation-success" }));
  await compact;
  assert.equal(isolated.state.composerDrafts.get("success-A"), "");
  assert.equal(isolated.state.composerDrafts.get("success-B"), "destination draft");
  assert.equal(isolated.el.promptInput.value, "destination draft");
  assert.equal(isolated.el.sessionNavStatus.textContent, "destination notice");
  assert.equal(isolated.el.promptInput.focused, false);
  assert.equal(isolated.sessionCompactionBusy("success-A"), false);
});

test("active_compaction snapshots and manual lifecycle events reconcile composer busy state without creating a run", () => {
  const isolated = loadApp({ window: { setTimeout: () => 44, clearTimeout() {} } });
  installComposerElements(isolated, "reconcile-compact");
  const active = sessionSnapshot("reconcile-compact", {
    active_compaction: {
      compaction_id: "manual-1", client_id: "web", started_at_epoch_ms: 1,
    },
  });
  isolated.acceptSnapshot("reconcile-compact", active);
  isolated.renderComposerTarget();
  assert.equal(isolated.sessionCompactionBusy("reconcile-compact"), true);
  assert.equal(isolated.el.sendPrompt.disabled, true);
  assert.match(isolated.el.promptInput.placeholder, /Compacting orchestrator context/);
  assert.equal(Boolean(isolated.effectiveActiveRun(active, "reconcile-compact")), false);
  assert.equal(isolated.orchestratorLifecycle(active, "reconcile-compact").state, "no-run");
  isolated.renderWorkspace();
  assert.equal(isolated.el.stopRun.disabled, true, "manual compaction never exposes the run-only stop control");

  isolated.acceptSnapshot("reconcile-compact", sessionSnapshot("reconcile-compact"));
  assert.equal(isolated.sessionCompactionBusy("reconcile-compact"), false);
  assert.equal(isolated.noteSessionCompactionEvent("reconcile-compact", {
    type: "orchestrator_compaction_started", compaction_id: "manual-2", reason: "manual",
  }), true);
  assert.equal(isolated.sessionCompactionBusy("reconcile-compact"), true);
  isolated.noteSessionCompactionEvent("reconcile-compact", {
    type: "orchestrator_compaction_failed", compaction_id: "other", reason: "manual", failure: "cancelled",
  });
  assert.equal(isolated.sessionCompactionBusy("reconcile-compact"), true, "an unrelated terminal cannot clear the active ID");
  assert.equal(isolated.noteSessionCompactionEvent("reconcile-compact", {
    type: "orchestrator_compaction_completed", compaction_id: "auto-1", reason: "auto",
  }), false);
  assert.equal(isolated.sessionCompactionBusy("reconcile-compact"), true);
  isolated.noteSessionCompactionEvent("reconcile-compact", {
    type: "orchestrator_compaction_skipped", compaction_id: "manual-2", reason: "manual", cause: "already_compacted",
  });
  assert.equal(isolated.sessionCompactionBusy("reconcile-compact"), false);
  const delayedActive = isolated.acceptSnapshot("reconcile-compact", sessionSnapshot("reconcile-compact", {
    active_compaction: { compaction_id: "manual-2", client_id: "web", started_at_epoch_ms: 1 },
  }));
  assert.equal(isolated.sessionCompactionBusy("reconcile-compact"), false,
    "a terminal tombstone rejects a delayed active snapshot for the same compaction");
  assert.equal(delayedActive.active_compaction, null);
  assert.ok(isolated.sessionCompactionOperation("reconcile-compact").terminalCompactionIds.includes("manual-2"));
});

test("in-flight snapshot fences reject stale active_compaction without overriding newer lifecycle state", async () => {
  const staleSnapshot = deferred();
  const requests = [];
  let fetchCount = 0;
  const isolated = loadApp({
    fetch(path) {
      requests.push(path);
      fetchCount++;
      if (fetchCount === 1) return staleSnapshot.promise;
      return new Promise(() => {});
    },
    window: { setTimeout: () => 47, clearTimeout() {} },
  });
  installComposerElements(isolated, "fenced-compact");
  isolated.loadSnapshot("fenced-compact");
  isolated.noteSessionCompactionEvent("fenced-compact", {
    type: "orchestrator_compaction_started", compaction_id: "newer-live", reason: "manual",
  });
  staleSnapshot.resolve(jsonResponse(sessionSnapshot("fenced-compact", {
    active_compaction: { compaction_id: "stale-active", client_id: "other", started_at_epoch_ms: 1 },
  })));
  await flushPromises();
  await flushPromises();
  await flushPromises();
  assert.equal(requests.length, 2);
  assert.equal(isolated.sessionCompactionOperation("fenced-compact").activeCompactionId, "newer-live");
  assert.equal(isolated.sessionCompactionBusy("fenced-compact"), true);
  assert.equal(isolated.state.snapshots.get("fenced-compact").active_compaction, null,
    "the stale snapshot is retained for other fields but not as operation authority");
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
  ui.el.orchestratorChatContent = fakeElement();
  ui.state.messageWindows.set("loader-session", {
    start: 24, end: 48, total: 80, hasOlder: true, loading: false, messages: [],
  });
  ui.renderOrchestratorChatRail({ messages: [
      { role: "system", content: "paged private AGENTS prompt" },
      { role: "user", content: "paged visible user prompt" }, ],
    message_page: { start: 24, end: 26, total: 80, has_older: true },
    active_run: null, worksets: { items: [] }, });
  const html = ui.el.orchestratorChatContent.innerHTML;
  assert.match(html, /data-history-loader/);
  assert.match(html, /scroll up for earlier messages/);
  assert.match(html, />#26</);
  assert.match(html, /paged visible user prompt/);
  assert.doesNotMatch(html, />#25</);
  assert.doesNotMatch(html, /paged private AGENTS prompt|data-role="system"/);
  ui.state.messageWindows.set("loader-session", {
    start: 0, end: 48, total: 48, hasOlder: false, loading: false, messages: [],
  });
  ui.renderOrchestratorChatRail({ messages: [], active_run: null, worksets: { items: [] } });
  assert.doesNotMatch(
    ui.el.orchestratorChatContent.innerHTML,
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

test("authoritative thread boundaries append only same-epoch post-boundary events", () => {
  const persisted = [
    { event: { type: "assistant_message", content: "persisted response" }, provenance: "persisted" },
    { event: { type: "thread_finished", exit_code: 0 }, provenance: "persisted" },
  ];
  const observed = [
    { event: { type: "assistant_message", content: "old replay" }, provenance: "observed", epochId: "epoch-a", sequenceId: 4 },
    { event: { type: "assistant_message", content: "wrong epoch" }, provenance: "observed", epochId: "epoch-b", sequenceId: 8 },
    { event: { type: "thread_started", name: "worker" }, provenance: "observed", epochId: "epoch-a", sequenceId: 7 },
    { event: { type: "assistant_message", content: "new response" }, provenance: "observed", epochId: "epoch-a", sequenceId: 6 },
  ];
  assert.deepEqual(plain(ui.mergeThreadEvidence(persisted, observed, { epoch_id: "epoch-a", sequence_id: 5 })
    .map((entry) => entry.event.content || entry.event.type)),
  ["persisted response", "thread_finished", "new response", "thread_started"]);
  assert.deepEqual(plain(ui.mergeThreadEvidence(persisted, observed, null)), plain(persisted));
});

test("the canonical thread projector omits internal and metric rows while keeping independent responses and safe tools", () => {
  const internalStart = `model_call_${"started"}`;
  const entries = [
    { event: { type: internalStart, iteration: 1 }, provenance: "persisted" },
    { event: { type: "token_usage_updated", usage: { input_tokens: 9 } }, provenance: "persisted" },
    { event: { type: "thread_log", line: "raw log" }, provenance: "persisted" },
    { event: { type: "assistant_message", content: "first answer" }, provenance: "persisted" },
    { event: { type: internalStart, iteration: 2 }, provenance: "persisted" },
    { event: { type: "assistant_message", content: "second answer" }, provenance: "persisted" },
    { event: { type: "tool_call_started", name: "read", call_id: "call-1",
      args_detail: "RAW_ARGUMENT_CANARY", args_preview: '{"path":"src/app.js","limit":5}' }, provenance: "observed", sequenceId: 8 },
    { event: { type: "tool_call_finished", name: "read", call_id: "call-1", is_error: false,
      content_preview: "succeeded" }, provenance: "observed", sequenceId: 9 },
    { event: { type: "thread_finished", name: "worker", exit_code: 0, timed_out: false }, provenance: "observed", sequenceId: 10 },
  ];
  const actions = ui.projectThreadActions(entries);
  assert.deepEqual(plain(actions.map((action) => action.name)), ["response", "response", "Read", "thread"]);
  assert.deepEqual(plain(actions.filter((action) => action.name === "response").map((action) => action.detail)), ["first answer", "second answer"]);
  assert.match(actions[2].detail, /src\/app\.js.*succeeded/);
  assert.doesNotMatch(JSON.stringify(actions), /RAW_ARGUMENT_CANARY|raw log|iteration/);
  const snapshot = sessionSnapshot("episodes-only", { threads: [{ name: "worker" }],
    thread_episodes: { worker: [{ id: 1, action: "Retained", content: "episode-only content" }] },
    thread_event_boundary: { epoch_id: "epoch-a", sequence_id: 0 }, });
  ui.state.currentId = "episodes-only";
  assert.equal(ui.buildThreadModels(snapshot)[0].actions.length, 0);
  assert.match(ui.renderThreadEpisodes(snapshot.thread_episodes.worker), /episode-only content/);
});

test("tile selection protects the latest response, error, and terminal row", () => {
  const actions = [
    { name: "response", kind: "assistant_message", detail: "final answer" },
    { name: "ordinary 1", kind: "tool_call_started" },
    { name: "error", kind: "error", state: "error" },
    { name: "ordinary 2", kind: "tool_call_started" },
    { name: "thread", kind: "thread_finished", state: "done" },
    { name: "ordinary 3", kind: "guidance" },
    { name: "ordinary 4", kind: "guidance" },
  ];
  const selected = ui.selectTileActions(actions);
  assert.equal(selected.length, 5);
  assert.deepEqual(plain(selected.map((action) => action.name)), ["response", "error", "thread", "ordinary 3", "ordinary 4"]);
  assert.equal(ui.renderActionRows([{ name: "Read", result: "Done", detail: "src/full/path.js", state: "done" }], "" ).includes('title="src/full/path.js"'), true);
});

test("terminal run events clear only matching active-run caches", () => {
  const entry = sessionListEntry("terminal", { active_run: { run_id: "new-run" } });
  ui.state.sessions = [entry];
  ui.state.snapshots.set("terminal", sessionSnapshot("terminal", { active_run: { run_id: "new-run" } }));
  ui.state.acceptedRuns.set("terminal", { run_id: "new-run" });
  ui.state.sessionRunActivity.set("terminal", true);
  ui.noteSessionRunEvent("terminal", "run_completed", "old-run");
  assert.equal(entry.active_run.run_id, "new-run");
  assert.equal(ui.state.snapshots.get("terminal").active_run.run_id, "new-run");
  assert.equal(ui.state.acceptedRuns.get("terminal").run_id, "new-run");
  ui.noteSessionRunEvent("terminal", "run_failed", "new-run");
  assert.equal(entry.active_run, null);
  assert.equal(ui.state.snapshots.get("terminal").active_run, null);
  assert.equal(ui.state.acceptedRuns.has("terminal"), false);
  assert.equal(ui.state.sessionRunActivity.get("terminal"), false);
});

test("late deletion completion cannot navigate away from a newer session or close its focus view", async () => {
  const deletion = deferred();
  const isolated = loadApp({ fetch: async (path, options) => {
      if (options?.method === "DELETE") return deletion.promise;
      if (path === "/sessions?workspace_stats=true") return jsonResponse([sessionListEntry("session-b")]);
      throw new Error(`unexpected request ${path}`); }, });
  installWorkspaceElements(isolated);
  isolated.el.focusContent = { querySelector: () => ({ id: "newer-form" }) };
  isolated.state.currentId = "session-a";
  isolated.state.sessions = [sessionListEntry("session-a"), sessionListEntry("session-b")];
  const status = fakeElement();
  const form = { dataset: { sessionId: "session-a" }, querySelector: () => status };
  const pending = isolated.confirmSessionDeletion(form);
  isolated.state.currentId = "session-b";
  deletion.resolve(jsonResponse({}));
  await pending;
  assert.equal(isolated.state.currentId, "session-b");
});

test("session-list recovery retries retained hashes and session navigation hands off focus", async () => {
  const { FakeEventSource } = eventSourceHarness();
  let listAttempt = 0;
  const focused = [];
  const document = { addEventListener() {}, hidden: false, activeElement: null };
  const isolated = loadApp({ document, EventSource: FakeEventSource,
    window: { location: { hash: "#session/recovered", pathname: "/" } },
    fetch: async (path) => {
      if (path.startsWith("/sessions/recovered?")) return jsonResponse(sessionSnapshot("recovered"));
      if (path.startsWith("/sessions")) {
        listAttempt += 1;
        if (listAttempt === 1) return errorResponse(503, { error: "not yet" });
        return jsonResponse([sessionListEntry("recovered")]);
      }
      throw new Error(`unexpected request ${path}`);
    }, });
  installWorkspaceElements(isolated);
  isolated.el.renameSession.focus = () => focused.push("title");
  isolated.el.pickerTitle = { focus: () => focused.push("picker-title") };
  isolated.el.app = fakeElement();
  isolated.el.sessionGrid.querySelector = () => ({ focus: () => focused.push("card") });
  await isolated.loadSessions();
  assert.equal(isolated.state.currentId, null);
  await isolated.loadSessions();
  assert.equal(isolated.state.currentId, "recovered");
  assert.ok(focused.includes("title"));
  isolated.showPicker(false);
  assert.equal(focused.at(-1), "card");
});

test("Markdown links use an absolute protocol allowlist and external-link isolation", () => {
  for (const target of ["https://example.test/a", "http://example.test", "mailto:user@example.test"]) {
    assert.equal(ui.safeMarkdownHref(target), target);
  }
  for (const target of ["/relative", "javascript:alert(1)", "data:text/html,x", "https://exa mple.test", "null", ""]) {
    assert.equal(ui.safeMarkdownHref(target), null);
  }
  const safe = { type: "link_open", attrGet: () => "https://example.test" };
  assert.equal(ui.renderMarkdownLinkOpen([safe], 0), '<a href="https://example.test" target="_blank" rel="noopener noreferrer">');
  assert.equal(ui.renderMarkdownLinkClose([safe, { type: "link_close" }], 1), "</a>");
  const unsafe = { type: "link_open", attrGet: () => "../secret" };
  assert.equal(ui.renderMarkdownLinkOpen([unsafe], 0), '<span class="md-link-text">');
  assert.equal(ui.renderMarkdownLinkClose([unsafe, { type: "link_close" }], 1), "</span>");
});

test("session cards and command menu expose reviewed accessibility behavior", () => {
  const card = ui.renderSessionCard(sessionListEntry("accessible", { summary: { last_user_prompt: "complete prompt" } }));
  assert.match(card, /Idle\. complete prompt\./);
  assert.match(card, /class="status-dot idle" aria-hidden="true"/);
  assert.match(card, /class="card-prompt" title="complete prompt"/);
  const isolated = loadApp();
  isolated.el.promptInput = { ...fakeElement(), value: "/", removeAttribute(name) { this.removed = name; } };
  isolated.el.commandMenu = { hidden: true, innerHTML: "" };
  isolated.renderCommandMenu();
  assert.equal(isolated.el.promptInput.getAttribute("aria-expanded"), "true");
  assert.match(isolated.el.commandMenu.innerHTML, /role="option" aria-selected="true" tabindex="-1"/);
  assert.match(isolated.el.commandMenu.innerHTML, /data-command-option="compact"[\s\S]*compact older orchestrator context/);
  isolated.handleComposerKeydown({ key: "Escape", preventDefault() {} });
  assert.equal(isolated.el.promptInput.getAttribute("aria-expanded"), "false");
  assert.equal(isolated.el.commandMenu.hidden, true);

  isolated.el.focusContent = { innerHTML: "" };
  isolated.el.focusTitle = fakeElement();
  isolated.el.focusState = fakeElement();
  isolated.el.focusPanel = { ...fakeElement(), hidden: true, classList: { toggle() {}, add() {}, remove() {} } };
  isolated.el.sessionLayout = { classList: { toggle() {} } };
  isolated.el.focusContent.innerHTML = isolated.renderCommandReference();
  assert.match(isolated.el.focusContent.innerHTML, /<code>\/compact<\/code><span>compact older orchestrator context<\/span>/);
});


test("thread fullscreen episodes keep counting labels and expose durable identity", () => {
  const html = ui.renderThreadEpisodes([
    { id: 41, session_id: "session-a", thread_name: "worker", created_at: "created-41", action: "Inspect <schema> fully", content: "First response" },
    { id: 99, session_id: "session-a", thread_name: "worker", created_at: "created-99", action: "Verify migration", content: "Second response" },
  ]);
  assert.match(html, /Episode 1/);
  assert.match(html, /Episode 2/);
  assert.equal(occurrences(html, /<details class="focus-episode"/g), 2);
  assert.equal(occurrences(html, /<details class="focus-episode"[^>]* open/g), 1);
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
  assert.equal(ui.tokenUsageSummary(usage), "In 160 · Out 32 · Cache 63");
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
  assert.match(html, /name="orchestrator_compaction_threshold" type="number" min="0" max="9007199254740991" step="1"/);
  assert.match(html, /Blank or 0 disables the persisted session threshold/);
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
  assert.deepEqual(plain(ui.buildSettingsPatch({ ...unchanged,
    orchestrator_compaction_threshold: "64000", }, initial)), {
    orchestrator_compaction_threshold: 64000,
  });
  assert.deepEqual(plain(ui.buildSettingsPatch({ ...unchanged,
    orchestrator_compaction_threshold: "0", }, initial)), {});

  const enabled = ui.settingsValuesFromConfig(persistedConfig({
    orchestrator_compaction_threshold: 64000,
  }));
  assert.deepEqual(plain(ui.buildSettingsPatch(settingsFormElement({
    orchestrator_compaction_threshold: "",
  }).values, enabled)), { orchestrator_compaction_threshold: null });
  assert.deepEqual(plain(ui.buildSettingsPatch(settingsFormElement({
    orchestrator_compaction_threshold: "0",
  }).values, enabled)), { orchestrator_compaction_threshold: null });
  for (const value of ["-1", "1.5", "unsafe", "9007199254740992"]) {
    assert.throws(() => ui.buildSettingsPatch(settingsFormElement({
      orchestrator_compaction_threshold: value,
    }).values, initial), /non-negative whole number/);
  }
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
    "/sessions/settings-session?message_limit=24&thread_event_limit=24&include_sessions=false",
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
    "/sessions/settings-session?message_limit=24&thread_event_limit=24&include_sessions=false",
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
    orchestrator_compaction_threshold: "0",
    extra_headers: "{}", }))), { cwd: "/repo", reasoning_effort: null,
    api_key_env: null, orchestrator_compaction_threshold: null, extra_headers: null, });
  assert.deepEqual(plain(ui.buildLaunchSessionRequest(launchValues({ mode: "ssh",
    cwd: "~/work", ssh_host: " deploy@example.test ",
    backend: " arcee-api ", model: " coder ",
    base_url: " https://api.example.test/v1 ",
    reasoning_mode: "minimal", api_key_mode: "named",
    api_key_env: " ARCEE_API_KEY ",
    orchestrator_compaction_threshold: "64000",
    extra_headers: '{"X-Trace":"yes"}',
    sandbox: { image: "must-not-leak" }, }))), { cwd: "~/work",
    ssh_host: "deploy@example.test", backend: "arcee-api",
    model: "coder",
    base_url: "https://api.example.test/v1",
    reasoning_effort: "minimal", api_key_env: "ARCEE_API_KEY",
    orchestrator_compaction_threshold: 64000,
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
  for (const value of ["-1", "1.5", "unsafe", "9007199254740992"]) {
    assert.throws(() => ui.buildLaunchSessionRequest(launchValues({
      orchestrator_compaction_threshold: value,
    })), /non-negative whole number/);
  }
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
  isolated.el.launchCompactionThreshold = { value: "64000" };
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
    orchestrator_compaction_threshold: 64000,
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

test("created snapshots initialize state without a duplicate GET while SSE, prompts, and list refreshes continue", async () => {
  const timeline = [];
  const requests = [];
  const timers = [];
  const { FakeEventSource, instances } = eventSourceHarness();
  class TrackingEventSource extends FakeEventSource {
    constructor(url) {
      super(url);
      timeline.push(`sse:${url}`);
    }
  }
  const summary = {
    session_id: "created-session", cwd: "/repo", model: "model", backend: "backend",
    visible_message_count: 1, last_user_prompt: "created prompt", sandboxed: false, ssh_host: null,
    title: null, pinned: false, sort_order: 0, presentation_version: 0,
    created_at: "created", updated_at: "created",
  };
  const snapshot = sessionSnapshot("created-session", {
    metadata: { session_id: "created-session", cwd: "/repo", model: "model", backend: "backend", sandbox_status: "off" },
    messages: [{ role: "system", content: "policy" }, { role: "user", content: "created prompt" }],
    sessions: [summary],
    worksets: { items: [], error: null },
  });
  const isolated = loadApp({ FormData: FakeFormData, EventSource: TrackingEventSource,
    fetch: async (path, options = {}) => {
      const method = options.method || "GET";
      requests.push({ path, method });
      timeline.push(`${method}:${path}`);
      if (path === "/sessions" && method === "POST") return jsonResponse(snapshot);
      if (path === "/sessions?workspace_stats=true" || path === "/sessions") {
        return errorResponse(503, { error: "list unavailable" });
      }
      throw new Error(`unexpected request ${method} ${path}`); },
    window: {
      setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
      clearTimeout() {}, setInterval: () => 91, clearInterval() {},
    }, });
  installWorkspaceElements(isolated);
  const submit = { disabled: false };
  isolated.el.launchForm = { mode: "local", querySelector: () => submit,
    reset() { this.resetCalled = true; }, };
  isolated.el.launchDialog = { close() { this.closed = true; } };
  isolated.el.launchStatus = fakeElement();
  isolated.el.launchExecutionModes = fakeElement();
  isolated.el.launchCwd = { value: "/repo", placeholder: "", dataset: {} };
  isolated.el.launchCwdLabel = fakeElement();
  isolated.el.launchSshField = { hidden: false, inert: false };
  isolated.el.launchSshHost = { value: "", disabled: false, required: false };
  isolated.el.launchBackend = { value: "backend" };
  isolated.el.launchEffort = { value: "inherit" };
  isolated.el.launchModel = { value: "model" };
  isolated.el.launchBaseUrl = { value: "" };
  isolated.el.launchApiKeyMode = { value: "inherit" };
  isolated.el.launchApiKeyEnv = { value: "", disabled: false, required: false };
  isolated.el.launchExtraHeaders = { value: "" };
  isolated.el.sandboxFields = { hidden: false, inert: false };
  isolated.el.sandboxNoMount = { checked: false, disabled: false };
  isolated.el.sandboxImage = { value: "", disabled: false };
  isolated.el.sandboxGpu = { value: "", disabled: false };
  isolated.el.sandboxWorkdir = { value: "", disabled: false };
  isolated.el.sandboxShm = { value: "", disabled: false };
  isolated.el.sandboxMounts = { value: "", disabled: false };
  isolated.el.launchDefaultsPreview = fakeElement();
  isolated.el.launchDefaultsBody = { innerHTML: "" };
  isolated.el.refreshLaunchDefaults = { disabled: false };
  isolated.el.initialPrompt = { value: "start immediately" };
  isolated.el.commandComposer = { requestSubmit() { timeline.push("initial-prompt"); } };
  isolated.state.workspaceDiffs.set("created-session:src/old.js", { status: "ready" });
  isolated.state.acceptedRuns.set("created-session", {
    run_id: "preexisting", baseline_message_total: 0,
    submitted_user_message: { content: "created prompt", baseline_user_message_count: null },
  });

  await isolated.createSession({ preventDefault() {} });

  assert.deepEqual(requests, [
    { path: "/sessions", method: "POST" },
    { path: "/sessions?workspace_stats=true", method: "GET" },
  ]);
  assert.equal(requests.some(({ path, method }) => method === "GET" && path.startsWith("/sessions/created-session?")), false);
  assert.equal(instances.length, 1);
  assert.equal(instances[0].url, "/sessions/created-session/events/stream?limit=512");
  assert.ok(timeline.indexOf(`sse:${instances[0].url}`) < timeline.indexOf("initial-prompt"));
  assert.ok(timeline.indexOf("initial-prompt") < timeline.indexOf("GET:/sessions?workspace_stats=true"));
  assert.equal(isolated.state.currentId, "created-session");
  assert.deepEqual(plain(isolated.state.snapshots.get("created-session")), snapshot);
  assert.deepEqual(plain(isolated.state.messageWindows.get("created-session")), {
    start: 0, end: 2, total: 2, hasOlder: false, loading: false,
    messages: snapshot.messages,
  });
  assert.equal(isolated.state.workspaceDiffs.has("created-session:src/old.js"), false);
  assert.equal(isolated.state.acceptedRuns.has("created-session"), false);
  assert.equal(isolated.state.sessions[0].summary.session_id, "created-session");
  assert.equal(isolated.el.promptInput.value, "start immediately");
  assert.equal(isolated.el.launchDialog.closed, true);
  assert.equal(submit.disabled, false);

  instances[0].emit("replay_boundary", { replay_boundary_sequence_id: 0 });
  instances[0].emit("session_event", {
    session_id: "created-session", sequence_id: 1, run_id: "created-run",
    event: { type: "run_started", prompt_preview: "start immediately", started_at_epoch_ms: 100 },
  });
  await flushPromises();
  assert.equal(isolated.state.events.get("created-session").length, 1);
  assert.equal(requests.filter(({ path, method }) => method === "GET" && path === "/sessions").length, 1);
  assert.equal(isolated.state.sessions[0].summary.session_id, "created-session");
  assert.ok(timers.some(({ delay }) => delay === 120), "the existing event-driven snapshot refresh remains scheduled");
});

test("a failed session-list refresh preserves a newly upserted session", async () => {
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
  assert.match(ready, /Preview only/);
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
  for (const label of ["Session ID", "Working directory", "Execution mode", "SSH host", "Sandbox state", "Backend", "Model", "Store path"]) {
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
  }, { store_path: "/store.db" }), /<dt>Execution mode<\/dt><dd>sandbox<\/dd>[\s\S]*<dt>Sandbox state<\/dt><dd>running: podman<\/dd>/);
  assert.match(ui.renderSessionInfo({ ...summary, ssh_host: null, sandboxed: false }, null, { store_path: "/store.db" }), /<dt>Execution mode<\/dt><dd>local<\/dd>/);
});

test("compact session and thread surfaces recover full identities through titles and ARIA", () => {
  const summary = { session_id: "12345678-full-session-identity",
    title: "A compact session title",
    cwd: "/very/long/workspace/path/that/must/remain/recoverable",
    model: "provider/a-model-name-that-is-longer-than-twenty-four-characters",
    backend: "openai-responses", sandboxed: false, pinned: true,
    visible_message_count: 2, };
  const card = ui.renderSessionCard({ summary }, 0, [{ summary }]);
  assert.match(card, /title="A compact session title"/);
  assert.match(card, /title="local · \/very\/long\/workspace\/path\/that\/must\/remain\/recoverable"/);
  assert.match(card, /title="provider\/a-model-name-that-is-longer-than-twenty-four-characters" aria-label="Model: provider\/a-model-name-that-is-longer-than-twenty-four-characters"/);
  assert.match(card, /aria-label="A compact session title\. Idle\. No prompt submitted\. local\. Working directory \/very\/long\/workspace\/path\/that\/must\/remain\/recoverable\. Model provider\/a-model-name-that-is-longer-than-twenty-four-characters\. Workspace changes not loaded\."/);
  const thread = ui.renderThreadTile({
    name: "worker/a-very-long-thread-name-<with-context>",
    state: "running", compact: false, actions: [], });
  assert.match(thread, /class="thread-name" title="worker\/a-very-long-thread-name-&lt;with-context&gt;"/);
  assert.match(thread, /aria-label="Target worker\/a-very-long-thread-name-&lt;with-context&gt; for guidance"/);
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

test("renderCommandReference produces the command reference HTML", () => {
  const html = ui.renderCommandReference();
  assert.match(html, /<div class="command-reference">/);
  assert.match(html, /<code>\/compact<\/code><span>compact older orchestrator context<\/span>/);
  assert.match(html, /<code>\/help<\/code><span>show all commands<\/span>/);
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
