const state = {
  store: null,
  storeError: "",
  sessions: [],
  snapshots: new Map(),
  events: new Map(),
  lastSequence: new Map(),
  replayBoundaries: new Map(),
  eventEpochs: new Map(),
  currentId: null,
  targetedThread: null,
  eventSource: null,
  submittingSessions: new Set(),
  composerDrafts: new Map(),
  sessionReorder: null,
  snapshotTimers: new Map(),
  snapshotRefreshCoordinators: new Map(),
  sessionListRefreshCoordinator: null,
  statsLoadedAt: 0,
  statusTimer: null,
  commandIndex: 0,
  overviewGenerationId: null,
  focusView: null,
  settingsFocus: null,
  settingsRequestGeneration: 0,
  settingsSubmission: null,
  workspaceDiffs: new Map(),
  messageWindows: new Map(),
  orchestratorPrependAnchor: null,
  orchestratorViewport: null,
  threadEventWindows: new Map(),
  focusRenderId: 0,
  threadCycles: new Map(),
  attentionSessions: new Set(),
  sessionRunActivity: new Map(),
  acceptedRuns: new Map(),
  runtimeTimer: null,
  launchMode: "local",
  launchCwdDrafts: { localSandbox: null, ssh: null },
  launchDefaultsGeneration: 0,
  launchDefaultsTimer: null,
  launchDefaultsPreview: { status: "idle", data: null, error: "", request: null },
  launchApiKeyModeManual: false,
  launchApiKeyAutoManaged: false,
  workspaceRenderFrame: null,
  workspaceRenderSessionId: null,
  workspaceRestoreId: 0,
  focusOpener: null,
  drawerOpener: null,
};

const ACTION_LEDGER_LIMIT = 5;
const ORCHESTRATOR_MESSAGE_PAGE_LIMIT = 24;
const THREAD_EVENT_PAGE_LIMIT = 24;
const EVENT_STREAM_RECONNECT_DELAY_MS = 1_000;
const REORDER_DRAG_THRESHOLD_PX = 6;
const ORCHESTRATOR_STEERING_TARGET = "__orchestrator__";
let focusMarkdownRenderer = null;

const commands = [
  { name: "worksets", description: "inspect complete persisted worksets" },
  { name: "transcript", description: "open the orchestrator transcript" },
  { name: "workspace", description: "inspect changed files and diffs" },
  { name: "info", description: "show complete session and store identity" },
  { name: "settings", description: "edit this session's configuration" },
  { name: "stop", description: "stop the active orchestrator run" },
  { name: "rename", description: "rename this session" },
  { name: "delete", description: "delete this session" },
  { name: "clear", description: "clear the selected thread target" },
  { name: "help", description: "show all commands" },
];

const el = {};

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  boot();
});

function bindElements() {
  for (const id of [
    "app", "pickerTitle", "sessionPicker", "sessionWorkspace", "sessionLayout", "pickerSessionTotal", "pickerStorePath", "pickerNavStatus",
    "newSessionBtn", "sessionGrid", "reorderLive", "backToSessions", "sessionTitle",
    "sessionLocation", "renameSession", "sessionInfo", "metricModel", "metricContext", "metricTokens", "metricRun",
    "metricChanges", "sessionNavStatus", "stopRun", "refreshSession", "generatedOverview",
    "worksetRail", "worksetRailCount", "worksetRailSummary", "expandWorksets",
    "configRepairNotice", "configRepairDetail", "configRepairAction",
    "orchestratorState", "orchestratorLedger", "expandOrchestrator",
    "focusPanel", "focusTitle", "focusState", "focusContent", "closeFocusPanel",
    "threadGrid", "commandComposer", "composerTarget", "composerTargetName", "clearTarget",
    "promptInput", "sendPrompt", "commandMenu", "drawerBackdrop", "utilityDrawer",
    "drawerTitle", "drawerContent", "closeDrawer", "launchDialog", "launchForm",
    "launchExecutionModes", "launchCwd", "launchCwdLabel", "launchSshField", "launchSshHost", "launchBackend",
    "launchEffort", "launchModel", "launchBaseUrl", "launchCompactionThreshold", "launchApiKeyMode", "launchApiKeyEnv", "launchApiKeyEnvField", "launchApiKeyHelp", "launchExtraHeaders",
    "launchDefaultsPreview", "launchDefaultsBody", "refreshLaunchDefaults",
    "sandboxFields", "sandboxImage", "sandboxGpu", "sandboxWorkdir", "sandboxShm",
    "sandboxMounts", "sandboxNoMount", "initialPrompt", "launchStatus",
  ]) el[id] = document.getElementById(id);
}

function bindEvents() {
  el.newSessionBtn.addEventListener("click", openLaunchDialog);
  el.sessionGrid.addEventListener("click", handleSessionGridClick);
  el.sessionGrid.addEventListener("keydown", handleSessionGridKeydown);
  el.sessionGrid.addEventListener("pointerdown", handleSessionPointerDown);
  el.sessionGrid.addEventListener("dragstart", (event) => {
    if (event.target.closest(".move-handle")) event.preventDefault();
  });
  document.addEventListener("pointermove", handleSessionPointerMove);
  document.addEventListener("pointerup", handleSessionPointerUp);
  document.addEventListener("pointercancel", handleSessionPointerCancel);
  el.sessionGrid.addEventListener("lostpointercapture", handleSessionLostPointerCapture);
  window.addEventListener("blur", cancelSessionReorder);
  el.backToSessions.addEventListener("click", showPicker);
  el.renameSession.addEventListener("click", renameCurrentSession);
  el.sessionInfo.addEventListener("click", () => openFocusView("info"));
  el.configRepairAction.addEventListener("click", () => openFocusView("settings"));
  el.stopRun.addEventListener("click", stopActiveRun);
  el.refreshSession.addEventListener("click", generateOverview);
  el.expandWorksets.addEventListener("click", () => openFocusView("worksets"));
  el.expandOrchestrator.addEventListener("click", () => openFocusView("orchestrator"));
  el.closeFocusPanel.addEventListener("click", closeFocusView);
  el.focusContent.addEventListener("click", handleFocusClick);
  el.focusContent.addEventListener("scroll", handleFocusScroll, true);
  el.focusContent.addEventListener("submit", handleDrawerSubmit);
  el.threadGrid.addEventListener("click", handleThreadClick);
  el.commandComposer.addEventListener("submit", submitComposer);
  el.promptInput.addEventListener("input", handleComposerInput);
  el.promptInput.addEventListener("keydown", handleComposerKeydown);
  el.commandMenu.addEventListener("click", (event) => {
    const option = event.target.closest("[data-command-option]");
    if (option) runCommand(option.dataset.commandOption);
  });
  el.clearTarget.addEventListener("click", clearThreadTarget);
  document.addEventListener("click", (event) => {
    const command = event.target.closest("[data-command]");
    if (command) runCommand(command.dataset.command);
    const closer = event.target.closest("[data-close-dialog]");
    if (closer) document.getElementById(closer.dataset.closeDialog)?.close();
  });
  el.drawerBackdrop.addEventListener("click", closeDrawer);
  el.closeDrawer.addEventListener("click", closeDrawer);
  el.utilityDrawer.addEventListener("keydown", handleDrawerKeydown);
  el.drawerContent.addEventListener("submit", handleDrawerSubmit);
  el.launchExecutionModes.addEventListener("change", syncLaunchExecutionMode);
  el.launchCwd.addEventListener("input", handleLaunchLocationInput);
  el.launchSshHost.addEventListener("input", scheduleLaunchDefaultsPreview);
  el.refreshLaunchDefaults.addEventListener("click", () => loadLaunchDefaultsPreview());
  el.launchApiKeyMode.addEventListener("change", () => syncLaunchApiKeyMode({ user: true }));
  el.launchBackend.addEventListener("change", () => syncLaunchApiKeyMode());
  el.launchDialog.addEventListener("close", invalidateLaunchDefaultsPreview);
  el.launchForm.addEventListener("submit", createSession);
  window.addEventListener("hashchange", syncRouteFromHash);
  document.addEventListener("keydown", handleGlobalKeydown);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelSessionReorder();
    if (!document.hidden) {
      loadSessions({ workspaceStats: Date.now() - state.statsLoadedAt > 30_000 });
      if (state.currentId) loadSnapshot(state.currentId, false);
    }
  });
}

async function boot() {
  // Store metadata is supplementary: never serialize session availability behind it.
  void loadStoreInfo();
  await loadSessions({ workspaceStats: true });
  syncRouteFromHash();
  window.setInterval(() => {
    if (document.hidden || state.sessionListRefreshCoordinator) return;
    const workspaceStats = Date.now() - state.statsLoadedAt > 30_000;
    loadSessions({ workspaceStats });
  }, 5_000);
}

function renderPickerStorePath() {
  if (!el.pickerStorePath) return;
  const storePath = state.store?.store_path == null ? "" : String(state.store.store_path);
  const label = storePath || (state.storeError ? "Store unavailable" : "Loading store…");
  el.pickerStorePath.textContent = label;
  el.pickerStorePath.dataset.state = storePath ? "ready" : state.storeError ? "error" : "loading";
  el.pickerStorePath.title = storePath || state.storeError || label;
  el.pickerStorePath.setAttribute("aria-label", storePath
    ? `Session store: ${storePath}`
    : state.storeError ? `Session store unavailable: ${state.storeError}` : "Session store loading");
}

async function loadStoreInfo() {
  state.storeError = "";
  renderPickerStorePath();
  try {
    state.store = await apiGet("/store");
    const launchDraftsUninitialized = state.launchCwdDrafts.localSandbox === null
      && state.launchCwdDrafts.ssh === null;
    if (launchDraftsUninitialized) resetLaunchDraftState();
    renderPickerStorePath();
    return state.store;
  } catch (error) {
    state.store = null;
    state.storeError = error.message;
    renderPickerStorePath();
    if (el.sessionWorkspace && el.pickerNavStatus && el.sessionNavStatus) showToast(error.message, true);
    return null;
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...(options.headers || {}) } : options.headers,
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch (_) { payload = text; }
  }
  if (!response.ok) {
    const message = payload?.error || payload?.message || text || `${response.status} ${response.statusText}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

const apiGet = (path) => apiRequest(path);
const apiPost = (path, body = {}) => apiRequest(path, { method: "POST", body: JSON.stringify(body) });
const apiPut = (path, body = {}) => apiRequest(path, { method: "PUT", body: JSON.stringify(body) });
const apiPatch = (path, body = {}) => apiRequest(path, { method: "PATCH", body: JSON.stringify(body) });
const apiDelete = (path) => apiRequest(path, { method: "DELETE" });

function loadSessions({ workspaceStats = false, preserveSessionId = null } = {}) {
  if (state.sessionReorder) return Promise.resolve(state.sessions);
  const existing = state.sessionListRefreshCoordinator;
  if (existing) {
    existing.invalidation += 1;
    existing.dirty = true;
    existing.workspaceStats ||= Boolean(workspaceStats);
    retainSessionForListRefresh(existing, preserveSessionId);
    return existing.promise;
  }

  const coordinator = {
    invalidation: 1,
    dirty: true,
    workspaceStats: Boolean(workspaceStats),
    preservedSessions: new Map(),
    deletedSessionIds: new Set(),
    promise: null,
  };
  retainSessionForListRefresh(coordinator, preserveSessionId);
  state.sessionListRefreshCoordinator = coordinator;
  coordinator.promise = drainSessionListRefreshes(coordinator);
  return coordinator.promise;
}

function retainSessionForListRefresh(coordinator, sessionId) {
  if (sessionId == null) return;
  const key = String(sessionId);
  if (coordinator.deletedSessionIds.has(key)) return;
  const entry = sessionEntry(key);
  if (entry || !coordinator.preservedSessions.has(key)) {
    coordinator.preservedSessions.set(key, entry);
  }
}

function tombstoneDeletedSessionForListRefresh(sessionId) {
  const coordinator = state.sessionListRefreshCoordinator;
  if (!coordinator || sessionId == null) return;
  const key = String(sessionId);
  coordinator.preservedSessions.delete(key);
  coordinator.deletedSessionIds.add(key);
}

async function drainSessionListRefreshes(coordinator) {
  let accepted = null;
  try {
    while (coordinator.dirty) {
      if (state.sessionReorder) return accepted;
      coordinator.dirty = false;
      const requestInvalidation = coordinator.invalidation;
      const currentIdAtRequest = state.currentId;
      const workspaceStats = coordinator.workspaceStats;
      try {
        const loaded = await apiGet(`/sessions${workspaceStats ? "?workspace_stats=true" : ""}`);
        if (coordinator.invalidation !== requestInvalidation
            || state.currentId !== currentIdAtRequest
            || state.sessionReorder) continue;
        const previous = new Map(state.sessions
          .filter((entry) => !coordinator.deletedSessionIds.has(String(entry.summary.session_id)))
          .map((entry) => [String(entry.summary.session_id), entry]));
        for (const [sessionId, entry] of coordinator.preservedSessions) {
          if (entry && !previous.has(sessionId)) previous.set(sessionId, entry);
        }
        if (workspaceStats) state.statsLoadedAt = Date.now();
        const sessions = loaded
          .filter((entry) => !coordinator.deletedSessionIds.has(String(entry.summary.session_id)))
          .map((entry) => {
            const old = previous.get(String(entry.summary.session_id));
            if (entry.workspace_diff == null && old?.workspace_diff != null) return { ...entry, workspace_diff: old.workspace_diff };
            return entry;
          });
        const loadedIds = new Set(sessions.map((entry) => String(entry.summary.session_id)));
        for (const [sessionId, entry] of coordinator.preservedSessions) {
          const preserved = previous.get(sessionId) || entry;
          if (!loadedIds.has(sessionId) && preserved) sessions.push(preserved);
        }
        syncSessionRunIndicators(sessions);
        state.sessions = sessions;
        if (workspaceStats) {
          for (const entry of sessions) invalidateWorkspaceDiffs(entry?.summary?.session_id);
        }
        if (state.currentId && !sessionEntry(state.currentId)) showPicker();
        renderPicker();
        if (window.location.hash) syncRouteFromHash();
        if (state.currentId) scheduleWorkspaceRender(state.currentId);
        accepted = state.sessions;
      } catch (error) {
        if (coordinator.invalidation !== requestInvalidation
            || state.currentId !== currentIdAtRequest
            || state.sessionReorder) continue;
        showToast(error.message, true);
        accepted = null;
      }
    }
    return accepted;
  } finally {
    if (state.sessionListRefreshCoordinator === coordinator) {
      state.sessionListRefreshCoordinator = null;
    }
  }
}

function sessionEntry(sessionId = state.currentId) {
  return state.sessions.find((entry) => entry.summary.session_id === sessionId) || null;
}

function currentSnapshot() { return state.currentId ? state.snapshots.get(state.currentId) || null : null; }

function sessionStatus(entry) {
  const sessionId = entry?.summary?.session_id;
  if (entry?.active_run || state.sessionRunActivity.get(sessionId) === true) return "running";
  return state.attentionSessions.has(sessionId) ? "attention" : "idle";
}

function syncSessionRunIndicators(entries) {
  const seen = new Set();
  for (const entry of entries) {
    const sessionId = entry?.summary?.session_id;
    if (!sessionId) continue;
    const active = Boolean(entry.active_run);
    const wasActive = state.sessionRunActivity.get(sessionId) === true;
    if (active) state.attentionSessions.delete(sessionId);
    else if (wasActive) state.attentionSessions.add(sessionId);
    state.sessionRunActivity.set(sessionId, active);
    seen.add(sessionId);
  }
  for (const sessionId of state.sessionRunActivity.keys()) {
    if (seen.has(sessionId)) continue;
    state.sessionRunActivity.delete(sessionId);
    state.attentionSessions.delete(sessionId);
  }
}

function noteSessionRunEvent(sessionId, type, runId = null) {
  if (!sessionId) return;
  if (type === "run_started") {
    state.sessionRunActivity.set(sessionId, true);
    state.attentionSessions.delete(sessionId);
    return;
  }
  if (!["run_completed", "run_failed"].includes(type) || !runId) return;
  const matches = (run) => run && String(run.run_id || "") === String(runId);
  let cleared = false;
  if (matches(state.acceptedRuns.get(sessionId))) {
    state.acceptedRuns.delete(sessionId);
    cleared = true;
  }
  const entry = sessionEntry(sessionId);
  if (matches(entry?.active_run)) {
    entry.active_run = null;
    cleared = true;
  }
  const snapshot = state.snapshots.get(sessionId);
  if (matches(snapshot?.active_run)) {
    state.snapshots.set(sessionId, { ...snapshot, active_run: null });
    cleared = true;
  }
  const stillActive = Boolean(state.acceptedRuns.get(sessionId) || entry?.active_run || state.snapshots.get(sessionId)?.active_run);
  state.sessionRunActivity.set(sessionId, stillActive);
  if (cleared && !stillActive) state.attentionSessions.add(sessionId);
}

function clearSessionAttention(sessionId) {
  state.attentionSessions.delete(sessionId);
}

function capturePickerFocus() {
  const active = document.activeElement;
  if (!active || !el.sessionGrid?.contains?.(active)) return null;
  const control = active.closest?.("[data-action][data-session-id]") || active;
  const action = control?.dataset?.action;
  const sessionId = control?.dataset?.sessionId;
  return action && sessionId ? { action: String(action), sessionId: String(sessionId) } : null;
}

function restorePickerFocus(descriptor) {
  if (!descriptor || !el.sessionGrid) return null;
  const target = [...(el.sessionGrid.querySelectorAll?.("[data-action][data-session-id]") || [])]
    .find((control) => String(control.dataset?.action || "") === descriptor.action
      && String(control.dataset?.sessionId || "") === descriptor.sessionId);
  if (!target) return null;
  return restoreFocusTarget(captureFocusTarget(target), el.sessionGrid);
}

function renderPicker() {
  const focus = capturePickerFocus();
  renderPickerStorePath();
  const sessions = state.sessions;
  el.pickerSessionTotal.textContent = sessions.length;
  if (!sessions.length) {
    el.sessionGrid.innerHTML = `<div class="empty-picker"><div><strong>No sessions yet</strong>Launch one to start orchestrating.</div></div>`;
    return;
  }
  const pinned = sessions.filter((entry) => entry.summary.pinned);
  const regular = sessions.filter((entry) => !entry.summary.pinned);
  el.sessionGrid.innerHTML = pinned.length
    ? [renderSessionGroup("Pinned", pinned), regular.length ? renderSessionGroup("Other sessions", regular) : ""].join("")
    : `<section class="session-group"><div class="session-grid">${regular.map(renderSessionCard).join("")}</div></section>`;
  restorePickerFocus(focus);
}

function renderSessionGroup(title, entries) {
  return `<section class="session-group"><h2 class="group-heading">${escapeHtml(title)} <span>${entries.length}</span></h2><div class="session-grid">${entries.map(renderSessionCard).join("")}</div></section>`;
}

function sessionExecutionTopology(summary, snapshot = null) {
  const sshHost = summary?.ssh_host === null || summary?.ssh_host === undefined
    ? ""
    : String(summary.ssh_host);
  if (sshHost.trim()) {
    return { mode: "ssh", label: "ssh", host: sshHost, detail: `ssh ${sshHost}` };
  }
  const sandboxStatus = String(snapshot?.metadata?.sandbox_status || "").trim();
  if (summary?.sandboxed === true || (sandboxStatus && sandboxStatus !== "off")) {
    return { mode: "sandbox", label: "sandbox", host: null, detail: "sandbox" };
  }
  return { mode: "local", label: "local", host: null, detail: "local" };
}

function sessionExecutionLocationPresentation(summary, snapshot = null, workspace = snapshot?.workspace) {
  const topology = sessionExecutionTopology(summary, snapshot);
  const cwd = summary?.cwd ?? snapshot?.metadata?.cwd ?? "";
  const text = [topology.detail, workspace?.repo_label, workspace?.branch, cwd].filter(Boolean).join(" · ");
  return {
    topology,
    text,
    title: text,
    ariaLabel: `Execution target: ${topology.detail}. Working directory: ${cwd || "unavailable"}.`,
  };
}

function applySessionExecutionLocation(element, presentation) {
  if (!element || !presentation) return;
  element.textContent = presentation.text;
  element.title = presentation.title;
  element.dataset.mode = presentation.topology.mode;
  element.setAttribute("aria-label", presentation.ariaLabel);
}

function sessionReorderGroupLabel(pinned) { return pinned ? "pinned sessions" : "sessions"; }

function sessionReorderControlLabel(summary, position, count) {
  return `Reorder ${displaySessionTitle(summary)}; position ${position + 1} of ${count} in ${sessionReorderGroupLabel(Boolean(summary?.pinned))}`;
}

function workspaceSummaryPresentation(diff) {
  if (!diff) {
    return {
      state: "unavailable",
      label: "not loaded",
      detail: "Workspace summary has not been loaded.",
      ariaLabel: "Workspace changes not loaded",
    };
  }
  if (diff.error) {
    const detail = String(diff.error);
    return {
      state: "error",
      label: "workspace error",
      detail,
      ariaLabel: `Workspace error: ${detail}`,
    };
  }
  const additions = Number.isFinite(Number(diff.total_additions)) ? Number(diff.total_additions) : 0;
  const deletions = Number.isFinite(Number(diff.total_deletions)) ? Number(diff.total_deletions) : 0;
  const label = `+${additions} −${deletions}`;
  return {
    state: additions === 0 && deletions === 0 ? "clean" : "changed",
    label,
    detail: additions === 0 && deletions === 0 ? "Working tree clean." : `${additions} additions and ${deletions} deletions.`,
    ariaLabel: `Workspace changes: ${additions} additions and ${deletions} deletions`,
  };
}

function applyWorkspaceSummaryMetric(element, presentation) {
  if (!element) return;
  element.textContent = presentation.label;
  element.dataset.state = presentation.state;
  element.title = presentation.detail;
  element.setAttribute("aria-label", presentation.ariaLabel);
}

function renderSessionCard(entry, index = 0, entries = []) {
  const summary = entry.summary;
  const sessionId = String(summary.session_id || "");
  const status = sessionStatus(entry);
  const snapshot = state.snapshots.get(sessionId);
  const branch = snapshot?.workspace?.branch;
  const location = sessionExecutionLocationPresentation(summary, snapshot);
  const topology = location.topology;
  const workspaceLocation = [branch, basename(summary.cwd)].filter(Boolean).join(" · ") || summary.cwd;
  const fullLocation = location.text;
  const fullModel = String(snapshot?.metadata?.model || summary.model || "—");
  const identity = `${displaySessionTitle(summary)} · session ${sessionId}`;
  const prompt = summary.last_user_prompt || "No prompt submitted";
  const statusLabel = status === "running" ? "Running" : status === "attention" ? "Finished, needs attention" : "Idle";
  const changes = workspaceSummaryPresentation(entry.workspace_diff);
  return `
    <article class="session-card" data-session-id="${escapeAttr(sessionId)}" data-pinned="${summary.pinned}">
      <button class="session-select" type="button" data-action="open-session" data-session-id="${escapeAttr(sessionId)}" aria-label="${escapeAttr(`${identity}. ${statusLabel}. ${prompt}. ${topology.detail}. Working directory ${summary.cwd || "unavailable"}. Model ${fullModel}. ${changes.ariaLabel}.`)}">
        <span class="card-title-row"><i class="status-dot ${status}" aria-hidden="true"></i><span class="card-title" title="${escapeAttr(identity)}">${escapeHtml(displaySessionTitle(summary))}</span></span>
        <span class="card-location" title="${escapeAttr(fullLocation)}"><span class="card-topology" data-mode="${escapeAttr(topology.mode)}" title="${escapeAttr(`Execution target: ${topology.detail}`)}">${escapeHtml(topology.detail)}</span><span class="card-workspace-location">${escapeHtml(workspaceLocation)}</span></span>
        <span class="card-prompt" title="${escapeAttr(prompt)}">${escapeHtml(prompt)}</span>
        <span class="card-metrics"><span title="${escapeAttr(fullModel)}" aria-label="Model: ${escapeAttr(fullModel)}">${escapeHtml(shortModel(fullModel))}</span><span>${summary.visible_message_count || 0} messages</span><span class="changes" data-state="${escapeAttr(changes.state)}" title="${escapeAttr(changes.detail)}" aria-label="${escapeAttr(changes.ariaLabel)}">${escapeHtml(changes.label)}</span></span>
      </button>
      <div class="card-controls">
        <button class="card-control" type="button" data-action="toggle-pin" data-session-id="${escapeAttr(sessionId)}" aria-label="${summary.pinned ? "Unpin" : "Pin"} ${escapeAttr(displaySessionTitle(summary))}" aria-pressed="${summary.pinned}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 7 3 3v2H7v-2l3-3-1-7Z"></path><path d="M12 15v6"></path></svg>
        </button>
        <button class="card-control move-handle" type="button" data-action="move-session" data-session-id="${escapeAttr(sessionId)}" aria-label="${escapeAttr(sessionReorderControlLabel(summary, index, entries.length || 1))}" aria-describedby="reorderInstructions">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="7" r="1"></circle><circle cx="16" cy="7" r="1"></circle><circle cx="8" cy="12" r="1"></circle><circle cx="16" cy="12" r="1"></circle><circle cx="8" cy="17" r="1"></circle><circle cx="16" cy="17" r="1"></circle></svg>
        </button>
      </div>
    </article>`;
}

function handleSessionGridClick(event) {
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (state.sessionReorder) return;
  const sessionId = action.dataset.sessionId;
  if (action.dataset.action === "open-session") openSession(sessionId);
  if (action.dataset.action === "toggle-pin") toggleSessionPin(sessionId);
}

async function toggleSessionPin(sessionId) {
  const entry = sessionEntry(sessionId);
  if (!entry) return;
  const summary = entry.summary;
  try {
    const updated = await apiPut(`/sessions/${encodeURIComponent(sessionId)}/presentation`, {
      title: summary.title || "",
      pinned: !summary.pinned,
      expected_version: summary.presentation_version,
    });
    entry.summary = updated;
    await loadSessions({ workspaceStats: false });
    const card = el.sessionGrid.querySelector(`[data-session-id="${cssEscape(sessionId)}"] .move-handle`);
    card?.focus();
  } catch (error) { showToast(error.message, true); }
}

function handleSessionGridKeydown(event) {
  const handle = event.target.closest('[data-action="move-session"]');
  if (!handle) return;
  const reorder = state.sessionReorder;
  if (!reorder) {
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      startKeyboardSessionReorder(handle.dataset.sessionId);
    }
    return;
  }
  if (reorder.kind !== "keyboard" || reorder.sessionId !== handle.dataset.sessionId) return;
  if (["Enter", " "].includes(event.key)) {
    event.preventDefault();
    commitSessionReorder(reorder);
    return;
  }
  let next = reorder.currentIds.indexOf(reorder.sessionId);
  if (["ArrowUp", "ArrowLeft"].includes(event.key)) next -= 1;
  else if (["ArrowDown", "ArrowRight"].includes(event.key)) next += 1;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = reorder.currentIds.length - 1;
  else return;
  event.preventDefault();
  moveKeyboardSessionTo(reorder, next);
}

function orderedPresentationGroup(pinned) { return state.sessions.filter((entry) => entry.summary.pinned === pinned); }
function sessionGroupIds(pinned) { return orderedPresentationGroup(pinned).map((entry) => entry.summary.session_id); }
function sessionGridForCard(card) { return card?.closest(".session-grid") || null; }

function announceReorder(message) {
  el.reorderLive.textContent = "";
  window.requestAnimationFrame(() => { el.reorderLive.textContent = message || ""; });
}

function reorderAnnouncement(sessionId, position, count, pinned, suffix = "") {
  const entry = sessionEntry(sessionId);
  const title = displaySessionTitle(entry?.summary || { session_id: sessionId });
  return `${title}, position ${position + 1} of ${count} in ${sessionReorderGroupLabel(pinned)}.${suffix ? ` ${suffix}` : ""}`;
}

function startKeyboardSessionReorder(sessionId) {
  if (state.sessionReorder) return;
  const entry = sessionEntry(sessionId);
  const card = el.sessionGrid.querySelector(`[data-session-id="${cssEscape(sessionId)}"]`);
  const grid = sessionGridForCard(card);
  if (!entry || !card || !grid) return;
  const ids = sessionGroupIds(Boolean(entry.summary.pinned));
  state.sessionReorder = {
    kind: "keyboard",
    sessionId,
    pinned: Boolean(entry.summary.pinned),
    originalIds: ids,
    currentIds: ids.slice(),
    card,
    grid,
  };
  card.classList.add("is-reordering", "keyboard-reordering");
  grid.classList.add("is-reordering");
  document.body.classList.add("session-reordering");
  announceReorder(reorderAnnouncement(sessionId, ids.indexOf(sessionId), ids.length, entry.summary.pinned, "Use arrow keys, Home, or End, then Enter or Space to save."));
}

function moveKeyboardSessionTo(reorder, rawIndex) {
  const current = reorder.currentIds.indexOf(reorder.sessionId);
  const next = Math.max(0, Math.min(reorder.currentIds.length - 1, rawIndex));
  if (current === next) return;
  reorder.currentIds.splice(current, 1);
  reorder.currentIds.splice(next, 0, reorder.sessionId);
  reorderCardsDom(reorder.grid, reorder.currentIds);
  updateReorderLabels(reorder.grid);
  reorder.card.querySelector(".move-handle")?.focus();
  announceReorder(reorderAnnouncement(reorder.sessionId, next, reorder.currentIds.length, reorder.pinned));
}

function handleSessionPointerDown(event) {
  const handle = event.target.closest(".move-handle");
  if (!handle || handle.disabled || state.sessionReorder) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const card = handle.closest(".session-card");
  const grid = sessionGridForCard(card);
  const entry = sessionEntry(card?.dataset.sessionId);
  if (!card || !grid || !entry) return;
  const rect = card.getBoundingClientRect();
  state.sessionReorder = {
    kind: "pointer-pending",
    pointerId: event.pointerId,
    sessionId: card.dataset.sessionId,
    pinned: Boolean(entry.summary.pinned),
    originalIds: sessionGroupIds(Boolean(entry.summary.pinned)),
    currentIds: null,
    card,
    grid,
    handle,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    cardRect: rect,
    placeholder: null,
    captureReleased: false,
  };
  try { handle.setPointerCapture(event.pointerId); } catch (_) {}
}

function handleSessionPointerMove(event) {
  const reorder = state.sessionReorder;
  if (!reorder?.kind?.startsWith("pointer") || reorder.pointerId !== event.pointerId) return;
  if (reorder.kind === "pointer-pending") {
    if (Math.hypot(event.clientX - reorder.startX, event.clientY - reorder.startY) < REORDER_DRAG_THRESHOLD_PX) return;
    beginPointerSessionReorder(reorder);
  }
  if (reorder.kind !== "pointer") return;
  event.preventDefault();
  reorder.card.style.left = `${Math.round(event.clientX - reorder.offsetX)}px`;
  reorder.card.style.top = `${Math.round(event.clientY - reorder.offsetY)}px`;
  positionSessionPlaceholder(reorder, event.clientX, event.clientY);
}

function beginPointerSessionReorder(reorder) {
  if (state.sessionReorder !== reorder || reorder.kind !== "pointer-pending") return;
  const placeholder = document.createElement("div");
  placeholder.className = "session-card-placeholder";
  placeholder.style.minHeight = `${Math.max(1, Math.round(reorder.cardRect.height))}px`;
  placeholder.setAttribute("aria-hidden", "true");
  placeholder.innerHTML = '<span class="session-drop-marker"></span>';
  reorder.grid.insertBefore(placeholder, reorder.card);
  reorder.placeholder = placeholder;
  reorder.kind = "pointer";
  reorder.card.classList.add("is-reordering", "is-dragging");
  reorder.card.setAttribute("aria-grabbed", "true");
  reorder.grid.classList.add("is-reordering", "is-dragging");
  document.body.classList.add("session-reordering");
  Object.assign(reorder.card.style, {
    position: "fixed",
    left: `${reorder.cardRect.left}px`,
    top: `${reorder.cardRect.top}px`,
    width: `${reorder.cardRect.width}px`,
    height: `${reorder.cardRect.height}px`,
    margin: "0",
    zIndex: "1000",
  });
  announceReorder(reorderAnnouncement(reorder.sessionId, reorder.originalIds.indexOf(reorder.sessionId), reorder.originalIds.length, reorder.pinned, "Dragging. Release within this group to save."));
}

function positionSessionPlaceholder(reorder, clientX, clientY) {
  const gridRect = reorder.grid.getBoundingClientRect();
  if (clientX < gridRect.left || clientX > gridRect.right || clientY < gridRect.top || clientY > gridRect.bottom) return;
  const candidates = Array.from(reorder.grid.querySelectorAll(":scope > .session-card")).filter((card) => card !== reorder.card);
  let before = null;
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2 || (clientY <= rect.bottom && clientX < rect.left + rect.width / 2)) {
      before = candidate;
      break;
    }
  }
  if (before) reorder.grid.insertBefore(reorder.placeholder, before);
  else reorder.grid.append(reorder.placeholder);
  const ids = sessionIdsAtPlaceholder(reorder);
  const position = ids.indexOf(reorder.sessionId);
  if (position >= 0 && position !== reorder.lastAnnouncedPosition) {
    reorder.lastAnnouncedPosition = position;
    announceReorder(reorderAnnouncement(reorder.sessionId, position, ids.length, reorder.pinned));
  }
}

function sessionIdsAtPlaceholder(reorder) {
  const ids = [];
  for (const child of reorder.grid.children) {
    if (child === reorder.card) continue;
    if (child === reorder.placeholder) ids.push(reorder.sessionId);
    else if (child.matches?.(".session-card")) ids.push(child.dataset.sessionId);
  }
  return ids;
}

function handleSessionPointerUp(event) {
  const reorder = state.sessionReorder;
  if (!reorder?.kind?.startsWith("pointer") || reorder.pointerId !== event.pointerId) return;
  if (reorder.kind === "pointer-pending") {
    releaseSessionPointer(reorder);
    state.sessionReorder = null;
    return;
  }
  event.preventDefault();
  const rect = reorder.grid.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  if (!inside) {
    cancelSessionReorder();
    return;
  }
  reorder.currentIds = sessionIdsAtPlaceholder(reorder);
  cleanupSessionReorderDom(reorder, false);
  releaseSessionPointer(reorder);
  commitSessionReorder(reorder);
}

function handleSessionPointerCancel(event) {
  const reorder = state.sessionReorder;
  if (reorder?.kind?.startsWith("pointer") && reorder.pointerId === event.pointerId) cancelSessionReorder();
}

function handleSessionLostPointerCapture(event) {
  const reorder = state.sessionReorder;
  if (reorder?.kind?.startsWith("pointer") && reorder.pointerId === event.pointerId && !reorder.captureReleased) cancelSessionReorder();
}

function releaseSessionPointer(reorder) {
  reorder.captureReleased = true;
  try { if (reorder.handle?.hasPointerCapture(reorder.pointerId)) reorder.handle.releasePointerCapture(reorder.pointerId); } catch (_) {}
}

function cancelSessionReorder() {
  const reorder = state.sessionReorder;
  if (!reorder || reorder.kind === "committing") return false;
  releaseSessionPointer(reorder);
  cleanupSessionReorderDom(reorder, true);
  state.sessionReorder = null;
  const originalPosition = reorder.originalIds.indexOf(reorder.sessionId);
  announceReorder(reorderAnnouncement(reorder.sessionId, originalPosition, reorder.originalIds.length, reorder.pinned, "Cancelled. Original order restored."));
  el.sessionGrid.querySelector(`[data-session-id="${cssEscape(reorder.sessionId)}"] .move-handle`)?.focus();
  return true;
}

function cleanupSessionReorderDom(reorder, restoreOriginal) {
  if (reorder.placeholder) {
    reorder.grid.insertBefore(reorder.card, reorder.placeholder);
    reorder.placeholder.remove();
    reorder.placeholder = null;
  }
  reorder.card?.classList.remove("is-reordering", "is-dragging", "keyboard-reordering");
  reorder.card?.removeAttribute("aria-grabbed");
  for (const property of ["position", "left", "top", "width", "height", "margin", "z-index"]) reorder.card?.style.removeProperty(property);
  reorder.grid?.classList.remove("is-reordering", "is-dragging");
  document.body.classList.remove("session-reordering");
  if (restoreOriginal) reorderCardsDom(reorder.grid, reorder.originalIds);
  updateReorderLabels(reorder.grid);
}

function reorderCardsDom(grid, ids) {
  const cards = new Map(Array.from(grid?.querySelectorAll(":scope > .session-card") || []).map((card) => [card.dataset.sessionId, card]));
  for (const id of ids || []) if (cards.has(id)) grid.append(cards.get(id));
}

function updateReorderLabels(grid) {
  const cards = Array.from(grid?.querySelectorAll(":scope > .session-card") || []);
  cards.forEach((card, index) => {
    const summary = sessionEntry(card.dataset.sessionId)?.summary || {
      session_id: card.dataset.sessionId,
      pinned: card.dataset.pinned === "true",
    };
    card.querySelector(".move-handle")?.setAttribute("aria-label", sessionReorderControlLabel(summary, index, cards.length));
  });
}

async function commitSessionReorder(reorder) {
  if (state.sessionReorder !== reorder) return;
  const ids = reorder.currentIds || reorder.originalIds;
  if (ids.every((id, index) => id === reorder.originalIds[index])) {
    cleanupSessionReorderDom(reorder, false);
    state.sessionReorder = null;
    announceReorder(reorderAnnouncement(reorder.sessionId, ids.indexOf(reorder.sessionId), ids.length, reorder.pinned, "Order unchanged."));
    return;
  }
  cleanupSessionReorderDom(reorder, false);
  reorder.kind = "committing";
  const expected = Object.fromEntries(orderedPresentationGroup(reorder.pinned).map((entry) => [entry.summary.session_id, entry.summary.presentation_version]));
  try {
    const result = await apiPut("/sessions/order", { pinned: reorder.pinned, session_ids: ids, expected_versions: expected });
    const byId = new Map(state.sessions.map((entry) => [entry.summary.session_id, entry]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
    const other = orderedPresentationGroup(!reorder.pinned);
    state.sessions = reorder.pinned ? [...ordered, ...other] : [...other, ...ordered];
    const updates = new Map(result.sessions.map((summary) => [summary.session_id, summary]));
    for (const entry of state.sessions) if (updates.has(entry.summary.session_id)) entry.summary = updates.get(entry.summary.session_id);
    state.sessionReorder = null;
    renderPicker();
    const position = ids.indexOf(reorder.sessionId);
    announceReorder(reorderAnnouncement(reorder.sessionId, position, ids.length, reorder.pinned, "Saved."));
    el.sessionGrid.querySelector(`[data-session-id="${cssEscape(reorder.sessionId)}"] .move-handle`)?.focus();
  } catch (error) {
    state.sessionReorder = null;
    showToast(error.message, true);
    const refreshed = await loadSessions({ workspaceStats: false });
    if (refreshed) {
      const authoritativeGroup = orderedPresentationGroup(reorder.pinned);
      const position = authoritativeGroup.findIndex((entry) => entry.summary.session_id === reorder.sessionId);
      if (position >= 0) {
        announceReorder(reorderAnnouncement(
          reorder.sessionId,
          position,
          authoritativeGroup.length,
          reorder.pinned,
          `Save failed; authoritative server order reloaded. ${error.message}`,
        ));
      } else {
        const title = displaySessionTitle({ session_id: reorder.sessionId });
        announceReorder(`${title}. Save failed; authoritative server order was reloaded and this session is no longer present. ${error.message}`);
      }
    } else {
      announceReorder(`${displaySessionTitle(sessionEntry(reorder.sessionId)?.summary || { session_id: reorder.sessionId })}. Save failed; server order could not be reloaded, so the displayed order may be stale. ${error.message}`);
    }
    el.sessionGrid.querySelector(`[data-session-id="${cssEscape(reorder.sessionId)}"] .move-handle`)?.focus();
  }
}

function syncRouteFromHash() {
  const match = window.location.hash.match(/^#session\/(.+)$/);
  if (!match) {
    if (state.currentId) showPicker(false);
    return;
  }
  const sessionId = decodeURIComponent(match[1]);
  if (sessionEntry(sessionId) && state.currentId !== sessionId) openSession(sessionId, false);
}

function openSession(sessionId, updateHash = true, { fetchSnapshot = true } = {}) {
  if (!sessionEntry(sessionId)) return;
  persistComposerDraft(state.currentId);
  clearSessionAttention(sessionId);
  state.currentId = sessionId;
  state.targetedThread = null;
  state.focusView = null;
  state.settingsFocus = null;
  state.settingsRequestGeneration += 1;
  el.sessionPicker.hidden = true;
  el.sessionWorkspace.hidden = false;
  restoreComposerDraft(sessionId);
  if (updateHash) history.pushState(null, "", `#session/${encodeURIComponent(sessionId)}`);
  renderWorkspace();
  requestAnimationFrame(() => el.renameSession?.focus?.({ preventScroll: true }));
  if (fetchSnapshot) loadSnapshot(sessionId, true);
  connectEventStream(sessionId);
}

function showPicker(updateHash = true) {
  const returningSessionId = state.currentId;
  persistComposerDraft(returningSessionId);
  state.currentId = null;
  state.targetedThread = null;
  state.focusView = null;
  state.settingsFocus = null;
  state.settingsRequestGeneration += 1;
  if (state.eventSource) state.eventSource.close();
  state.eventSource = null;
  stopRuntimeTimer();
  closeDrawer();
  el.sessionWorkspace.hidden = true;
  el.sessionPicker.hidden = false;
  if (updateHash) history.pushState(null, "", window.location.pathname);
  renderPicker();
  requestAnimationFrame(() => {
    const sessionButton = returningSessionId
      ? el.sessionGrid?.querySelector?.(`[data-action="open-session"][data-session-id="${cssEscape(returningSessionId)}"]`)
      : null;
    (sessionButton || el.pickerTitle)?.focus?.({ preventScroll: true });
  });
}

function loadSnapshot(sessionId, announce = false) {
  if (!sessionId) return Promise.resolve(null);
  const existing = state.snapshotRefreshCoordinators.get(sessionId);
  if (existing) {
    existing.invalidation += 1;
    existing.dirty = true;
    existing.announce ||= Boolean(announce);
    return existing.promise;
  }

  const coordinator = {
    invalidation: 1,
    dirty: true,
    announce: Boolean(announce),
    promise: null,
  };
  state.snapshotRefreshCoordinators.set(sessionId, coordinator);
  coordinator.promise = drainSnapshotRefreshes(sessionId, coordinator);
  return coordinator.promise;
}

async function drainSnapshotRefreshes(sessionId, coordinator) {
  let accepted = null;
  try {
    while (coordinator.dirty) {
      coordinator.dirty = false;
      const requestInvalidation = coordinator.invalidation;
      const currentIdAtRequest = state.currentId;
      try {
        const snapshot = await apiGet(`/sessions/${encodeURIComponent(sessionId)}?message_limit=${ORCHESTRATOR_MESSAGE_PAGE_LIMIT}&thread_event_limit=${THREAD_EVENT_PAGE_LIMIT}&include_sessions=false`);
        if (coordinator.invalidation !== requestInvalidation || state.currentId !== currentIdAtRequest) continue;
        accepted = acceptSnapshot(sessionId, snapshot, { announce: coordinator.announce });
      } catch (error) {
        if (coordinator.invalidation !== requestInvalidation || state.currentId !== currentIdAtRequest) continue;
        if (state.currentId === sessionId) showToast(error.message, true);
        accepted = null;
      }
    }
    return accepted;
  } finally {
    if (state.snapshotRefreshCoordinators.get(sessionId) === coordinator) {
      state.snapshotRefreshCoordinators.delete(sessionId);
    }
  }
}

function acceptSnapshot(sessionId, snapshot, { announce = false } = {}) {
  const responseSessionId = snapshot?.metadata?.session_id;
  if (responseSessionId != null && String(responseSessionId) !== String(sessionId)) {
    throw new Error(`Snapshot identity mismatch: requested ${sessionId}, received ${responseSessionId}`);
  }
  mergeSnapshotMessageWindow(sessionId, snapshot);
  reconcileAcceptedRun(sessionId, snapshot);
  invalidateWorkspaceDiffs(sessionId);
  state.snapshots.set(sessionId, snapshot);
  if (state.currentId === sessionId) scheduleWorkspaceRender(sessionId);
  if (announce && state.currentId === sessionId) showToast("Session refreshed");
  return snapshot;
}

function mergeSnapshotMessageWindow(sessionId, snapshot) {
  const page = snapshot?.message_page;
  const incoming = snapshot?.messages || [];
  if (!page) {
    state.messageWindows.set(sessionId, {
      start: 0,
      end: incoming.length,
      total: incoming.length,
      hasOlder: false,
      loading: false,
      messages: incoming,
    });
    return snapshot;
  }

  const previous = state.messageWindows.get(sessionId);
  let start = Number(page.start || 0);
  let messages = incoming;
  if (previous && previous.start <= start && previous.total <= Number(page.total || 0)) {
    const prefixLength = start - previous.start;
    if (prefixLength <= previous.messages.length) {
      start = previous.start;
      messages = [...previous.messages.slice(0, prefixLength), ...incoming];
    }
  }
  const windowState = {
    start,
    end: Number(page.end ?? page.total ?? messages.length),
    total: Number(page.total ?? messages.length),
    hasOlder: start > 0,
    loading: false,
    messages,
  };
  state.messageWindows.set(sessionId, windowState);
  snapshot.messages = messages;
  snapshot.message_page = {
    ...page,
    start,
    has_older: windowState.hasOlder,
  };
  return snapshot;
}

function prependMessageWindow(sessionId, snapshot, response) {
  const current = state.messageWindows.get(sessionId);
  const page = response?.page;
  if (!current || !page || Number(page.end) !== current.start) return false;
  const messages = [...(response.messages || []), ...current.messages];
  const windowState = {
    start: Number(page.start || 0),
    end: current.end,
    total: Math.max(current.total, Number(page.total || 0)),
    hasOlder: Boolean(page.has_older),
    loading: false,
    messages,
  };
  state.messageWindows.set(sessionId, windowState);
  snapshot.messages = messages;
  snapshot.message_page = {
    ...(snapshot.message_page || {}),
    start: windowState.start,
    end: windowState.end,
    total: windowState.total,
    has_older: windowState.hasOlder,
  };
  return true;
}

function messageCycleUserCount(snapshot) {
  const marker = String(snapshot?.message_cycle?.marker || "");
  const match = marker.match(/^history:(\d+):/);
  if (match) return Number(match[1]);
  const startsAtBeginning = !snapshot?.message_page || Number(snapshot.message_page.start || 0) === 0;
  if (!startsAtBeginning) return null;
  return (snapshot?.messages || []).filter((message) => message?.role === "user").length;
}

function normalizedSubmittedMessage(activeRun, source = "snapshot") {
  const submitted = activeRun?.submitted_user_message;
  if (!submitted || submitted.content === null || submitted.content === undefined) return null;
  const baselineValue = submitted.baseline_user_message_count;
  const baseline = baselineValue === null || baselineValue === undefined || baselineValue === ""
    ? Number.NaN
    : Number(baselineValue);
  const baselineTotalValue = activeRun?.baseline_message_total;
  const baselineTotal = baselineTotalValue === null || baselineTotalValue === undefined || baselineTotalValue === ""
    ? Number.NaN
    : Number(baselineTotalValue);
  return {
    role: "user",
    content: String(submitted.content),
    pending: true,
    pendingSource: source,
    run_id: String(submitted.run_id || activeRun?.run_id || ""),
    client_id: submitted.client_id || activeRun?.client_id || null,
    baselineUserCount: Number.isSafeInteger(baseline) && baseline >= 0 ? baseline : null,
    baselineMessageTotal: Number.isSafeInteger(baselineTotal) && baselineTotal >= 0 ? baselineTotal : null,
    submitted_at_epoch_ms: submitted.submitted_at_epoch_ms || activeRun?.started_at_epoch_ms || null,
  };
}

function pendingMessagesMatch(left, right) {
  const leftRunId = String(left?.run_id || "");
  const rightRunId = String(right?.run_id || "");
  if (leftRunId && rightRunId && leftRunId === rightRunId) return true;
  return String(left?.content ?? "") === String(right?.content ?? "");
}

function pendingMessageCoveredByCanonical(pending, snapshot) {
  if (!pending) return false;
  const messages = snapshot?.messages || [];
  const windowStart = Number(snapshot?.message_page?.start || 0);
  const userMessages = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === "user") userMessages.push({ message, index });
  }

  // A baseline message total is captured from the exact include-system page used
  // when a run is accepted. Any later canonical user row is therefore the
  // submitted row, even when command expansion changes its persisted content.
  const hasMessageBaseline = Number.isSafeInteger(pending.baselineMessageTotal);
  if (hasMessageBaseline) {
    if (userMessages.some(({ index }) => windowStart + index >= pending.baselineMessageTotal)) return true;
  }

  // The server's user-count baseline is authoritative across paged windows. Do
  // not let a same-text user row from before that baseline hide the pending row.
  if (Number.isSafeInteger(pending.baselineUserCount)) {
    const globalUserCount = messageCycleUserCount(snapshot);
    if (globalUserCount !== null && globalUserCount > pending.baselineUserCount) {
      return userMessages.length > 0;
    }
    if (windowStart === 0 && userMessages.length > pending.baselineUserCount) return true;
    return false;
  }
  if (hasMessageBaseline) return false;

  // Legacy active-run snapshots may lack both baselines. In that case only the
  // newest visible user row may reconcile an identical pending message.
  const latestUser = userMessages.at(-1)?.message;
  return Boolean(latestUser && pendingMessagesMatch(latestUser, pending));
}

function captureAcceptedRun(sessionId, response, prompt, snapshot = state.snapshots.get(sessionId), now = Date.now()) {
  if (!sessionId || !response?.run_id) return null;
  const displayPrompt = String(response.display_prompt ?? prompt ?? "");
  const baselineUserCount = messageCycleUserCount(snapshot);
  const pageTotal = Number(snapshot?.message_page?.total);
  const baselineMessageTotal = Number.isSafeInteger(pageTotal) && pageTotal >= 0
    ? pageTotal
    : (!snapshot?.message_page ? (snapshot?.messages || []).length : null);
  const accepted = {
    run_id: String(response.run_id),
    client_id: response.client_id || null,
    prompt_preview: displayPrompt.slice(0, 160),
    submitted_user_message: {
      run_id: String(response.run_id),
      client_id: response.client_id || null,
      content: displayPrompt,
      baseline_user_message_count: baselineUserCount,
      submitted_at_epoch_ms: now,
    },
    started_at_epoch_ms: now,
    baseline_message_total: baselineMessageTotal,
    accepted_response: true,
  };
  state.acceptedRuns.set(sessionId, accepted);
  state.sessionRunActivity.set(sessionId, true);
  state.attentionSessions.delete(sessionId);
  return accepted;
}

function captureStartedRun(sessionId, envelope) {
  const runId = String(envelope?.run_id || "");
  if (!sessionId || !runId) return null;
  const existing = state.acceptedRuns.get(sessionId);
  const submitted = envelope?.event?.submitted_user_message || existing?.submitted_user_message || null;
  const started = {
    ...(existing || {}),
    run_id: runId,
    client_id: envelope?.client_id || submitted?.client_id || existing?.client_id || null,
    prompt_preview: envelope?.event?.prompt_preview || existing?.prompt_preview || "",
    submitted_user_message: submitted ? {
      ...submitted,
      run_id: submitted.run_id || runId,
      client_id: submitted.client_id || envelope?.client_id || existing?.client_id || null,
    } : null,
    started_at_epoch_ms: envelope?.event?.started_at_epoch_ms || existing?.started_at_epoch_ms || Date.now(),
    accepted_response: Boolean(existing?.accepted_response),
  };
  state.acceptedRuns.set(sessionId, started);
  return started;
}

function effectiveActiveRun(snapshot = currentSnapshot(), sessionId = state.currentId) {
  const accepted = sessionId ? state.acceptedRuns.get(sessionId) : null;
  const canonical = snapshot?.active_run || null;
  if (!canonical) return accepted;
  if (!accepted || String(accepted.run_id || "") !== String(canonical.run_id || "")) return canonical;
  return {
    ...accepted,
    ...canonical,
    submitted_user_message: canonical.submitted_user_message || accepted.submitted_user_message || null,
    accepted_response: Boolean(accepted.accepted_response),
  };
}

function effectivePendingMessages(sessionId = state.currentId, snapshot = state.snapshots.get(sessionId)) {
  const active = effectiveActiveRun(snapshot, sessionId);
  const source = active?.accepted_response ? "accepted response" : "active snapshot";
  const pending = normalizedSubmittedMessage(active, source);
  return pending && !pendingMessageCoveredByCanonical(pending, snapshot) ? [pending] : [];
}

function reconcileAcceptedRun(sessionId, snapshot) {
  const accepted = state.acceptedRuns.get(sessionId);
  if (!accepted) return false;
  const canonical = snapshot?.active_run;
  if (canonical && String(canonical.run_id || "") !== String(accepted.run_id || "")) {
    state.acceptedRuns.delete(sessionId);
    return true;
  }
  const pending = normalizedSubmittedMessage(accepted, "accepted response");
  if (pendingMessageCoveredByCanonical(pending, snapshot)) {
    state.acceptedRuns.delete(sessionId);
    return true;
  }
  return false;
}

function responseDurationAssignments(snapshot, messages = snapshot?.messages || []) {
  const responseIndices = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === "assistant" && !(message.tool_calls?.length > 0) && !message.pending) responseIndices.push(index);
  }
  const timing = snapshot?.response_timing || {};
  let durations = Array.isArray(timing.response_durations_ms)
    ? timing.response_durations_ms
    : [];
  if (!durations.length && responseIndices.length) {
    durations = Array(responseIndices.length).fill(null);
    durations[responseIndices.length - 1] = timing.last_response_duration_ms ?? null;
    if (responseIndices.length > 1) durations[responseIndices.length - 2] = timing.previous_response_duration_ms ?? null;
  }
  const aligned = durations.slice(-responseIndices.length);
  while (aligned.length < responseIndices.length) aligned.unshift(null);
  const assignments = new Map();
  responseIndices.forEach((messageIndex, responseIndex) => {
    const duration = aligned[responseIndex];
    const numericDuration = duration === null || duration === undefined || duration === ""
      ? Number.NaN
      : Number(duration);
    if (Number.isFinite(numericDuration) && numericDuration >= 0) assignments.set(messageIndex, numericDuration);
  });
  return assignments;
}

function handleFocusScroll(event) {
  const scroller = event.target;
  if (state.focusView?.type === "orchestrator" && scroller?.classList?.contains("focus-chat")) {
    if (event.isTrusted) {
      state.orchestratorViewport = {
        sessionId: state.currentId,
        pinnedToBottom: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80,
        scrollTop: scroller.scrollTop,
      };
    }
    if (scroller.scrollTop <= 36) loadOlderOrchestratorMessages(scroller);
    return;
  }
  if (state.focusView?.type === "thread" && scroller?.classList?.contains("focus-activity")) {
    if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 48) {
      loadOlderThreadEvents(state.focusView.name, scroller);
    }
  }
}

async function loadOlderOrchestratorMessages(scroller) {
  const sessionId = state.currentId;
  const snapshot = currentSnapshot();
  const messageWindow = sessionId ? state.messageWindows.get(sessionId) : null;
  if (!sessionId || !snapshot || !messageWindow?.hasOlder || messageWindow.loading) return;

  messageWindow.loading = true;
  const loader = scroller?.querySelector("[data-history-loader]");
  if (loader) {
    loader.classList.add("is-loading");
    const label = loader.querySelector("span");
    if (label) label.textContent = "loading earlier messages";
  }
  const anchor = {
    sessionId,
    scrollHeight: scroller?.scrollHeight || 0,
    scrollTop: scroller?.scrollTop || 0,
  };
  try {
    const response = await apiGet(`/sessions/${encodeURIComponent(sessionId)}/messages?before=${messageWindow.start}&limit=${ORCHESTRATOR_MESSAGE_PAGE_LIMIT}`);
    if (state.currentId !== sessionId || state.focusView?.type !== "orchestrator") {
      messageWindow.loading = false;
      return;
    }
    if (!prependMessageWindow(sessionId, snapshot, response)) {
      messageWindow.loading = false;
      return;
    }
    state.orchestratorPrependAnchor = anchor;
    renderFocusView(snapshot);
  } catch (error) {
    messageWindow.loading = false;
    showToast(error.message, true);
    if (loader) {
      loader.classList.remove("is-loading");
      const label = loader.querySelector("span");
      if (label) label.textContent = "scroll up for earlier messages";
    }
  }
}

function orchestratorHistoryNeedsFill(scroller, messageWindow) {
  return Boolean(
    scroller
    && messageWindow?.hasOlder
    && !messageWindow.loading
    && scroller.scrollHeight <= scroller.clientHeight + 1
  );
}

function ensureOrchestratorScrollableHistory(renderId = state.focusRenderId) {
  if (renderId !== state.focusRenderId || state.focusView?.type !== "orchestrator") return;
  const sessionId = state.currentId;
  const scroller = el.focusContent?.querySelector?.(".focus-chat");
  const messageWindow = sessionId ? state.messageWindows.get(sessionId) : null;
  if (orchestratorHistoryNeedsFill(scroller, messageWindow)) {
    loadOlderOrchestratorMessages(scroller);
  }
}

function threadEventWindowKey(sessionId, threadName) {
  return `${sessionId || ""}:${threadName || ""}`;
}

async function loadThreadEventPage(threadName, { reset = false } = {}) {
  const sessionId = state.currentId;
  if (!sessionId || !threadName) return;
  const key = threadEventWindowKey(sessionId, threadName);
  const current = state.threadEventWindows.get(key);
  if (current?.loading) return;
  if (!reset && current && !current.hasOlder) return;

  const windowState = reset
    ? { events: [], hasOlder: true, nextBeforeId: null, loading: true, boundary: null }
    : { ...current, loading: true };
  state.threadEventWindows.set(key, windowState);
  if (!reset && state.focusView?.type === "thread" && state.focusView.name === threadName) {
    renderFocusView(currentSnapshot());
  }

  const before = !reset && current?.nextBeforeId != null
    ? `&before_id=${encodeURIComponent(current.nextBeforeId)}`
    : "";
  try {
    const response = await apiGet(`/sessions/${encodeURIComponent(sessionId)}/threads/${encodeURIComponent(threadName)}/events?limit=${THREAD_EVENT_PAGE_LIMIT}${before}`);
    if (state.currentId !== sessionId) return;
    if (state.threadEventWindows.get(key) !== windowState) return;
    state.threadEventWindows.set(key, {
      events: reset ? (response.events || []) : [...(current?.events || []), ...(response.events || [])],
      hasOlder: Boolean(response.has_older),
      nextBeforeId: response.next_before_id ?? null,
      loading: false,
      boundary: reset ? response.thread_event_boundary ?? null : windowState.boundary,
    });
  } catch (error) {
    if (state.threadEventWindows.get(key) === windowState) {
      if (reset) state.threadEventWindows.delete(key);
      else state.threadEventWindows.set(key, { ...windowState, loading: false });
    }
    showToast(error.message, true);
  }
  if (state.focusView?.type === "thread" && state.focusView.name === threadName) {
    renderFocusView(currentSnapshot());
  }
}

function loadOlderThreadEvents(threadName) {
  const key = threadEventWindowKey(state.currentId, threadName);
  const windowState = state.threadEventWindows.get(key);
  if (!windowState?.hasOlder || windowState.loading) return;
  loadThreadEventPage(threadName);
}

function resetSessionSequenceEpoch(sessionId, boundary = 0, epochId = null) {
  state.events.delete(sessionId);
  state.lastSequence.delete(sessionId);
  state.replayBoundaries.set(sessionId, boundary);
  if (epochId) state.eventEpochs.set(sessionId, epochId);
  else state.eventEpochs.delete(sessionId);
  state.threadCycles.delete(sessionId);
  state.attentionSessions.delete(sessionId);
  state.sessionRunActivity.delete(sessionId);
  state.acceptedRuns.delete(sessionId);
  const entry = sessionEntry(sessionId);
  if (entry?.active_run) entry.active_run = null;
  const snapshot = state.snapshots.get(sessionId);
  if (snapshot?.active_run) state.snapshots.set(sessionId, { ...snapshot, active_run: null });
  const prefix = `${sessionId}:`;
  for (const key of [...state.threadEventWindows.keys()]) {
    if (key.startsWith(prefix)) state.threadEventWindows.delete(key);
  }
  if (state.currentId === sessionId) scheduleWorkspaceRender(sessionId);
}

function applyReplayBoundary(sessionId, boundary, { epochId = "", requestedPriorSequence = null, reconnect = null } = {}) {
  if (!epochId || !Number.isSafeInteger(boundary) || boundary < 0) return { valid: false, reset: false, reconnected: false };
  const observed = state.lastSequence.get(sessionId);
  const prior = Number.isSafeInteger(observed) ? observed
    : Number.isSafeInteger(requestedPriorSequence) ? requestedPriorSequence : null;
  const knownEpoch = state.eventEpochs.get(sessionId);
  if ((knownEpoch && knownEpoch !== epochId) || (prior !== null && boundary < prior)) {
    resetSessionSequenceEpoch(sessionId, boundary, epochId);
    loadSnapshot(sessionId, false);
    if (reconnect) {
      reconnect();
      return { valid: true, reset: true, reconnected: true };
    }
    return { valid: true, reset: true, reconnected: false };
  }

  state.eventEpochs.set(sessionId, epochId);
  state.replayBoundaries.set(sessionId, boundary);
  return { valid: true, reset: false, reconnected: false };
}

function recordSessionEnvelope(sessionId, envelope, { historical = false } = {}) {
  const sequence = envelope?.sequence_id;
  const epochId = String(envelope?.epoch_id || "");
  if (!epochId || epochId !== state.eventEpochs.get(sessionId)
      || !Number.isSafeInteger(sequence) || sequence < 1) return false;
  const lastSequence = state.lastSequence.get(sessionId);
  if (Number.isSafeInteger(lastSequence) && sequence <= lastSequence) return false;
  state.lastSequence.set(sessionId, sequence);
  const list = state.events.get(sessionId) || [];
  list.push(envelope);
  if (list.length > 768) list.splice(0, list.length - 768);
  state.events.set(sessionId, list);
  if (!historical) {
    const type = envelope.event?.type;
    if (type === "run_started") captureStartedRun(sessionId, envelope);
    noteSessionRunEvent(sessionId, type, envelope.run_id || null);
  }
  return true;
}

function parseStreamPayload(event) {
  try { return JSON.parse(event?.data || "{}"); }
  catch (_) { return null; }
}

function connectEventStream(sessionId, { replayFromBeginning = false } = {}) {
  const previousSource = state.eventSource;
  state.eventSource = null;
  if (previousSource) previousSource.close();
  const storedPrior = state.lastSequence.get(sessionId);
  const requestedPriorSequence = !replayFromBeginning && Number.isSafeInteger(storedPrior)
    ? storedPrior
    : null;
  const query = requestedPriorSequence !== null
    ? `?after_sequence_id=${encodeURIComponent(requestedPriorSequence)}&limit=512`
    : "?limit=512";
  let source;
  try {
    source = new EventSource(`/sessions/${encodeURIComponent(sessionId)}/events/stream${query}`);
  } catch (_) {
    return null;
  }
  state.eventSource = source;
  let observationFloor = null;
  let boundaryState = "pending";
  source.addEventListener("replay_boundary", (event) => {
    if (state.eventSource !== source) return;
    const payload = parseStreamPayload(event);
    const boundary = payload?.replay_boundary_sequence_id;
    const epochId = String(payload?.epoch_id || "");
    const observedPrior = state.lastSequence.get(sessionId);
    const priorAtBoundary = Number.isSafeInteger(observedPrior) ? observedPrior : requestedPriorSequence;
    const result = applyReplayBoundary(sessionId, boundary, {
      epochId,
      requestedPriorSequence,
      reconnect: () => connectEventStream(sessionId, { replayFromBeginning: true }),
    });
    if (result.reconnected) return;
    if (!result.valid) {
      boundaryState = "invalid";
      observationFloor = Number.isSafeInteger(priorAtBoundary) ? priorAtBoundary : Number.POSITIVE_INFINITY;
      loadSnapshot(sessionId, false);
      return;
    }
    boundaryState = "valid";
    observationFloor = result.reset || priorAtBoundary === null ? boundary : priorAtBoundary;
  });
  source.addEventListener("session_event", (event) => {
    if (state.eventSource !== source) return;
    if (boundaryState !== "valid") {
      if (boundaryState === "pending") {
        boundaryState = "invalid";
        loadSnapshot(sessionId, false);
      }
      return;
    }
    const envelope = parseStreamPayload(event);
    if (!envelope || !Number.isSafeInteger(envelope.sequence_id) || envelope.sequence_id < 1) {
      loadSnapshot(sessionId, false);
      return;
    }
    const historical = observationFloor === null || envelope.sequence_id <= observationFloor;
    if (!recordSessionEnvelope(sessionId, envelope, { historical })) return;
    if (state.currentId === sessionId) scheduleWorkspaceRender(sessionId);
    if (!historical && eventNeedsSnapshot(envelope)) scheduleSnapshot(sessionId);
    if (!historical && ["run_started", "run_completed", "run_failed"].includes(envelope.event?.type)) {
      renderPicker();
      loadSessions({ workspaceStats: false });
    }
  });
  source.addEventListener("replay_gap", () => {
    if (state.eventSource !== source) return;
    loadSnapshot(sessionId, false);
  });
  source.addEventListener("lagged", () => {
    if (state.eventSource !== source) return;
    loadSnapshot(sessionId, false);
    connectEventStream(sessionId);
  });
  source.onerror = () => {
    if (state.eventSource !== source || source.readyState !== 2) return;
    window.setTimeout(() => {
      if (state.eventSource !== source || state.currentId !== sessionId || source.readyState !== 2) return;
      connectEventStream(sessionId);
    }, EVENT_STREAM_RECONNECT_DELAY_MS);
  };
  return source;
}

function eventNeedsSnapshot(envelope) {
  const type = envelope.event?.type;
  if (["run_started", "run_completed", "run_failed", "snapshot_saved"].includes(type)) return true;
  const agent = agentEvent(envelope);
  return ["thread_started", "thread_finished", "thread_steering_queued", "thread_steering_delivered", "thread_steering_expired"].includes(agent?.type);
}

function scheduleSnapshot(sessionId) {
  const existing = state.snapshotTimers.get(sessionId);
  if (existing != null) window.clearTimeout(existing);
  const timer = window.setTimeout(() => {
    state.snapshotTimers.delete(sessionId);
    loadSnapshot(sessionId, false);
  }, 120);
  state.snapshotTimers.set(sessionId, timer);
}

function agentEvent(envelope) { return envelope?.event?.type === "agent" ? envelope.event.event : null; }


function renderConfigRepairGuidance(summary) {
  const modelConfigError = String(summary?.model_config_error || "").trim();
  if (!el.configRepairNotice || !el.configRepairDetail || !el.configRepairAction) return;
  el.configRepairNotice.hidden = !modelConfigError;
  el.configRepairDetail.textContent = modelConfigError;
  el.configRepairAction.setAttribute(
    "aria-label",
    modelConfigError ? `Repair model configuration. ${modelConfigError}` : "Repair model configuration",
  );
}

function runTimingPresentation(snapshot = currentSnapshot(), sessionId = state.currentId, now = Date.now()) {
  const entryActive = sessionEntry(sessionId)?.active_run || null;
  const active = effectiveActiveRun(snapshot, sessionId) || entryActive;
  const lifecycle = orchestratorLifecycle(snapshot, sessionId);
  const activeRunId = String(active?.run_id || "");
  const terminalMatchesActive = ["completed", "failed"].includes(lifecycle.state)
    && (!lifecycle.runId || !activeRunId || String(lifecycle.runId) === activeRunId);
  if (active && !terminalMatchesActive) {
    const startedValue = active.started_at_epoch_ms ?? lifecycle.startedAtEpochMs;
    const startedAt = startedValue === null || startedValue === undefined ? Number.NaN : Number(startedValue);
    const elapsedMs = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : null;
    return {
      state: "active",
      label: elapsedMs === null ? "active" : formatRuntime(elapsedMs),
      title: elapsedMs === null ? "Active run; start time unavailable" : `Active elapsed runtime: ${formatRuntime(elapsedMs)}`,
      elapsedMs,
    };
  }
  const durationMs = snapshot?.response_timing?.last_response_duration_ms;
  if (durationMs !== null && durationMs !== undefined && Number.isFinite(Number(durationMs))) {
    return {
      state: "response",
      label: formatDuration(Number(durationMs)),
      title: `Last response duration: ${formatDuration(Number(durationMs))}`,
      elapsedMs: null,
    };
  }
  return { state: "idle", label: "—", title: "No response duration recorded", elapsedMs: null };
}

function updateRuntimeMetric(now = Date.now()) {
  if (!el.metricRun || !state.currentId) return null;
  const presentation = runTimingPresentation(currentSnapshot(), state.currentId, now);
  el.metricRun.textContent = presentation.label;
  el.metricRun.title = presentation.title;
  el.metricRun.dataset.state = presentation.state;
  return presentation;
}

function stopRuntimeTimer() {
  if (state.runtimeTimer !== null) window.clearInterval(state.runtimeTimer);
  state.runtimeTimer = null;
}

function syncRuntimeTimer() {
  const presentation = updateRuntimeMetric();
  if (presentation?.state === "active" && presentation.elapsedMs !== null) {
    if (state.runtimeTimer === null) {
      state.runtimeTimer = window.setInterval(() => {
        const current = updateRuntimeMetric();
        if (current?.state !== "active" || current.elapsedMs === null) stopRuntimeTimer();
      }, 250);
      state.runtimeTimer?.unref?.();
    }
  } else stopRuntimeTimer();
  return presentation;
}

function scheduleWorkspaceRender(sessionId = state.currentId, render = renderWorkspace) {
  if (!sessionId || state.currentId !== sessionId) return false;
  state.workspaceRenderSessionId = sessionId;
  if (state.workspaceRenderFrame !== null) return false;
  state.workspaceRenderFrame = -1;
  const frame = requestAnimationFrame(() => {
    state.workspaceRenderFrame = null;
    const scheduledSessionId = state.workspaceRenderSessionId;
    state.workspaceRenderSessionId = null;
    if (scheduledSessionId && state.currentId === scheduledSessionId) render();
  });
  if (state.workspaceRenderFrame === -1) state.workspaceRenderFrame = frame ?? true;
  return true;
}

const RESTORABLE_DATA_KEYS = [
  "focusThread", "threadName", "focusWorkspaceFile", "commandOption",
  "episodeSummary", "retrySettings", "action",
];

function captureFocusTarget(element) {
  if (!element || element === document.body || element === document.documentElement) return null;
  const descriptor = {
    element,
    id: element.id || "",
    tagName: String(element.tagName || "").toLowerCase(),
    name: element.name || element.getAttribute?.("name") || "",
    href: element.getAttribute?.("href") || "",
    dataKey: "",
    dataValue: "",
    selectionStart: Number.isInteger(element.selectionStart) ? element.selectionStart : null,
    selectionEnd: Number.isInteger(element.selectionEnd) ? element.selectionEnd : null,
  };
  for (const key of RESTORABLE_DATA_KEYS) {
    if (element.dataset?.[key] !== undefined) {
      descriptor.dataKey = key;
      descriptor.dataValue = String(element.dataset[key]);
      break;
    }
  }
  if (!descriptor.id && !descriptor.name && !descriptor.href && !descriptor.dataKey) return null;
  return descriptor;
}

function focusTargetCandidates(root, descriptor) {
  if (!root || !descriptor) return [];
  if (descriptor.id) {
    const byId = root.getElementById?.(descriptor.id)
      || (root.id === descriptor.id ? root : null);
    if (byId) return [byId];
  }
  const tagName = descriptor.tagName || "*";
  const candidates = [...(root.querySelectorAll?.(tagName) || [])];
  return candidates.filter((candidate) => {
    if (descriptor.id && String(candidate.id || "") !== descriptor.id) return false;
    if (descriptor.name && String(candidate.name || candidate.getAttribute?.("name") || "") !== descriptor.name) return false;
    if (descriptor.href && String(candidate.getAttribute?.("href") || "") !== descriptor.href) return false;
    if (descriptor.dataKey && String(candidate.dataset?.[descriptor.dataKey] ?? "") !== descriptor.dataValue) return false;
    return Boolean(descriptor.id || descriptor.name || descriptor.href || descriptor.dataKey);
  });
}

function findFocusTarget(descriptor, root = document) {
  if (!descriptor) return null;
  if (descriptor.element?.isConnected !== false) return descriptor.element;
  return focusTargetCandidates(root, descriptor)[0] || null;
}

function restoreFocusTarget(descriptor, root = document) {
  const target = findFocusTarget(descriptor, root);
  if (!target
      || target.isConnected === false
      || target.disabled
      || target.hidden
      || target.getAttribute?.("aria-hidden") === "true"
      || target.getAttribute?.("aria-disabled") === "true"
      || target.closest?.("[inert]")
      || target.closest?.("[hidden]")) return null;
  if (typeof target.focus !== "function") return null;
  const activeBefore = document.activeElement;
  try {
    target.focus({ preventScroll: true });
  } catch (_) {
    try { target.focus(); } catch (_) { return null; }
  }
  if (document.activeElement && document.activeElement === activeBefore && document.activeElement !== target) return null;
  if (descriptor.selectionStart !== null && typeof target.setSelectionRange === "function") {
    try { target.setSelectionRange(descriptor.selectionStart, descriptor.selectionEnd ?? descriptor.selectionStart); } catch (_) { /* Not all inputs support selection ranges. */ }
  }
  return target;
}

function captureFormControlStates(root = el.focusContent) {
  return [...(root?.querySelectorAll?.("input, textarea, select") || [])].map((control) => ({
    target: captureFocusTarget(control),
    element: control,
    value: control.value,
    checked: Boolean(control.checked),
    selectionStart: Number.isInteger(control.selectionStart) ? control.selectionStart : null,
    selectionEnd: Number.isInteger(control.selectionEnd) ? control.selectionEnd : null,
  })).filter((entry) => entry.target);
}

function restoreFormControlStates(entries, root = el.focusContent) {
  for (const entry of entries || []) {
    if (entry.element?.isConnected !== false) continue;
    const control = findFocusTarget(entry.target, root);
    if (!control) continue;
    if ("value" in control) control.value = entry.value;
    if ("checked" in control) control.checked = entry.checked;
    if (entry.selectionStart !== null && typeof control.setSelectionRange === "function") {
      try { control.setSelectionRange(entry.selectionStart, entry.selectionEnd ?? entry.selectionStart); } catch (_) { /* Ignore unsupported control types. */ }
    }
  }
}

function focusScrollTargets() {
  const targets = [];
  if (el.focusContent) targets.push(["focus-content", el.focusContent]);
  const selectors = [
    ["orchestrator-chat", ".focus-chat"],
    ["orchestrator-live", ".focus-live"],
    ["thread-activity", ".focus-activity"],
    ["thread-episodes", ".focus-episodes"],
    ["worksets", ".focus-worksets-scroll"],
    ["workspace-files", ".focus-files"],
    ["workspace-diff", ".focus-diff"],
  ];
  for (const [key, selector] of selectors) {
    const target = el.focusContent?.querySelector?.(selector);
    if (target) targets.push([key, target]);
  }
  return targets;
}

function captureScrollPositions(targets = focusScrollTargets()) {
  return (targets || []).map(([key, target]) => ({
    key,
    top: Number(target?.scrollTop || 0),
    left: Number(target?.scrollLeft || 0),
    height: Number(target?.scrollHeight || 0),
    clientHeight: Number(target?.clientHeight || 0),
  }));
}

function restoreScrollPositions(entries, targets = focusScrollTargets(), { skip = new Set() } = {}) {
  const available = new Map(targets || []);
  for (const entry of entries || []) {
    if (skip.has(entry.key)) continue;
    const target = available.get(entry.key);
    if (!target) continue;
    target.scrollTop = entry.top;
    target.scrollLeft = entry.left;
  }
}

function focusViewIdentity(view = state.focusView) {
  return view ? `${state.currentId || ""}:${view.type || ""}:${view.name || ""}:${view.path || ""}` : "";
}

function captureFocusViewState() {
  const renderedViewIdentity = el.focusPanel?.dataset?.viewIdentity;
  const renderedIdentity = renderedViewIdentity || focusViewIdentity();
  const openEpisodes = new Set(
    [...(el.focusContent?.querySelectorAll?.(".focus-episode") || [])]
      .filter((episode) => episode.open)
      .map((episode) => `${episode.dataset?.episodeId || ""}:${episode.dataset?.episodeIndex || ""}`),
  );
  return {
    identity: renderedIdentity,
    hadRenderedView: Boolean(renderedViewIdentity),
    active: captureFocusTarget(document.activeElement),
    forms: state.focusView?.type === "settings" ? [] : captureFormControlStates(),
    scroll: captureScrollPositions(),
    openEpisodes,
  };
}

function activeElementAllowsRestoration(descriptor) {
  const active = document.activeElement;
  return !active || active === document.body || active === descriptor?.element || active?.isConnected === false;
}

function restoreFocusViewState(restoration, { renderId, prependAnchor = null } = {}) {
  if (!restoration || restoration.identity !== focusViewIdentity()) return;
  restoreFormControlStates(restoration.forms);
  const applyScroll = () => {
    if (renderId !== state.focusRenderId || restoration.identity !== focusViewIdentity()) return false;
    const skip = state.focusView?.type === "orchestrator" ? new Set(["orchestrator-chat"]) : new Set();
    restoreScrollPositions(restoration.scroll, focusScrollTargets(), { skip });
    if (state.focusView?.type === "orchestrator") {
      const scroller = el.focusContent?.querySelector?.(".focus-chat");
      if (scroller) {
        if (prependAnchor) {
          scroller.scrollTop = Math.max(0, scroller.scrollHeight - prependAnchor.scrollHeight + prependAnchor.scrollTop);
        } else {
          const captured = restoration.scroll.find((entry) => entry.key === "orchestrator-chat");
          const viewport = state.orchestratorViewport?.sessionId === state.currentId
            ? state.orchestratorViewport
            : null;
          const pinnedToBottom = viewport?.pinnedToBottom ?? !captured;
          scroller.scrollTop = pinnedToBottom ? scroller.scrollHeight : (captured?.top ?? viewport?.scrollTop ?? 0);
        }
      }
    }
    return true;
  };
  // Restore synchronously so a steady event stream cannot starve restoration by
  // invalidating a chain of queued frames. Reapply once after layout settles.
  applyScroll();
  if (restoration.active?.element?.isConnected === false && activeElementAllowsRestoration(restoration.active)) {
    restoreFocusTarget(restoration.active);
  }
  requestAnimationFrame(applyScroll);
}

function scheduleActiveControlRestoration(descriptor) {
  const restoreId = ++state.workspaceRestoreId;
  if (!descriptor) return;
  requestAnimationFrame(() => {
    if (restoreId !== state.workspaceRestoreId || descriptor.element?.isConnected !== false || !activeElementAllowsRestoration(descriptor)) return;
    restoreFocusTarget(descriptor);
  });
}

function renderWorkspace() {
  const entry = sessionEntry();
  const snapshot = currentSnapshot();
  if (!entry) return;
  const summary = entry.summary;
  const workspace = snapshot?.workspace;
  const location = sessionExecutionLocationPresentation(summary, snapshot, workspace);
  const displayTitle = displaySessionTitle(summary);
  const sessionId = String(summary.session_id || state.currentId || "");
  const fullModel = String(snapshot?.metadata?.model || summary.model || "—");
  el.sessionTitle.textContent = displayTitle;
  el.sessionTitle.title = `${displayTitle} · session ${sessionId}`;
  el.renameSession.title = `Rename ${displayTitle} · session ${sessionId}`;
  el.renameSession.setAttribute("aria-label", `Rename ${displayTitle}; session ID ${sessionId}`);
  applySessionExecutionLocation(el.sessionLocation, location);
  renderConfigRepairGuidance(summary);
  el.metricModel.textContent = shortModel(fullModel);
  el.metricModel.title = fullModel;
  el.metricModel.setAttribute("aria-label", `Model: ${fullModel}`);
  const usage = displayedTokenUsage(snapshot);
  const contextTokens = orchestratorContextTokens(usage);
  el.metricContext.textContent = formatNumber(contextTokens);
  el.metricContext.title = contextTokens ? `${contextTokens.toLocaleString()} tokens` : "";
  el.metricTokens.textContent = tokenUsageSummary(usage);
  el.metricTokens.title = tokenUsageTitle(usage);
  const timing = syncRuntimeTimer();
  const diff = workspace ?? entry.workspace_diff;
  applyWorkspaceSummaryMetric(el.metricChanges, workspaceSummaryPresentation(diff));
  const active = timing?.state === "active";
  el.stopRun.hidden = !active;
  renderOverview(snapshot);
  renderThreads(snapshot);
  renderComposerTarget();
  if (state.focusView?.type !== "settings" || !el.focusContent.querySelector("#settingsForm")) renderFocusView(snapshot);
}

function displayedTokenUsage(snapshot, sessionId = state.currentId, envelopes = null) {
  const persisted = snapshot?.response_timing?.cumulative_token_usage
    || snapshot?.response_timing?.last_token_usage
    || null;
  const usage = {
    input_tokens: Number(persisted?.input_tokens || 0),
    output_tokens: Number(persisted?.output_tokens || 0),
    cache_read_tokens: Number(persisted?.cache_read_tokens || 0),
    cache_write_tokens: Number(persisted?.cache_write_tokens || 0),
    reasoning_tokens: Number(persisted?.reasoning_tokens || 0),
    total_tokens: orchestratorContextTokens(persisted),
  };
  let hasUsage = Boolean(persisted);
  const sessionEvents = envelopes || state.events.get(sessionId) || [];
  const activeRunId = usageRunId(snapshot, sessionEvents);
  if (!activeRunId) return hasUsage ? usage : null;

  for (const envelope of sessionEvents) {
    if (String(envelope?.run_id || "") !== activeRunId) continue;
    const event = agentEvent(envelope);
    if (event?.type !== "token_usage_updated" || !event.usage) continue;
    usage.input_tokens += Number(event.usage.input_tokens || 0);
    usage.output_tokens += Number(event.usage.output_tokens || 0);
    usage.cache_read_tokens += Number(event.usage.cache_read_tokens || 0);
    usage.cache_write_tokens += Number(event.usage.cache_write_tokens || 0);
    usage.reasoning_tokens += Number(event.usage.reasoning_tokens || 0);
    if (event.thread_name == null) usage.total_tokens = orchestratorContextTokens(event.usage);
    hasUsage = true;
  }
  return hasUsage ? usage : null;
}

function usageRunId(snapshot, envelopes) {
  const snapshotRunId = effectiveActiveRun(snapshot)?.run_id;
  if (snapshotRunId) return String(snapshotRunId);
  let activeRunId = null;
  for (const envelope of envelopes || []) {
    const type = envelope?.event?.type;
    if (type === "run_started") activeRunId = String(envelope.run_id || "") || null;
    if (["run_completed", "run_failed"].includes(type)
      && (!envelope.run_id || String(envelope.run_id) === activeRunId)) activeRunId = null;
  }
  return activeRunId;
}

function orchestratorContextTokens(usage) {
  return Number(usage?.total_tokens ?? usage?.orchestrator_context_tokens ?? 0);
}

function tokenUsageSummary(usage) {
  if (!usage) return "—";
  const parts = [`↑${formatTokenCount(usage.input_tokens)}`];
  if (Number(usage.cache_read_tokens || 0) > 0) parts.push(`R${formatTokenCount(usage.cache_read_tokens)}`);
  parts.push(`↓${formatTokenCount(usage.output_tokens)}`);
  return parts.join(" ");
}

function tokenUsageTitle(usage) {
  if (!usage) return "";
  const exact = (value) => Number(value || 0).toLocaleString();
  return `input ${exact(usage.input_tokens)} · cache read ${exact(usage.cache_read_tokens)} · output ${exact(usage.output_tokens)}`;
}

function renderOverview(snapshot) {
  const overview = snapshot?.overview;
  const generating = state.overviewGenerationId === state.currentId;
  const action = overview ? "Regenerate" : "Generate";
  el.refreshSession.disabled = generating;
  el.refreshSession.classList.toggle("is-generating", generating);
  el.refreshSession.setAttribute("aria-label", generating ? "Generating overview" : `${action} overview`);
  el.refreshSession.title = generating ? "Generating overview" : `${action} from current session state`;
  if (generating) el.refreshSession.setAttribute("aria-busy", "true");
  else el.refreshSession.removeAttribute("aria-busy");
  el.generatedOverview.classList.toggle("is-empty", !overview);
  if (!overview) {
    el.generatedOverview.innerHTML = `<p class="overview-empty">${generating ? "Generating current state…" : "Not generated."}</p>`;
  } else {
    el.generatedOverview.innerHTML = `<p class="overview-copy">${escapeHtml(overview.summary || overview.status || "")}</p>`;
  }
  renderWorksetRail(snapshot);
  renderOrchestratorLedger(snapshot);
}

function worksetsPresentation(snapshot) {
  if (!snapshot) return { state: "loading", items: [], error: "" };
  if (!Object.prototype.hasOwnProperty.call(snapshot, "worksets") || !snapshot.worksets) {
    return { state: "error", items: [], error: "Workset data is unavailable in this snapshot." };
  }
  const worksets = snapshot.worksets;
  if (worksets.error !== null && worksets.error !== undefined) {
    return { state: "error", items: [], error: String(worksets.error) || "Unknown workset error." };
  }
  if (!Array.isArray(worksets.items)) {
    return { state: "error", items: [], error: "Workset items are unavailable in this snapshot." };
  }
  return {
    state: worksets.items.length ? "populated" : "empty",
    items: worksets.items,
    error: "",
  };
}

function worksetCountLabel(count) {
  return `${count} workset${count === 1 ? "" : "s"}`;
}

function worksetItemCountLabel(items) {
  if (!Array.isArray(items)) return "Item count unavailable";
  return `${items.length} item${items.length === 1 ? "" : "s"}`;
}

function worksetStatusText(workset) {
  const status = String(workset?.status ?? "");
  return status || "Status not recorded";
}

function renderCompactWorkset(workset) {
  const summary = String(workset?.summary ?? "");
  return `<article class="compact-workset" data-status="${escapeAttr(workset?.status ?? "")}">
    <header><strong>${escapeHtml(workset?.id ?? "")}</strong><span>${escapeHtml(worksetStatusText(workset))}</span></header>
    <div>${escapeHtml(worksetItemCountLabel(workset?.items))}</div>
    ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
  </article>`;
}

function renderWorksetRail(snapshot) {
  const presentation = worksetsPresentation(snapshot);
  el.worksetRailSummary.dataset.state = presentation.state;
  el.worksetRailCount.textContent = presentation.state === "loading"
    ? "…"
    : presentation.state === "error" ? "!" : String(presentation.items.length);
  if (presentation.state === "loading") {
    el.worksetRailSummary.innerHTML = "<p>Loading worksets…</p>";
  } else if (presentation.state === "error") {
    el.worksetRailSummary.innerHTML = `<p class="workset-rail-error" role="alert">${escapeHtml(presentation.error)}</p>`;
  } else if (presentation.state === "empty") {
    el.worksetRailSummary.innerHTML = "<p>No worksets yet.</p>";
  } else {
    el.worksetRailSummary.innerHTML = presentation.items.map(renderCompactWorkset).join("");
  }
}

async function generateOverview() {
  if (!state.currentId || el.refreshSession.disabled) return;
  const sessionId = state.currentId;
  state.overviewGenerationId = sessionId;
  renderOverview(currentSnapshot());
  try {
    const overview = await apiPost(`/sessions/${encodeURIComponent(sessionId)}/overview`);
    const snapshot = state.snapshots.get(sessionId);
    if (snapshot) snapshot.overview = overview;
    showToast("Overview generated from current session state");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    if (state.overviewGenerationId === sessionId) state.overviewGenerationId = null;
    if (state.currentId === sessionId) renderOverview(state.snapshots.get(sessionId));
  }
}

function orchestratorLifecycle(snapshot, sessionId = state.currentId) {
  const events = state.events.get(sessionId) || [];
  let observed = null;
  let latestStart = null;
  for (const envelope of events) {
    const type = envelope?.event?.type;
    if (!["run_started", "run_completed", "run_failed"].includes(type)) continue;
    const sequenceId = Number.isSafeInteger(Number(envelope.sequence_id)) ? Number(envelope.sequence_id) : null;
    const runId = envelope.run_id == null ? null : String(envelope.run_id);
    if (type === "run_started") {
      latestStart = {
        runId,
        sequenceId,
        startedAtEpochMs: envelope.event.started_at_epoch_ms ?? null,
      };
    }
    const matchingStart = latestStart && (!runId || !latestStart.runId || latestStart.runId === runId) ? latestStart : null;
    observed = {
      state: type === "run_started" ? "running" : type === "run_completed" ? "completed" : "failed",
      provenance: "observed",
      sequenceId,
      startSequence: type === "run_started" ? sequenceId : matchingStart?.sequenceId ?? null,
      finishSequence: type === "run_started" ? null : sequenceId,
      runId,
      startedAtEpochMs: type === "run_started" ? envelope.event.started_at_epoch_ms ?? null : matchingStart?.startedAtEpochMs ?? null,
      durationMs: type === "run_completed" ? envelope.event.duration_ms ?? null : null,
      detail: type === "run_started" ? envelope.event.prompt_preview : type === "run_completed" ? envelope.event.response : envelope.event.message,
    };
  }
  const active = effectiveActiveRun(snapshot, sessionId);
  const activeRunId = active?.run_id == null ? null : String(active.run_id);
  if (active && (!observed || observed.state === "running" || (activeRunId && activeRunId !== observed.runId))) {
    const matchesObserved = observed?.state === "running" && (!activeRunId || activeRunId === observed.runId);
    return {
      state: "running",
      provenance: active.accepted_response ? "accepted" : "snapshot",
      sequenceId: matchesObserved ? observed.sequenceId : null,
      startSequence: matchesObserved ? observed.startSequence : null,
      finishSequence: null,
      runId: activeRunId,
      startedAtEpochMs: active.started_at_epoch_ms ?? (matchesObserved ? observed.startedAtEpochMs : null),
      durationMs: null,
      detail: active.prompt_preview || (matchesObserved ? observed.detail : "") || "",
    };
  }
  return observed || {
    state: "no-run",
    provenance: "unavailable",
    sequenceId: null,
    startSequence: null,
    finishSequence: null,
    runId: null,
    startedAtEpochMs: null,
    durationMs: null,
    detail: "No run lifecycle event is available in the current replay window.",
  };
}

function renderOrchestratorLedger(snapshot) {
  const lifecycle = orchestratorLifecycle(snapshot);
  el.orchestratorState.textContent = lifecycle.state;
  el.orchestratorState.dataset.state = lifecycle.state;
  el.orchestratorState.classList.toggle("is-active", lifecycle.state === "running");
  el.orchestratorLedger.innerHTML = renderActionRows(
    buildOrchestratorActions(snapshot),
    "No orchestrator action evidence",
  );
}

function actionEvidence(entry, overrides = {}) {
  return {
    provenance: entry?.provenance || "observed",
    sequenceId: entry?.sequenceId ?? null,
    eventId: entry?.eventId ?? null,
    timestamp: entry?.timestamp ?? null,
    kind: entry?.event?.type || "event",
    ...overrides,
  };
}

function usageDetail(usage) {
  if (!usage) return "Usage unavailable";
  const exact = (value) => Number(value || 0).toLocaleString();
  return `input ${exact(usage.input_tokens)} · cache read ${exact(usage.cache_read_tokens)} · output ${exact(usage.output_tokens)} · context ${exact(orchestratorContextTokens(usage))}`;
}

function combineActionDetail(...values) {
  return compactActionDetail(values.filter((value) => String(value ?? "").trim()).join(" · "), 800);
}

function buildOrchestratorActions(snapshot, { limit = true } = {}) {
  const persisted = buildPersistedOrchestratorActions(snapshot?.messages || [], { limit: false });
  const actions = [];
  const calls = new Map();
  const observedCallIds = new Set();
  const observedSteering = new Set();
  const events = state.events.get(state.currentId) || [];
  for (const envelope of events) {
    const entry = {
      event: envelope?.event,
      provenance: "observed",
      sequenceId: Number.isSafeInteger(Number(envelope?.sequence_id)) ? Number(envelope.sequence_id) : null,
    };
    const sessionEvent = envelope?.event;
    if (sessionEvent?.type === "run_started") {
      actions.push({ name: "run", result: "started", state: "live", detail: compactActionDetail(sessionEvent.prompt_preview), ...actionEvidence(entry) });
      continue;
    }
    if (sessionEvent?.type === "run_completed") {
      actions.push({ name: "run", result: "completed", state: "done", detail: combineActionDetail(sessionEvent.duration_ms == null ? "" : `duration ${sessionEvent.duration_ms} ms`, sessionEvent.response), ...actionEvidence(entry) });
      continue;
    }
    if (sessionEvent?.type === "run_failed") {
      actions.push({ name: "run", result: "failed", state: "error", detail: compactActionDetail(sessionEvent.message), ...actionEvidence(entry) });
      continue;
    }
    if (sessionEvent?.type === "snapshot_saved") {
      actions.push({ name: "snapshot", result: "saved", state: "done", detail: compactActionDetail(sessionEvent.session_id), ...actionEvidence(entry) });
      continue;
    }

    const event = agentEvent(envelope);
    if (!event || eventThreadName(event)) continue;
    const evidence = actionEvidence({ ...entry, event });
    if (event.type.startsWith("model_call_")) {
      continue;
    } else if (event.type === "token_usage_updated") {
      actions.push({ name: "usage", result: "updated", state: "done", detail: usageDetail(event.usage), ...evidence });
    } else if (event.type === "tool_call_started") {
      const argumentsDetail = formatToolArguments(event.args_preview);
      const action = {
        name: event.name || "tool",
        result: "running",
        state: "live",
        callId: event.call_id || null,
        argumentsDetail,
        detail: combineActionDetail(event.call_id ? `call ${event.call_id}` : "Call ID unavailable", argumentsDetail),
        ...evidence,
      };
      actions.push(action);
      if (event.call_id) {
        calls.set(event.call_id, action);
        observedCallIds.add(event.call_id);
      }
    } else if (event.type === "tool_call_finished") {
      if (event.call_id) observedCallIds.add(event.call_id);
      const existing = calls.get(event.call_id);
      const resultDetail = event.content_preview ? `result: ${event.content_preview}` : "Result preview unavailable";
      if (existing) {
        existing.result = event.is_error ? "failed" : "done";
        existing.state = event.is_error ? "error" : "done";
        existing.detail = combineActionDetail(event.call_id ? `call ${event.call_id}` : "Call ID unavailable", existing.argumentsDetail, resultDetail);
        existing.finishSequenceId = evidence.sequenceId;
      } else {
        actions.push({
          name: event.name || "tool",
          result: event.is_error ? "failed" : "done",
          state: event.is_error ? "error" : "done",
          callId: event.call_id || null,
          detail: combineActionDetail(event.call_id ? `call ${event.call_id}` : "Call ID unavailable", resultDetail),
          ...evidence,
        });
      }
    } else if (event.type === "assistant_message") {
      actions.push({ name: "response", result: "ready", state: "done", detail: combineActionDetail(event.content, event.usage ? usageDetail(event.usage) : ""), ...evidence });
    } else if (event.type === "error") {
      actions.push({ name: "error", result: "failed", state: "error", detail: compactActionDetail(event.message), ...evidence });
    } else if (event.type === "orchestrator_steering_queued"
        || event.type === "orchestrator_steering_delivered"
        || event.type === "orchestrator_steering_expired") {
      const result = event.type.split("_").at(-1);
      observedSteering.add(event.steering_id);
      actions.push({
        name: "steering",
        result,
        state: result === "queued" ? "live" : result === "expired" ? "error" : "done",
        steeringId: event.steering_id ?? null,
        detail: combineActionDetail(event.steering_id == null ? "Steering ID unavailable" : `steering #${event.steering_id}`, event.instruction_preview),
        ...evidence,
      });
    } else if (event.type === "run_started" || event.type === "run_finished") {
      actions.push({ name: "agent run", result: event.type === "run_started" ? "started" : "finished", state: event.type === "run_started" ? "live" : "done", detail: compactActionDetail(event.prompt_preview), ...evidence });
    } else {
      actions.push({ name: event.type || "event", result: "observed", state: "recorded", detail: serializedAgentEvent(event), ...evidence });
    }
  }

  const durableSteering = (snapshot?.thread_steering || [])
    .filter((record) => record.thread_name === ORCHESTRATOR_STEERING_TARGET && !observedSteering.has(record.id))
    .map(steeringRecordAction);
  const combined = [
    ...persisted.filter((action) => !action.callId || !observedCallIds.has(action.callId)),
    ...durableSteering,
    ...actions,
  ];
  return limit ? combined.slice(-ACTION_LEDGER_LIMIT) : combined;
}

function buildPersistedOrchestratorActions(messages, { limit = true } = {}) {
  const actions = [];
  const calls = new Map();
  for (const message of messages || []) {
    if (message.role === "assistant" && message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        const action = {
          name: call.function?.name || "tool",
          result: "called",
          state: "recorded",
          provenance: "persisted",
          kind: "tool_call",
          callId: call.id || null,
          argumentsDetail: "",
          detail: call.id ? `call ${call.id}` : "Call ID unavailable",
        };
        actions.push(action);
        if (call.id) calls.set(call.id, action);
      }
    } else if (message.role === "tool") {
      const existing = calls.get(message.tool_call_id);
      if (existing) {
        existing.result = "completed";
        existing.state = "done";
        existing.detail = message.tool_call_id ? `call ${message.tool_call_id}` : "Call ID unavailable";
      } else {
        actions.push({
          name: "tool result",
          result: "persisted",
          state: "recorded",
          provenance: "persisted",
          kind: "tool_result",
          callId: message.tool_call_id || null,
          detail: message.tool_call_id ? `call ${message.tool_call_id}` : "Call ID unavailable",
        });
      }
    } else if (message.role === "assistant" && message.content) {
      actions.push({ name: "response", result: "persisted", state: "done", provenance: "persisted", kind: "assistant_message", detail: compactActionDetail(message.content) });
    }
  }
  return limit ? actions.slice(-ACTION_LEDGER_LIMIT) : actions;
}

function sandboxStateForInfo(summary, snapshot) {
  const metadata = snapshot?.metadata;
  if (metadata && Object.prototype.hasOwnProperty.call(metadata, "sandbox_status")) {
    const status = metadata.sandbox_status;
    if (status !== null && status !== undefined && String(status) !== "") return String(status);
  }
  if (summary?.sandboxed === true) return "configured (runtime status unavailable)";
  if (summary?.sandboxed === false) return "off";
  return null;
}

function renderSessionInfo(summary = sessionEntry()?.summary, snapshot = currentSnapshot(), store = state.store) {
  summary = summary || sessionSummaryForSnapshot(snapshot);
  if (!summary && !snapshot) return '<div class="focus-info-scroll"><div class="focus-empty">Session identity is unavailable.</div></div>';
  const topology = sessionExecutionTopology(summary, snapshot);
  const sessionId = summary?.session_id ?? snapshot?.metadata?.session_id ?? state.currentId;
  const cwd = summary?.cwd ?? snapshot?.metadata?.cwd;
  const backend = snapshot?.metadata?.backend ?? summary?.backend;
  const model = snapshot?.metadata?.model ?? summary?.model;
  const storePath = store?.store_path ?? snapshot?.metadata?.store_path;
  const sshHost = topology.host || `Not applicable for ${topology.mode} execution`;
  return `<div class="focus-info-scroll"><section class="session-info" aria-label="Complete session identity">
    <p>Complete values for the selected session. Credential selectors, header values, and other secrets are not shown.</p>
    <dl class="session-info-grid">
      ${renderEvidenceField("Session ID", sessionId)}
      ${renderEvidenceField("Working directory", cwd)}
      ${renderEvidenceField("Execution topology", topology.detail)}
      ${renderEvidenceField("SSH host", sshHost)}
      ${renderEvidenceField("Sandbox state", sandboxStateForInfo(summary, snapshot))}
      ${renderEvidenceField("Backend", backend)}
      ${renderEvidenceField("Model", model)}
      ${renderEvidenceField("Store path", storePath, state.storeError ? "Store path unavailable" : undefined)}
    </dl>
  </section></div>`;
}

function openFocusView(type, name = null) {
  if (!state.focusView) state.focusOpener = captureFocusTarget(document.activeElement);
  const workspace = currentSnapshot()?.workspace;
  const path = type === "workspace" ? firstWorkspaceDiffPath(workspace) : null;
  if (type === "workspace") invalidateWorkspaceDiffs(state.currentId);
  if (state.focusView?.type === "settings" || type === "settings") {
    state.settingsRequestGeneration += 1;
  }
  state.focusView = { type, name, path };
  if (type === "orchestrator") {
    state.orchestratorViewport = { sessionId: state.currentId, pinnedToBottom: true, scrollTop: 0 };
  }
  if (type === "settings") {
    state.settingsFocus = {
      sessionId: state.currentId,
      requestGeneration: state.settingsRequestGeneration,
      status: "loading",
      config: null,
      error: null,
      message: "",
    };
  }
  if (type === "thread") {
    const thread = buildThreadModels().find((item) => item.name === name);
    state.targetedThread = thread && ["running", "queued"].includes(thread.state) ? name : null;
  } else state.targetedThread = null;
  renderThreads(currentSnapshot());
  renderFocusView(currentSnapshot());
  if (state.focusView?.type === type && state.focusView?.name === name) el.focusTitle?.focus?.({ preventScroll: true });
  if (type === "settings") loadFocusSettings();
  if (type === "thread") loadThreadEventPage(name, { reset: true });
}

function closeFocusView() {
  const fallback = state.focusView?.type === "thread"
    ? el.threadGrid.querySelector(`[data-focus-thread="${cssEscape(state.focusView.name)}"]`)
    : state.focusView?.type === "orchestrator" ? el.expandOrchestrator
      : state.focusView?.type === "worksets" ? el.expandWorksets
        : state.focusView?.type === "info" ? el.sessionInfo : el.promptInput;
  const openerTarget = state.focusOpener;
  const fallbackTarget = captureFocusTarget(fallback);
  if (state.focusView?.type === "settings") {
    state.settingsRequestGeneration += 1;
    state.settingsFocus = null;
  }
  state.focusView = null;
  state.focusOpener = null;
  state.orchestratorViewport = null;
  renderFocusView(currentSnapshot());
  requestAnimationFrame(() => {
    if (!restoreFocusTarget(openerTarget)) restoreFocusTarget(fallbackTarget);
  });
}

function renderFocusView(snapshot) {
  const view = state.focusView;
  const restoration = captureFocusViewState();
  const renderId = ++state.focusRenderId;
  el.sessionLayout.classList.toggle("is-focused", Boolean(view));
  el.focusPanel.classList.toggle("is-thread", view?.type === "thread");
  el.focusPanel.classList.toggle("is-orchestrator", view?.type === "orchestrator");
  el.focusPanel.classList.toggle("is-worksets", view?.type === "worksets");
  el.focusPanel.classList.toggle("is-workspace", view?.type === "workspace");
  el.focusPanel.classList.toggle("is-info", view?.type === "info");
  el.focusPanel.classList.toggle("is-settings", view?.type === "settings");
  el.focusPanel.hidden = !view;
  if (!view) {
    delete el.focusPanel.dataset.viewIdentity;
    delete el.focusState.dataset.state;
    el.focusContent.innerHTML = "";
    return;
  }

  const nextIdentity = focusViewIdentity(view);
  el.focusPanel.dataset.viewIdentity = nextIdentity;
  delete el.focusState.dataset.state;
  const prependAnchor = view.type === "orchestrator" && state.orchestratorPrependAnchor?.sessionId === state.currentId
    ? state.orchestratorPrependAnchor
    : null;
  if (prependAnchor) state.orchestratorPrependAnchor = null;

  if (view.type === "orchestrator") {
    const lifecycle = orchestratorLifecycle(snapshot);
    el.focusTitle.textContent = "Orchestrator";
    el.focusState.textContent = lifecycle.state;
    el.focusState.dataset.state = lifecycle.state;
    el.focusState.classList.toggle("is-active", lifecycle.state === "running");
    el.focusContent.innerHTML = renderOrchestratorConversation(snapshot);
  } else if (view.type === "thread") {
    const model = buildThreadModels(snapshot).find((thread) => thread.name === view.name);
    const status = threadStatusPresentation(model?.state);
    el.focusTitle.textContent = view.name || "Thread";
    el.focusState.textContent = status.label;
    el.focusState.dataset.state = status.state;
    el.focusState.classList.toggle("is-active", status.state === "running");
    el.focusContent.innerHTML = renderThreadFocus(view.name, model, snapshot);
    if (restoration.hadRenderedView && restoration.identity === nextIdentity) {
      for (const episode of el.focusContent.querySelectorAll(".focus-episode")) {
        const key = `${episode.dataset?.episodeId || ""}:${episode.dataset?.episodeIndex || ""}`;
        episode.open = restoration.openEpisodes.has(key);
      }
    }
  } else if (view.type === "worksets") {
    const presentation = worksetsPresentation(snapshot);
    el.focusTitle.textContent = "Worksets";
    el.focusState.textContent = presentation.state === "loading"
      ? "Loading"
      : presentation.state === "error" ? "Unavailable" : worksetCountLabel(presentation.items.length);
    el.focusState.classList.remove("is-active");
    el.focusContent.innerHTML = renderWorksetsFocus(snapshot);
  } else if (view.type === "workspace") {
    const workspace = snapshot?.workspace;
    const summary = workspaceSummaryPresentation(workspace);
    el.focusTitle.textContent = workspace?.repo_label || "Workspace";
    el.focusState.textContent = summary.state === "error"
      ? "Workspace error"
      : summary.state === "unavailable" ? "Not loaded" : workspace?.branch || "Working tree";
    el.focusState.dataset.state = summary.state;
    el.focusState.classList.remove("is-active");
    el.focusContent.innerHTML = renderWorkspaceFocus(workspace, view.path);
    if (view.path && workspaceFileCanFetchDiff(workspace, view.path)) loadFocusWorkspaceDiff(view.path);
  } else if (view.type === "info") {
    const summary = sessionSummaryForSnapshot(snapshot);
    const topology = sessionExecutionTopology(summary, snapshot);
    el.focusTitle.textContent = "Session info";
    el.focusState.textContent = topology.label;
    el.focusState.dataset.state = topology.mode;
    el.focusState.classList.remove("is-active");
    el.focusContent.innerHTML = renderSessionInfo(summary, snapshot);
  } else {
    el.focusTitle.textContent = "settings";
    el.focusState.textContent = "session configuration";
    el.focusState.classList.remove("is-active");
    el.focusContent.innerHTML = renderFocusSettings();
  }
  restoreFocusViewState(restoration, { renderId, prependAnchor });
  if (view.type === "orchestrator") {
    requestAnimationFrame(() => ensureOrchestratorScrollableHistory(renderId));
  }
}

function settingsContextIsCurrent(requestGeneration, sessionId) {
  return requestGeneration === state.settingsRequestGeneration
    && state.currentId === sessionId
    && state.focusView?.type === "settings"
    && state.settingsFocus?.sessionId === sessionId
    && state.settingsFocus?.requestGeneration === requestGeneration;
}

async function loadFocusSettings({
  requestGeneration = state.settingsRequestGeneration,
  message = "",
} = {}) {
  const sessionId = state.currentId;
  if (!sessionId || state.focusView?.type !== "settings") return null;
  if (requestGeneration !== state.settingsRequestGeneration) return null;
  state.settingsFocus = {
    sessionId,
    requestGeneration,
    status: "loading",
    config: null,
    error: null,
    message,
  };
  renderFocusView(currentSnapshot());
  try {
    const config = await apiGet(`/sessions/${encodeURIComponent(sessionId)}/config`);
    if (!settingsContextIsCurrent(requestGeneration, sessionId)) return null;
    state.settingsFocus = {
      sessionId,
      requestGeneration,
      status: "ready",
      config,
      error: null,
      message,
    };
    renderFocusView(currentSnapshot());
    return config;
  } catch (error) {
    if (!settingsContextIsCurrent(requestGeneration, sessionId)) return null;
    state.settingsFocus = {
      sessionId,
      requestGeneration,
      status: "error",
      config: null,
      error: error.message,
      message: "",
    };
    renderFocusView(currentSnapshot());
    return null;
  }
}

function rawHeadersFromConfig(config) {
  if (Object.prototype.hasOwnProperty.call(config || {}, "extra_headers_json")) {
    const raw = config.extra_headers_json;
    if (raw === null || raw === undefined || raw === "") {
      return { text: "", value: {}, invalid: false };
    }
    const text = String(raw);
    try {
      const value = JSON.parse(text);
      if (!value || Array.isArray(value) || typeof value !== "object"
          || Object.values(value).some((entry) => typeof entry !== "string")) {
        return { text, value: {}, invalid: true };
      }
      return { text: JSON.stringify(value, null, 2), value, invalid: false };
    } catch (_) {
      return { text, value: {}, invalid: true };
    }
  }
  const fallback = config?.extra_headers;
  const value = fallback && !Array.isArray(fallback) && typeof fallback === "object" ? fallback : {};
  return {
    text: Object.keys(value).length ? JSON.stringify(value, null, 2) : "",
    value,
    invalid: false,
  };
}

function parseCompactionThreshold(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const threshold = Number(raw);
  if (!Number.isSafeInteger(threshold) || threshold < 0) {
    throw new Error("Orchestrator compaction threshold must be a non-negative whole number");
  }
  return threshold === 0 ? null : threshold;
}

function settingsValuesFromConfig(config) {
  const headers = rawHeadersFromConfig(config);
  return {
    model: String(config?.model ?? ""),
    base_url: String(config?.base_url ?? ""),
    backend: config?.backend ?? null,
    reasoning_effort: config?.reasoning_effort ?? null,
    api_key_env: config?.api_key_env ?? null,
    orchestrator_compaction_threshold: config?.orchestrator_compaction_threshold ?? null,
    extra_headers: headers.value,
    extra_headers_text: headers.text,
    extra_headers_invalid: headers.invalid,
  };
}

function requiredSettingsString(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required and cannot be blank`);
  return normalized;
}

function serializeSettingsHeaders(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return {};
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_) { throw new Error("Extra headers must be valid JSON"); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Extra headers must be a JSON object with string values");
  }
  for (const [key, headerValue] of Object.entries(parsed)) {
    if (typeof headerValue !== "string") {
      throw new Error(`Extra header value for "${key}" must be a string`);
    }
  }
  return parsed;
}

function sameHeaderObject(left, right) {
  const leftKeys = Object.keys(left || {}).sort();
  const rightKeys = Object.keys(right || {}).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function buildSettingsPatch(values, initial) {
  const changedRequiredString = (value, initialValue, label) => {
    const raw = String(value ?? "");
    if (raw === String(initialValue ?? "")) return initialValue;
    return requiredSettingsString(raw, label);
  };
  const changedBackend = (value, initialValue) => {
    const raw = String(value ?? "");
    if ((initialValue === null || initialValue === undefined) && !raw) return initialValue ?? null;
    return changedRequiredString(raw, initialValue, "Backend");
  };
  const effortControl = String(values.reasoning_effort ?? "");
  let reasoningEffort;
  if (effortControl === "__unset__") reasoningEffort = null;
  else if (initial.reasoning_effort !== null
      && initial.reasoning_effort !== undefined
      && effortControl === String(initial.reasoning_effort)) {
    reasoningEffort = initial.reasoning_effort;
  } else reasoningEffort = requiredSettingsString(effortControl, "Reasoning effort");

  const current = {
    model: changedRequiredString(values.model, initial.model, "Model"),
    base_url: changedRequiredString(values.base_url, initial.base_url, "Base URL"),
    backend: changedBackend(values.backend, initial.backend),
    reasoning_effort: reasoningEffort,
  };
  const rawApiKeyEnv = String(values.api_key_env ?? "");
  const initialApiKeyText = String(initial.api_key_env ?? "");
  current.api_key_env = rawApiKeyEnv === initialApiKeyText
    ? initial.api_key_env
    : (rawApiKeyEnv.trim() || null);

  const rawCompactionThreshold = String(values.orchestrator_compaction_threshold ?? "").trim();
  current.orchestrator_compaction_threshold = rawCompactionThreshold
    ? parseCompactionThreshold(rawCompactionThreshold)
    : null;

  const patch = {};
  for (const field of ["model", "base_url", "backend", "reasoning_effort", "api_key_env", "orchestrator_compaction_threshold"]) {
    if (current[field] !== initial[field]) patch[field] = current[field];
  }

  const headerText = String(values.extra_headers ?? "");
  const normalizedHeaderText = (value) => String(value ?? "").replace(/\r\n?/g, "\n");
  const unchangedInvalidHeaders = initial.extra_headers_invalid
    && normalizedHeaderText(headerText) === normalizedHeaderText(initial.extra_headers_text);
  if (!unchangedInvalidHeaders) {
    const headers = serializeSettingsHeaders(headerText);
    if (initial.extra_headers_invalid || !sameHeaderObject(headers, initial.extra_headers || {})) {
      patch.extra_headers = headers;
    }
  }
  return patch;
}

function renderFocusSettings() {
  const settings = state.settingsFocus;
  if (!settings || settings.sessionId !== state.currentId || settings.status === "loading") {
    const message = settings?.message || "loading configuration…";
    return `<div class="focus-settings-layout"><div class="focus-empty">${escapeHtml(message)}</div></div>`;
  }
  if (settings.status === "error") {
    const repairError = sessionEntry()?.summary?.model_config_error;
    return `<div class="focus-settings-layout"><section class="settings-load-error" role="alert"><strong>Configuration could not be loaded.</strong><p>${escapeHtml(settings.error)}</p>${repairError ? `<p>Repair required: ${escapeHtml(repairError)}</p>` : ""}<button class="button" type="button" data-retry-settings>retry configuration load</button></section></div>`;
  }
  const config = settings.config || {};
  const headers = rawHeadersFromConfig(config);
  const diagnostics = Array.isArray(config.diagnostics) ? config.diagnostics : [];
  const diagnosticHtml = diagnostics.length
    ? `<section class="settings-diagnostics" role="alert"><strong>Repair required</strong><p>Replace every unsupported or malformed value, then save.</p><ul>${diagnostics.map((diagnostic) => `<li>${escapeHtml(diagnostic)}</li>`).join("")}</ul></section>`
    : "";
  const submission = state.settingsSubmission;
  const savingThisSession = submission?.sessionId === state.currentId;
  const saveBlocked = Boolean(submission);
  const saveStatus = savingThisSession
    ? "Saving…"
    : saveBlocked ? "Waiting for another settings save to finish…" : (settings.message || "");
  return `<div class="focus-settings-layout"><form id="settingsForm" class="settings-form focus-settings-form"${saveBlocked ? ' inert aria-busy="true"' : ""}>
    ${diagnosticHtml}
    <label class="field"><span>backend</span><select name="backend">${backendOptions(config.backend)}</select></label>
    <label class="field"><span>reasoning</span><select name="reasoning_effort">${effortOptions(config.reasoning_effort)}</select><small>Unset uses the backend default; none and minimal are explicit values.</small></label>
    <label class="field"><span>model</span><input name="model" value="${escapeAttr(config.model ?? "")}"></label>
    <label class="field"><span>base url</span><input name="base_url" value="${escapeAttr(config.base_url ?? "")}"></label>
    <label class="field span-two"><span>api key environment variable</span><input name="api_key_env" value="${escapeAttr(config.api_key_env ?? "")}"><small>Enter the environment-variable name only, never a key value. Blank removes the session-specific selector.</small></label>
    <label class="field span-two"><span>orchestrator compaction threshold (tokens)</span><input name="orchestrator_compaction_threshold" type="number" min="0" max="9007199254740991" step="1" value="${escapeAttr(config.orchestrator_compaction_threshold ?? "")}" placeholder="disabled"><small>Blank or 0 disables the persisted session threshold; enter a positive whole-token count to enable it.</small></label>
    <label class="field span-two"><span>extra headers (JSON object)</span><textarea name="extra_headers" rows="6" spellcheck="false" placeholder="{}">${escapeHtml(headers.text)}</textarea><small>Blank or <code>{}</code> removes all extra headers. Existing headers are unchanged unless this field is edited.</small></label>
    <div class="settings-actions"><span id="settingsStatus" class="form-status" role="status" aria-live="polite">${escapeHtml(saveStatus)}</span><button class="button button-primary" data-settings-submit type="submit"${saveBlocked ? " disabled" : ""}>save settings</button></div>
  </form></div>`;
}

function sessionSummaryForSnapshot(snapshot) {
  const sessionId = snapshot?.metadata?.session_id || state.currentId;
  return sessionEntry(sessionId)?.summary
    || (snapshot?.sessions || []).find((summary) => summary.session_id === sessionId)
    || null;
}

function evidenceValue(value, unavailable = "Unavailable in current evidence") {
  const available = value !== null && value !== undefined && String(value) !== "";
  return available ? escapeHtml(value) : `<span class="evidence-unavailable">${escapeHtml(unavailable)}</span>`;
}

function renderEvidenceField(label, value, unavailable) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${evidenceValue(value, unavailable)}</dd></div>`;
}

function renderOrchestratorConversation(snapshot) {
  const messages = snapshot?.messages || [];
  const pending = effectivePendingMessages(state.currentId, snapshot);
  const durations = responseDurationAssignments(snapshot, messages);
  const ordinalBase = Number.isSafeInteger(Number(snapshot?.message_page?.start))
    ? Number(snapshot.message_page.start)
    : 0;
  const transcriptEntries = [
    ...messages.map((message, index) => ({
      message,
      ordinal: ordinalBase + index + 1,
      durationMs: durations.get(index) ?? null,
    })),
    ...pending.map((message) => ({ message, ordinal: null, durationMs: null })),
  ].filter(({ message }) => message?.role !== "system" && message?.role !== "tool");
  const transcript = transcriptEntries.map(({ message, ordinal, durationMs }) => renderFocusMessage(message, {
    ordinal,
    durationMs,
  })).join("");
  const messageWindow = state.messageWindows.get(state.currentId);
  const historyLoader = messageWindow?.hasOlder
    ? `<div class="focus-history-loader ${messageWindow.loading ? "is-loading" : ""}" data-history-loader role="status"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"></path></svg><span>${messageWindow.loading ? "loading earlier messages" : "scroll up for earlier messages"}</span></div>`
    : "";
  const lifecycle = orchestratorLifecycle(snapshot);
  const actions = buildOrchestratorActions(snapshot, { limit: false }).reverse();
  const live = `<section class="focus-live"><div class="focus-column-heading"><span>Live activity</span><strong>${actions.length} persisted + observed</strong></div>${renderFocusActions(actions, { showTechnicalEvidence: true })}</section>`;
  return `<div class="focus-orchestrator-layout" data-state="${escapeAttr(lifecycle.state)}"><div class="focus-orchestrator-sidebar">${live}</div><section class="focus-chat"><div class="focus-conversation">${historyLoader}${transcript || `<div class="focus-empty">No conversation messages.</div>`}</div></section></div>`;
}

function worksetValueHtml(value, emptyLabel = "Not recorded") {
  const text = value === null || value === undefined ? "" : String(value);
  return text ? escapeHtml(text) : `<span class="workset-value-empty">${escapeHtml(emptyLabel)}</span>`;
}

function renderWorksetField(label, value, { emptyLabel = "Not recorded", wide = false } = {}) {
  return `<div class="workset-field${wide ? " is-wide" : ""}"><dt>${escapeHtml(label)}</dt><dd>${worksetValueHtml(value, emptyLabel)}</dd></div>`;
}

function renderWorksetDependencies(value) {
  if (!Array.isArray(value)) return worksetValueHtml(value, "None recorded");
  if (!value.length) return `<span class="workset-value-empty">None</span>`;
  return `<ul class="workset-dependencies">${value.map((dependency) => `<li>${escapeHtml(dependency)}</li>`).join("")}</ul>`;
}

function renderWorksetItem(item) {
  const position = item?.position;
  const positionText = position === null || position === undefined || String(position) === ""
    ? "Position not recorded"
    : `Item ${String(position)}`;
  return `<article class="workset-item-detail" data-position="${escapeAttr(position ?? "")}">
    <header><span>${escapeHtml(positionText)}</span><strong>${worksetValueHtml(item?.title)}</strong></header>
    <dl class="workset-fields workset-item-fields">
      ${renderWorksetField("Position", position)}
      ${renderWorksetField("Title", item?.title)}
      ${renderWorksetField("Role", item?.role)}
      ${renderWorksetField("Scope", item?.scope)}
      ${renderWorksetField("Description", item?.description, { wide: true })}
      <div class="workset-field is-wide"><dt>Dependencies</dt><dd>${renderWorksetDependencies(item?.depends_on)}</dd></div>
      ${renderWorksetField("Acceptance", item?.acceptance, { wide: true })}
      ${renderWorksetField("Notes", item?.notes, { emptyLabel: "None", wide: true })}
      ${renderWorksetField("Updated", item?.updated_at, { wide: true })}
    </dl>
  </article>`;
}

function renderWorksetDetail(workset) {
  const items = Array.isArray(workset?.items) ? workset.items : null;
  const itemState = items === null ? "error" : items.length ? "populated" : "empty-workset";
  const itemContent = items === null
    ? `<div class="workset-items-state is-error" role="alert">Items are unavailable for this workset.</div>`
    : items.length
      ? `<div class="workset-item-list">${items.map(renderWorksetItem).join("")}</div>`
      : `<div class="workset-items-state">This workset has no items.</div>`;
  return `<article class="workset-detail" data-state="${itemState}" data-status="${escapeAttr(workset?.status ?? "")}">
    <header class="workset-detail-header"><div><span>Workset</span><h3>${worksetValueHtml(workset?.id)}</h3></div><div><strong>${escapeHtml(worksetStatusText(workset))}</strong><span>${escapeHtml(worksetItemCountLabel(items))}</span></div></header>
    <dl class="workset-fields workset-metadata">
      ${renderWorksetField("ID", workset?.id)}
      ${renderWorksetField("Status", workset?.status)}
      ${renderWorksetField("Session", workset?.session_id)}
      ${renderWorksetField("Created", workset?.created_at)}
      ${renderWorksetField("Updated", workset?.updated_at)}
      ${renderWorksetField("Summary", workset?.summary, { wide: true })}
      ${renderWorksetField("Goal", workset?.goal, { wide: true })}
      ${renderWorksetField("Verification recipe", workset?.verification_recipe, { emptyLabel: "None", wide: true })}
    </dl>
    <section class="workset-items-section" data-state="${itemState}" aria-label="Items for ${escapeAttr(workset?.id ?? "workset")}">
      <h4>Items <span>${escapeHtml(worksetItemCountLabel(items))}</span></h4>${itemContent}
    </section>
  </article>`;
}

function renderWorksetsFocus(snapshot) {
  const presentation = worksetsPresentation(snapshot);
  if (presentation.state === "loading") {
    return `<div class="focus-worksets-scroll" data-state="loading"><div class="worksets-focus-state" role="status"><strong>Loading worksets…</strong><p>Waiting for the session snapshot.</p></div></div>`;
  }
  if (presentation.state === "error") {
    return `<div class="focus-worksets-scroll" data-state="error"><div class="worksets-focus-state is-error" role="alert"><strong>Worksets could not be loaded.</strong><p>${escapeHtml(presentation.error)}</p></div></div>`;
  }
  if (presentation.state === "empty") {
    return `<div class="focus-worksets-scroll" data-state="empty"><div class="worksets-focus-state"><strong>No worksets yet.</strong><p>This session has no persisted worksets.</p></div></div>`;
  }
  return `<div class="focus-worksets-scroll" data-state="populated"><div class="worksets-focus-list">${presentation.items.map(renderWorksetDetail).join("")}</div></div>`;
}

function workspaceFileDiffUnavailableReason(file) {
  const status = String(file?.status || "").trim().toUpperCase();
  if (status === "R" || status === "RENAME" || status === "RENAMED" || /^R\d+$/.test(status)) {
    return "Renamed-path diffs are not available in this workspace view.";
  }
  if (status === "C" || status === "COPY" || status === "COPIED" || /^C\d+$/.test(status)) {
    return "Copied-path diffs are not available in this workspace view.";
  }
  return null;
}

function workspaceFileForPath(workspace, path) {
  return (workspace?.changed_files || []).find((file) => file?.path === path) || null;
}

function workspaceFileCanFetchDiff(workspace, path) {
  const file = workspaceFileForPath(workspace, path);
  return Boolean(file && !workspaceFileDiffUnavailableReason(file));
}

function firstWorkspaceDiffPath(workspace) {
  return (workspace?.changed_files || []).find((file) => file?.path && !workspaceFileDiffUnavailableReason(file))?.path || null;
}

function workspaceDiffKey(sessionId, path) {
  return `${sessionId}:${path}`;
}

function invalidateWorkspaceDiffs(sessionId, path = null) {
  if (!sessionId) return 0;
  if (path !== null && path !== undefined) {
    return state.workspaceDiffs.delete(workspaceDiffKey(sessionId, path)) ? 1 : 0;
  }
  const prefix = `${sessionId}:`;
  let invalidated = 0;
  for (const key of state.workspaceDiffs.keys()) {
    if (!key.startsWith(prefix)) continue;
    state.workspaceDiffs.delete(key);
    invalidated += 1;
  }
  return invalidated;
}

function renderWorkspaceFile(file, selectedPath) {
  const path = file?.path ?? "";
  const status = file?.status || "M";
  const unsupportedReason = workspaceFileDiffUnavailableReason(file);
  const selected = path === selectedPath && !unsupportedReason;
  const delta = `+${file?.additions ?? "—"} −${file?.deletions ?? "—"}`;
  const support = unsupportedReason
    ? `<small class="focus-file-support">${escapeHtml(unsupportedReason)}</small>`
    : "";
  const label = `${status} ${path}, ${delta}${unsupportedReason ? `. ${unsupportedReason}` : ""}`;
  return `<button class="focus-file${selected ? " is-selected" : ""}${unsupportedReason ? " is-unsupported" : ""}" type="button" data-focus-workspace-file="${escapeAttr(path)}" data-diff-supported="${unsupportedReason ? "false" : "true"}" aria-label="${escapeAttr(label)}"${selected ? ` aria-current="true"` : ""}${unsupportedReason ? ` aria-disabled="true" disabled title="${escapeAttr(unsupportedReason)}"` : ""}>
    <span class="focus-file-status" aria-hidden="true">${escapeHtml(status)}</span>
    <span class="focus-file-identity"><strong>${escapeHtml(path)}</strong>${support}</span>
    <em>${escapeHtml(delta)}</em>
  </button>`;
}

function renderWorkspaceFocus(workspace, selectedPath) {
  if (!workspace || workspace.error) return `<div class="focus-empty focus-workspace-error" role="alert">${escapeHtml(workspace?.error || "Workspace data is unavailable.")}</div>`;
  const files = workspace.changed_files || [];
  const selectedFile = selectedPath ? workspaceFileForPath(workspace, selectedPath) : null;
  const unsupportedReason = workspaceFileDiffUnavailableReason(selectedFile);
  const key = selectedPath && !unsupportedReason ? workspaceDiffKey(state.currentId, selectedPath) : null;
  const cached = key ? state.workspaceDiffs.get(key) : null;
  const detail = selectedPath && unsupportedReason
    ? `<div class="focus-diff-unavailable" role="note"><strong>Inline diff unavailable</strong><p>${escapeHtml(unsupportedReason)}</p><p>The changed-file entry remains visible, but it is disabled and no diff request will be made.</p></div>`
    : selectedPath && selectedFile
      ? renderWorkspaceFocusDiff(selectedPath, cached)
      : `<div class="focus-empty">${files.length ? "Select a changed file with inline diff support." : "Working tree clean."}</div>`;
  const repoLabel = workspace.repo_label
    ? escapeHtml(workspace.repo_label)
    : `<span class="evidence-unavailable">Repository label unavailable</span>`;
  const branch = workspace.branch
    ? escapeHtml(workspace.branch)
    : `<span class="evidence-unavailable">Detached or unavailable branch</span>`;
  const workspaceDisplay = workspace.workspace_display
    ? `<small>${escapeHtml(workspace.workspace_display)}</small>`
    : "";
  return `<div class="focus-workspace-layout"><aside class="focus-files" aria-label="Changed files">
    <div class="focus-repository-context" aria-label="Workspace repository context"><span>Repository</span><strong>${repoLabel}</strong><div>${branch}</div>${workspaceDisplay}</div>
    <div class="focus-column-heading"><span>Changed files</span><strong>${files.length}</strong></div>
    <div class="focus-workspace-totals" aria-label="Workspace totals: ${escapeAttr(workspace.total_additions || 0)} additions and ${escapeAttr(workspace.total_deletions || 0)} deletions"><span>+${escapeHtml(workspace.total_additions || 0)}</span><span>−${escapeHtml(workspace.total_deletions || 0)}</span></div>
    <div class="focus-file-list">${files.map((file) => renderWorkspaceFile(file, selectedPath)).join("")}</div>
  </aside><section class="focus-diff" aria-label="File diff"><div class="focus-column-heading"><span>${selectedPath ? escapeHtml(selectedPath) : "Diff"}</span></div>${detail}</section></div>`;
}

function workspaceDiffLinePresentation(line) {
  const kind = String(line?.kind || "").toLowerCase();
  if (["addition", "insert", "add"].includes(kind)) return { className: "add", marker: "+", markerHtml: "+", label: "Addition" };
  if (["deletion", "delete", "remove"].includes(kind)) return { className: "remove", marker: "−", markerHtml: "−", label: "Deletion" };
  if (kind === "context") return { className: "context", marker: " ", markerHtml: "&nbsp;", label: "Context" };
  return { className: "unknown", marker: "?", markerHtml: "?", label: kind ? `${kind} line` : "Unknown line kind" };
}

function renderDiffLineNumber(value, side) {
  if (value !== null && value !== undefined) return escapeHtml(value);
  return `<span aria-hidden="true">—</span><span class="sr-only">No ${escapeHtml(side)} line number</span>`;
}

function renderDiffLine(line) {
  const presentation = workspaceDiffLinePresentation(line);
  const noNewline = line?.has_trailing_newline === false
    ? `<span class="diff-no-newline" role="note">\\ No newline at end of file</span>`
    : "";
  return `<tr class="diff-line ${presentation.className}" data-line-kind="${escapeAttr(presentation.label.toLowerCase())}">
    <td class="diff-line-number">${renderDiffLineNumber(line?.old_lineno, "old")}</td>
    <td class="diff-line-number">${renderDiffLineNumber(line?.new_lineno, "new")}</td>
    <td class="diff-line-marker"><span aria-label="${escapeAttr(presentation.label)}" data-marker="${escapeAttr(presentation.marker)}"><span aria-hidden="true">${presentation.markerHtml}</span></span></td>
    <td class="diff-line-content"><code>${escapeHtml(line?.content ?? "")}</code>${noNewline}</td>
  </tr>`;
}

function workspaceDiffHunkRange(hunk) {
  return `@@ -${hunk?.old_start ?? "?"},${hunk?.old_lines ?? "?"} +${hunk?.new_start ?? "?"},${hunk?.new_lines ?? "?"} @@`;
}

function renderWorkspaceDiffHunk(hunk, hunkIndex, hunkCount, section) {
  const range = workspaceDiffHunkRange(hunk);
  const functionContext = hunk?.function_context !== null && hunk?.function_context !== undefined
    ? `<span class="diff-function-context">${escapeHtml(hunk.function_context)}</span>`
    : "";
  const lines = Array.isArray(hunk?.lines) ? hunk.lines : [];
  const body = lines.length
    ? lines.map(renderDiffLine).join("")
    : `<tr class="diff-hunk-empty"><td colspan="4">No lines were returned for this hunk.</td></tr>`;
  const stage = section?.stage ?? "stage unavailable";
  const status = section?.status ?? "status unavailable";
  return `<section class="diff-hunk" aria-label="${escapeAttr(`${stage} ${status}, hunk ${hunkIndex + 1} of ${hunkCount}`)}"><table class="diff-table">
    <caption><span>${escapeHtml(stage)} · ${escapeHtml(status)} · Hunk ${hunkIndex + 1} of ${hunkCount}</span><code>${escapeHtml(range)}</code>${functionContext}</caption>
    <thead><tr><th scope="col">Old</th><th scope="col">New</th><th scope="col">Mark</th><th scope="col">Content</th></tr></thead>
    <tbody>${body}</tbody>
  </table></section>`;
}

function renderWorkspaceDiffWarnings(section) {
  const warnings = [];
  if (section?.error) warnings.push(`<li class="is-error" role="alert"><strong>Section error</strong><span>${escapeHtml(section.error)}</span></li>`);
  if (section?.binary) warnings.push(`<li><strong>Binary content</strong><span>Binary content cannot be shown inline.</span></li>`);
  if (section?.too_large) warnings.push(`<li><strong>Too large</strong><span>File content exceeds the inline diff size limit.</span></li>`);
  if (section?.truncated) warnings.push(`<li><strong>Truncated diff</strong><span>Some hunks, lines, or line content were omitted by the server limit.</span></li>`);
  return warnings.length ? `<ul class="diff-section-warnings">${warnings.join("")}</ul>` : "";
}

function renderWorkspaceDiffSection(section, sectionIndex, sectionCount) {
  const stage = section?.stage ?? "stage unavailable";
  const status = section?.status ?? "status unavailable";
  const additions = section?.additions ?? 0;
  const deletions = section?.deletions ?? 0;
  const hunks = Array.isArray(section?.hunks) ? section.hunks : [];
  const warnings = renderWorkspaceDiffWarnings(section);
  const content = hunks.length
    ? hunks.map((hunk, hunkIndex) => renderWorkspaceDiffHunk(hunk, hunkIndex, hunks.length, section)).join("")
    : warnings ? "" : `<p class="diff-section-empty">This section has no inline hunks.</p>`;
  return `<section class="diff-section" aria-labelledby="diffSection${sectionIndex}">
    <header class="diff-section-header"><div><span>Section ${sectionIndex + 1} of ${sectionCount}</span><h3 id="diffSection${sectionIndex}">${escapeHtml(stage)} · ${escapeHtml(status)}</h3></div><div class="diff-section-totals" aria-label="${escapeAttr(additions)} additions and ${escapeAttr(deletions)} deletions"><span>+${escapeHtml(additions)}</span><span>−${escapeHtml(deletions)}</span></div></header>
    ${warnings}${content}
  </section>`;
}

function renderWorkspaceDiffRetry(path) {
  return `<div><button class="button mini-button" type="button" data-retry-workspace-diff="${escapeAttr(path)}" aria-label="Retry diff for ${escapeAttr(path)}">Retry diff</button></div>`;
}

function renderWorkspaceFocusDiff(path, cached) {
  if (!cached || cached.status === "loading") return `<div class="focus-empty" role="status">Loading ${escapeHtml(path)}…</div>`;
  if (cached.status === "error") {
    return `<div class="focus-empty focus-diff-error" role="alert"><strong>Diff request failed</strong><span>${escapeHtml(cached.message || "Diff request failed.")}</span>${renderWorkspaceDiffRetry(path)}</div>`;
  }
  const diff = cached.diff || {};
  const sections = Array.isArray(diff.sections) ? diff.sections : [];
  const additions = sections.reduce((total, section) => total + (Number(section?.additions) || 0), 0);
  const deletions = sections.reduce((total, section) => total + (Number(section?.deletions) || 0), 0);
  const rootError = diff.error
    ? `<div class="focus-diff-error" role="alert"><strong>Diff unavailable</strong><span>${escapeHtml(diff.error)}</span>${renderWorkspaceDiffRetry(path)}</div>`
    : "";
  const content = sections.length
    ? sections.map((section, index) => renderWorkspaceDiffSection(section, index, sections.length)).join("")
    : rootError ? "" : `<div class="focus-empty">No diff sections were returned for this file.</div>`;
  return `<article class="focus-diff-view" data-section-count="${sections.length}">
    <header class="focus-diff-summary"><div><span>File</span><strong>${escapeHtml(diff.path || path)}</strong></div><dl><div><dt>Sections</dt><dd>${sections.length}</dd></div><div><dt>Additions</dt><dd>+${escapeHtml(additions)}</dd></div><div><dt>Deletions</dt><dd>−${escapeHtml(deletions)}</dd></div></dl></header>
    ${rootError}${content}
  </article>`;
}

function handleFocusClick(event) {
  const retrySettings = event.target.closest("[data-retry-settings]");
  if (retrySettings && state.focusView?.type === "settings") {
    loadFocusSettings();
    return;
  }
  const retryWorkspaceDiff = event.target.closest("[data-retry-workspace-diff]");
  if (retryWorkspaceDiff && state.focusView?.type === "workspace") {
    const path = retryWorkspaceDiff.dataset.retryWorkspaceDiff;
    if (path && state.focusView.path === path) return loadFocusWorkspaceDiff(path, { force: true });
    return false;
  }
  const file = event.target.closest("[data-focus-workspace-file]");
  if (!file || state.focusView?.type !== "workspace") return;
  const workspace = currentSnapshot()?.workspace;
  if (!workspaceFileCanFetchDiff(workspace, file.dataset.focusWorkspaceFile)) return;
  state.focusView.path = file.dataset.focusWorkspaceFile;
  renderFocusView(currentSnapshot());
}

async function loadFocusWorkspaceDiff(path, { force = false } = {}) {
  const sessionId = state.currentId;
  const workspace = currentSnapshot()?.workspace;
  if (!sessionId || state.focusView?.type !== "workspace" || state.focusView.path !== path) return false;
  if (!workspaceFileCanFetchDiff(workspace, path)) return false;
  const key = workspaceDiffKey(sessionId, path);
  if (state.workspaceDiffs.has(key) && !force) return false;
  const requestToken = {};
  state.workspaceDiffs.set(key, { status: "loading", requestToken });
  if (state.currentId === sessionId && state.focusView?.type === "workspace" && state.focusView.path === path) {
    renderFocusView(currentSnapshot());
  }
  try {
    const diff = await apiGet(`/sessions/${encodeURIComponent(sessionId)}/workspace/diff?path=${encodeURIComponent(path)}&stage=all&context=3`);
    if (state.workspaceDiffs.get(key)?.requestToken !== requestToken) return true;
    state.workspaceDiffs.set(key, { status: "ready", diff });
  } catch (error) {
    if (state.workspaceDiffs.get(key)?.requestToken !== requestToken) return true;
    state.workspaceDiffs.set(key, { status: "error", message: error.message });
  }
  if (state.currentId === sessionId && state.focusView?.type === "workspace" && state.focusView.path === path) {
    renderFocusView(currentSnapshot());
  }
  return true;
}

function focusMessageRoleLabel(role) {
  if (role === "system") return "System";
  if (role === "user") return "You";
  if (role === "assistant") return "Orchestrator";
  return role || "Message";
}

function focusToolArguments(call) {
  const raw = call?.function?.arguments;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function focusToolTarget(argumentsValue, ...keys) {
  for (const key of keys) {
    const value = argumentsValue?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function orchestratorToolSummaries(toolCalls) {
  const calls = toolCalls || [];
  const dispatched = calls
    .filter((call) => call?.function?.name === "thread")
    .map((call) => focusToolTarget(focusToolArguments(call), "name"))
    .filter(Boolean);
  const summaries = [];
  let emittedDispatches = false;
  for (const call of calls) {
    const name = call?.function?.name || "tool";
    const argumentsValue = focusToolArguments(call);
    if (name === "thread") {
      if (!emittedDispatches) {
        summaries.push({ operation: "threads dispatched", target: dispatched.join(", ") });
        emittedDispatches = true;
      }
      continue;
    }
    if (name.startsWith("workset_")) {
      summaries.push({ operation: name, target: focusToolTarget(argumentsValue, "id", "name") });
      continue;
    }
    if (name === "threads") {
      summaries.push({ operation: "threads listed", target: "" });
      continue;
    }
    summaries.push({ operation: name, target: focusToolTarget(argumentsValue, "name", "id") });
  }
  return summaries;
}

function renderOrchestratorToolTurn(message, { ordinal = null } = {}) {
  const summaries = orchestratorToolSummaries(message?.tool_calls);
  const body = summaries.map(({ operation, target }) => `<div class="focus-tool-summary"><span>${escapeHtml(operation)}</span>${target ? `<strong>${escapeHtml(target)}</strong>` : ""}</div>`).join("");
  const ordinalLabel = ordinal === null
    ? ""
    : `<span class="focus-message-ordinal" title="Transcript ordinal among messages included by this query; not a durable message ID">#${escapeHtml(ordinal)}</span>`;
  const meta = ordinalLabel ? `<div class="focus-message-meta">${ordinalLabel}</div>` : "";
  return `<article class="focus-message is-tool-turn" data-role="assistant"><div class="focus-message-label"><span class="focus-message-role">Orchestrator</span>${meta}</div><div class="focus-message-body"><div class="focus-tool-summaries">${body}</div></div></article>`;
}

function renderFocusMessage(message, { ordinal = null, durationMs = null } = {}) {
  if (message?.role === "system" || message?.role === "tool") return "";
  const role = message?.role || "message";
  if (role === "assistant" && message?.tool_calls?.length) {
    return renderOrchestratorToolTurn(message, { ordinal });
  }
  const label = focusMessageRoleLabel(role);
  const content = message?.content !== null && message?.content !== undefined
    ? String(message.content)
    : "";
  const reasoning = role === "assistant"
    && message?.reasoning_text !== null
    && message?.reasoning_text !== undefined
    ? String(message.reasoning_text)
    : "";
  const reasoningBlock = reasoning
    ? `<div class="focus-message-copy is-reasoning"><span class="focus-message-content-kind">reasoning</span>${renderFocusMarkdown(reasoning)}</div>`
    : "";
  const copy = content
    ? `<div class="focus-message-copy">${renderFocusMarkdown(content)}</div>`
    : "";
  const body = reasoningBlock || copy
    ? `${reasoningBlock}${copy}`
    : `<div class="focus-message-copy is-empty"><span class="focus-message-content-kind">empty message</span>${renderFocusMarkdown("[empty]")}</div>`;
  const ordinalLabel = message?.pending
    ? `<span class="focus-message-ordinal is-submitted" title="Pending user message from ${escapeAttr(message.pendingSource || "submission")}; removed when its canonical transcript row arrives">submitted · pending</span>`
    : ordinal === null ? "" : `<span class="focus-message-ordinal" title="Transcript ordinal among messages included by this query; not a durable message ID">#${escapeHtml(ordinal)}</span>`;
  const duration = durationMs !== null && durationMs !== undefined && Number.isFinite(Number(durationMs))
    ? `<span class="focus-message-duration" title="Response duration: ${escapeAttr(Number(durationMs).toLocaleString())} ms">response ${escapeHtml(formatDuration(Number(durationMs)))}</span>`
    : "";
  const meta = ordinalLabel || duration
    ? `<div class="focus-message-meta">${ordinalLabel}${duration}</div>`
    : "";
  return `<article class="focus-message${message?.pending ? " is-pending" : ""}" data-role="${escapeAttr(role)}"${message?.pending ? ` data-pending-source="${escapeAttr(message.pendingSource || "submitted")}"` : ""}><div class="focus-message-label"><span class="focus-message-role">${escapeHtml(label)}</span>${meta}</div><div class="focus-message-body">${body}</div></article>`;
}

function serializedAgentEvent(event, maxChars = 1200) {
  let serialized;
  try { serialized = JSON.stringify(event ?? {}); }
  catch (_) { serialized = String(event ?? ""); }
  return compactActionDetail(serialized, maxChars);
}

function threadEntrySequence(entry) {
  if (entry?.sequenceId === null || entry?.sequenceId === undefined || entry?.sequenceId === "") return null;
  const sequenceId = Number(entry.sequenceId);
  return Number.isSafeInteger(sequenceId) ? sequenceId : null;
}

function normalizedEventBoundary(value) {
  const epochId = String(value?.epoch_id || "");
  const sequenceId = Number(value?.sequence_id);
  return epochId && Number.isSafeInteger(sequenceId) && sequenceId >= 0 ? { epochId, sequenceId } : null;
}

function mergeThreadEvidence(persistedEntries, observedEntries, boundaryValue) {
  const boundary = normalizedEventBoundary(boundaryValue);
  if (!boundary) return [...(persistedEntries || [])];
  const observed = (observedEntries || [])
    .filter((entry) => entry.epochId === boundary.epochId
      && threadEntrySequence(entry) !== null
      && threadEntrySequence(entry) > boundary.sequenceId)
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => threadEntrySequence(left.entry) - threadEntrySequence(right.entry) || left.index - right.index)
    .map(({ entry }) => entry);
  return [...(persistedEntries || []), ...observed];
}

function observedThreadEntries(name, envelopes = state.events.get(state.currentId) || []) {
  return envelopes
    .filter((envelope) => eventThreadName(agentEvent(envelope)) === name)
    .map((envelope) => ({
      event: agentEvent(envelope),
      provenance: "observed",
      epochId: String(envelope.epoch_id || ""),
      sequenceId: Number.isSafeInteger(Number(envelope.sequence_id)) ? Number(envelope.sequence_id) : null,
      eventId: null,
      timestamp: null,
    }));
}

function threadFocusEvidenceEntries(name, snapshot, windowState) {
  const persisted = windowState
    ? [...(windowState.events || [])].reverse().map((item) => ({
        event: item.event,
        provenance: "persisted",
        eventId: item.id ?? null,
        timestamp: item.created_at ?? null,
        sequenceId: null,
      }))
    : (snapshot?.thread_events?.[name] || []).map((event) => ({
        event,
        provenance: "persisted",
        eventId: null,
        timestamp: null,
        sequenceId: null,
      }));
  const boundary = windowState ? windowState.boundary : snapshot?.thread_event_boundary;
  return mergeThreadEvidence(persisted, observedThreadEntries(name), boundary);
}

function threadFinishDetail(event) {
  const exit = event.exit_code === null || event.exit_code === undefined ? "exit unavailable" : `exit ${event.exit_code}`;
  const timeout = event.timed_out
    ? `timed out${event.timeout_reason ? `: ${event.timeout_reason}` : " (reason unavailable)"}`
    : "not timed out";
  return combineActionDetail(exit, timeout);
}

function threadEventAction(event, entry = {}, matchedStart = null) {
  if (!event || event.type.startsWith("model_call_")
      || event.type === "token_usage_updated" || event.type === "thread_log") return null;
  const evidence = actionEvidence({ ...entry, event });
  if (event.type === "run_started") {
    return { name: "agent run", result: "started", state: "live", detail: compactActionDetail(event.prompt_preview), ...evidence };
  }
  if (event.type === "thread_started") {
    const sources = Array.isArray(event.source_threads) ? event.source_threads : null;
    const sourceDetail = sources
      ? `${sources.length} source thread${sources.length === 1 ? "" : "s"}${sources.length ? `: ${sources.join(", ")}` : ""}`
      : "source threads unavailable";
    return { name: "dispatch", result: "started", state: "live", detail: combineActionDetail(event.action, sourceDetail), sourceThreads: sources, ...evidence };
  }
  if (event.type === "tool_call_started") {
    const argumentsDetail = formatToolArguments(event.args_preview);
    return {
      name: toolDisplayName(event.name), result: "Running", state: "live",
      callId: event.call_id || null, argumentsDetail, detail: argumentsDetail, ...evidence,
    };
  }
  if (event.type === "tool_call_finished") {
    const argumentsDetail = matchedStart?.argumentsDetail || "";
    return {
      name: matchedStart?.name || toolDisplayName(event.name),
      result: event.is_error ? "Failed" : "Done",
      state: event.is_error ? "error" : "done",
      callId: event.call_id || matchedStart?.callId || null,
      argumentsDetail, detail: toolCompletionDetail(argumentsDetail, event), ...evidence,
    };
  }
  if (event.type === "assistant_message") {
    const detail = combineActionDetail(event.content, event.usage ? usageDetail(event.usage) : "");
    return detail ? { name: "response", result: "returned", state: "done", detail, ...evidence } : null;
  }
  if (event.type === "error") {
    return { name: "error", result: "failed", state: "error", detail: compactActionDetail(event.message), ...evidence };
  }
  if (event.type === "thread_steering_queued"
      || event.type === "thread_steering_delivered"
      || event.type === "thread_steering_expired") {
    const result = event.type.split("_").at(-1);
    return {
      name: "steering", result,
      state: result === "queued" ? "live" : result === "expired" ? "error" : "done",
      steeringId: event.steering_id ?? null,
      detail: combineActionDetail(event.steering_id == null ? "Steering ID unavailable" : `steering #${event.steering_id}`, event.instruction_preview),
      ...evidence,
    };
  }
  if (event.type === "thread_finished") {
    const succeeded = Number(event.exit_code) === 0 && !event.timed_out;
    return {
      name: "thread",
      result: event.timed_out ? "timed out" : succeeded ? "finished" : event.exit_code == null ? "finished" : `failed (exit ${event.exit_code})`,
      state: succeeded ? "done" : "error", detail: threadFinishDetail(event), ...evidence,
    };
  }
  if (event.type === "run_finished") {
    return { name: "agent run", result: "finished", state: "done", detail: "", ...evidence };
  }
  return { name: "Activity", result: "recorded", state: "recorded", detail: "Activity recorded", ...evidence };
}

function projectThreadActions(entries, { newestFirst = false } = {}) {
  const chronological = [...(entries || [])];
  const hasCanonicalStart = chronological.some((entry) => entry?.event?.type === "thread_started");
  const hasCanonicalFinish = chronological.some((entry) => entry?.event?.type === "thread_finished");
  const calls = new Map();
  const actions = [];
  for (const entry of chronological) {
    const event = entry?.event;
    if (!event || event.type.startsWith("model_call_")
        || event.type === "token_usage_updated" || event.type === "thread_log") continue;
    if ((event.type === "run_started" && hasCanonicalStart) || (event.type === "run_finished" && hasCanonicalFinish)) continue;
    if (event.type === "tool_call_finished") {
      const matchedStart = takeThreadToolStart(calls, event);
      if (matchedStart) {
        completeThreadToolAction(matchedStart, event, entry);
        continue;
      }
    }
    const action = threadEventAction(event, entry);
    if (!action) continue;
    actions.push(action);
    if (event.type === "tool_call_started") queueThreadToolStart(calls, event, action);
  }
  return newestFirst ? actions.reverse() : actions;
}

function threadFocusActions(name, snapshot, windowState) {
  const entries = threadFocusEvidenceEntries(name, snapshot, windowState);
  const actions = projectThreadActions(entries, { newestFirst: true });
  const observedSteering = new Set(entries.map((entry) => entry.event)
    .filter((event) => event?.type?.startsWith("thread_steering_")).map((event) => event.steering_id));
  const durable = (snapshot?.thread_steering || [])
    .filter((record) => record.thread_name === name && !observedSteering.has(record.id))
    .map(steeringRecordAction).reverse();
  return [...actions, ...durable];
}

function latestThreadEvidence(entries, type) {
  return entries.findLast((entry) => entry.event?.type === type) || null;
}

function renderWorkerUsage(usageEvidence) {
  const usage = usageEvidence?.usage;
  const metric = (label, value) => `<div><dt>${escapeHtml(label)}</dt><dd>${usage ? Number(value || 0).toLocaleString() : `<span class="evidence-unavailable">Unavailable</span>`}</dd></div>`;
  return `<section class="worker-usage"><div class="thread-evidence-heading"><h4>Worker usage</h4></div><dl>
    ${metric("Input", usage?.input_tokens)}
    ${metric("Cache read", usage?.cache_read_tokens)}
    ${metric("Output", usage?.output_tokens)}
    ${metric("Context", usage ? orchestratorContextTokens(usage) : null)}
  </dl></section>`;
}

function renderThreadSteering(records) {
  if (!records.length) return `<div class="thread-evidence-empty">No persisted steering records.</div>`;
  return `<ol class="thread-steering-list">${records.map((record) => `<li data-status="${escapeAttr(record.status || "unknown")}">
    <header><strong>${record.id == null ? "ID unavailable" : `#${escapeHtml(record.id)}`}</strong><span>${escapeHtml(record.status || "status unavailable")}</span></header>
    <p>${escapeHtml(record.instruction || "Instruction unavailable")}</p>
    <dl>
      ${renderEvidenceField("Session", record.session_id)}
      ${renderEvidenceField("Created", record.created_at)}
      ${renderEvidenceField("Delivered", record.delivered_at)}
      ${renderEvidenceField("Expired", record.expired_at)}
    </dl>
  </li>`).join("")}</ol>`;
}

function threadStatusPresentation(value) {
  const stateName = value === "queued" || value === "running" ? value : "finished";
  return { state: stateName, label: stateName === "queued" ? "Queued" : stateName === "running" ? "Running" : "Finished" };
}

function renderThreadEvidence(name, model, snapshot, entries) {
  const record = model?.record || null;
  const summary = sessionSummaryForSnapshot(snapshot);
  const start = latestThreadEvidence(entries, "thread_started");
  const finish = latestThreadEvidence(entries, "thread_finished");
  const startSources = Array.isArray(start?.event?.source_threads) ? start.event.source_threads : null;
  const sourceText = startSources
    ? `${startSources.length} source thread${startSources.length === 1 ? "" : "s"}${startSources.length ? ` · ${startSources.join(", ")}` : " · none"}`
    : null;
  const steering = (snapshot?.thread_steering || []).filter((item) => item.thread_name === name);
  const status = threadStatusPresentation(model?.state);
  return `<section class="thread-evidence" data-state="${escapeAttr(status.state)}">
    <div class="thread-evidence-heading"><h3>Lifecycle</h3><span>${escapeHtml(status.label)}</span></div>
    <dl class="evidence-grid">
      ${renderEvidenceField("Outcome", model?.outcome)}
      ${renderEvidenceField("Session ID", record?.session_id || snapshot?.metadata?.session_id || summary?.session_id)}
      ${renderEvidenceField("Session created", summary?.created_at)}
      ${renderEvidenceField("Session updated", summary?.updated_at)}
      ${renderEvidenceField("Thread created", record?.created_at)}
      ${renderEvidenceField("Thread updated", record?.updated_at)}
      ${renderEvidenceField("Persisted episode count", record?.episode_count)}
      ${renderEvidenceField("Source threads", sourceText, start ? "Source-thread field unavailable" : "No start event in current evidence")}
      ${renderEvidenceField("Start time", start?.timestamp)}
      ${renderEvidenceField("Finish time", finish?.timestamp)}
      ${renderEvidenceField("Exit", model?.finish?.exit_code == null ? null : model.finish.exit_code)}
      ${renderEvidenceField("Timed out", model?.finish ? (model.finish.timed_out ? "yes" : "no") : null)}
      ${renderEvidenceField("Timeout reason", model?.finish?.timeout_reason)}
      ${renderEvidenceField("Latest error", model?.latestError)}
    </dl>
    ${renderWorkerUsage(model?.usageEvidence)}
    <section class="thread-steering"><div class="thread-evidence-heading"><h4>Steering history</h4><span>${steering.length}</span></div>${renderThreadSteering(steering)}</section>
  </section>`;
}

function renderThreadFocus(name, model, snapshot) {
  const key = threadEventWindowKey(state.currentId, name);
  const windowState = state.threadEventWindows.get(key);
  const entries = threadFocusEvidenceEntries(name, snapshot, windowState);
  const actions = threadFocusActions(name, snapshot, windowState);
  const historyLoader = windowState?.hasOlder
    ? `<div class="focus-event-loader ${windowState.loading ? "is-loading" : ""}" data-event-loader role="status"><span>${windowState.loading ? "loading earlier events" : "scroll down for earlier events"}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m-6-6 6 6 6-6"></path></svg></div>`
    : "";
  const episodes = snapshot?.thread_episodes?.[name] || [];
  const episodeHtml = renderThreadEpisodes(episodes);
  return `<div class="focus-thread-layout"><section class="focus-activity"><div class="focus-thread-column-title"><h3>Action evidence · latest first</h3><span>${actions.length}</span></div>${renderFocusActions(actions)}${historyLoader}</section><section class="focus-episodes"><div class="focus-thread-column-title"><h3>Episodes</h3><span>${episodes.length}</span></div>${episodeHtml}${renderThreadEvidence(name, model, snapshot, entries)}</section></div>`;
}

function renderThreadEpisodes(episodes) {
  if (!episodes.length) return `<div class="focus-empty">No retained episodes. Episode identity and content are unavailable.</div>`;
  return episodes.map((episode, index) => {
    const action = episode.action || "Action unavailable";
    const response = episode.content || "";
    const isLatest = index === episodes.length - 1;
    const durableId = episode.id == null ? "ID unavailable" : `ID ${episode.id}`;
    return `<details class="focus-episode" data-episode-index="${index}" data-episode-id="${escapeAttr(episode.id ?? "")}"${isLatest ? " open" : ""}>
      <summary data-episode-summary="${index}"><span>Episode ${index + 1} · ${escapeHtml(durableId)}</span><strong>${escapeHtml(action)}</strong><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"></path></svg></summary>
      <div class="focus-episode-body">
        <dl class="episode-identity">
          ${renderEvidenceField("Durable episode ID", episode.id)}
          ${renderEvidenceField("Session ID", episode.session_id)}
          ${renderEvidenceField("Thread", episode.thread_name)}
          ${renderEvidenceField("Created", episode.created_at)}
        </dl>
        <section class="focus-episode-prompt"><span>Action</span><p>${escapeHtml(action)}</p></section>
        <section class="focus-episode-response"><span>Retained response</span><div class="focus-episode-copy">${response ? renderFocusMarkdown(response) : `<span class="evidence-unavailable">No retained response content</span>`}</div></section>
      </div>
    </details>`;
  }).join("");
}

function renderFocusActions(actions, { showTechnicalEvidence = false } = {}) {
  if (!actions.length) return `<div class="focus-empty">No action evidence is available.</div>`;
  return `<ol class="focus-action-list">${actions.map((action) => {
    const marker = action.state === "live" ? "›" : action.state === "error" ? "×" : action.state === "done" ? "✓" : "·";
    const evidence = showTechnicalEvidence ? [
      action.provenance === "observed" ? "observed live" : action.provenance,
      action.kind,
      action.sequenceId == null ? null : `sequence #${action.sequenceId}`,
      action.finishSequenceId == null ? null : `finished #${action.finishSequenceId}`,
      action.eventId == null ? null : `event #${action.eventId}`,
      action.timestamp,
      action.callId ? `call ${action.callId}` : null,
      action.steeringId == null ? null : `steering #${action.steeringId}`,
    ].filter(Boolean) : [];
    const provenance = showTechnicalEvidence ? ` data-provenance="${escapeAttr(action.provenance || "unavailable")}"` : "";
    return `<li class="focus-action ${action.state === "live" ? "is-live" : action.state === "error" ? "is-error" : ""}"${provenance}><span class="action-mark">${marker}</span><strong>${escapeHtml(action.name)}</strong><em>${escapeHtml(action.result)}</em>${evidence.length ? `<div class="focus-action-evidence">${evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}${action.detail ? `<p title="${escapeAttr(action.detail)}">${escapeHtml(action.detail)}</p>` : ""}</li>`;
  }).join("")}</ol>`;
}
function renderMarkdownImageToken(tokens, index, options, env, renderer) {
  const token = tokens[index];
  const target = String(token?.attrGet?.("src") || "");
  const alt = String(renderer?.renderInlineAsText?.(token?.children || [], options, env) || "image");
  const text = `image: ${alt}${target ? ` <${target}>` : ""}`;
  return `<span class="md-image-text">${escapeHtml(text)}</span>`;
}

function safeMarkdownHref(value) {
  const target = String(value || "");
  if (!target || /[\u0000-\u0020\u007f]/.test(target)) return null;
  try {
    const parsed = new URL(target);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? target : null;
  } catch (_) { return null; }
}

function renderMarkdownLinkOpen(tokens, index) {
  const target = safeMarkdownHref(tokens[index]?.attrGet?.("href"));
  tokens[index].meta = { ...(tokens[index].meta || {}), safeLink: Boolean(target) };
  return target
    ? `<a href="${escapeAttr(target)}" target="_blank" rel="noopener noreferrer">`
    : '<span class="md-link-text">';
}

function renderMarkdownLinkClose(tokens, index) {
  let nested = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (tokens[cursor]?.type === "link_close") nested += 1;
    if (tokens[cursor]?.type !== "link_open") continue;
    if (nested) { nested -= 1; continue; }
    return tokens[cursor].meta?.safeLink ? "</a>" : "</span>";
  }
  return "</span>";
}

function renderFocusMarkdown(value) {
  if (typeof window.markdownit !== "function" || !window.DOMPurify) return escapeHtml(value);
  if (!focusMarkdownRenderer) {
    focusMarkdownRenderer = window.markdownit({ html: false, linkify: true, typographer: false });
    focusMarkdownRenderer.renderer.rules.image = renderMarkdownImageToken;
    focusMarkdownRenderer.renderer.rules.link_open = renderMarkdownLinkOpen;
    focusMarkdownRenderer.renderer.rules.link_close = renderMarkdownLinkClose;
  }
  return window.DOMPurify.sanitize(focusMarkdownRenderer.render(String(value || "")), {
    ALLOWED_TAGS: ["p", "br", "strong", "em", "s", "blockquote", "code", "pre", "ul", "ol", "li", "a", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "table", "thead", "tbody", "tr", "th", "td", "span"],
    ALLOWED_ATTR: ["href", "target", "rel", "class"],
    FORBID_TAGS: ["img", "style", "script", "iframe", "object", "embed", "form", "input", "button"],
    FORBID_ATTR: ["style", "id", "name"],
  });
}

function threadModelEntries(name, snapshot, liveEvents = state.events.get(state.currentId) || []) {
  const persisted = (snapshot?.thread_events?.[name] || []).map((event) => ({
    event, provenance: "persisted", sequenceId: null, eventId: null, timestamp: null,
  }));
  return mergeThreadEvidence(persisted, observedThreadEntries(name, liveEvents), snapshot?.thread_event_boundary);
}

function threadUsageEvidence(entries) {
  let evidence = null;
  for (const entry of entries) {
    const event = entry.event;
    const usage = event?.type === "thread_finished" ? event.usage
      : event?.type === "assistant_message" ? event.usage
        : event?.type === "token_usage_updated" ? event.usage : null;
    if (usage) evidence = { usage, provenance: entry.persisted ? "persisted + observed" : entry.provenance, kind: event.type };
  }
  return evidence;
}

function threadLifecycleFromEvidence(entries, active) {
  let latestStart = null;
  let latestFinish = null;
  let latestRunFinish = null;
  let latestErrorEntry = null;
  let latestExecutionEntry = null;
  let latestError = null;
  const provenance = new Set();
  for (const [index, entry] of entries.entries()) {
    const event = entry?.event;
    if (!event) continue;
    provenance.add(entry.provenance);
    if (event.type === "thread_started") latestStart = { ...entry, index };
    if (event.type === "thread_finished") latestFinish = { ...entry, index };
    if (event.type === "run_finished") latestRunFinish = { ...entry, index };
    if (["run_started", "thread_started", "tool_call_started", "tool_call_finished", "assistant_message"].includes(event.type)) {
      latestExecutionEntry = { ...entry, index };
    }
    if (event.type === "error") {
      latestError = event.message || null;
      latestErrorEntry = { ...entry, index };
    }
  }
  const terminal = [latestFinish, latestRunFinish, latestErrorEntry]
    .filter(Boolean).sort((left, right) => left.index - right.index).at(-1) || null;
  const terminalIsCurrent = Boolean(terminal)
    && (!latestStart || terminal.index > latestStart.index)
    && (!latestExecutionEntry || terminal.index >= latestExecutionEntry.index);
  const launchEvidence = Boolean(latestStart || latestExecutionEntry);
  const stateName = terminalIsCurrent ? "finished" : active ? (launchEvidence ? "running" : "queued") : "finished";
  let outcome;
  if (terminalIsCurrent && terminal === latestFinish) {
    const exitCode = latestFinish.event.exit_code == null ? null : Number(latestFinish.event.exit_code);
    outcome = latestFinish.event.timed_out ? "timed out"
      : exitCode === 0 ? "completed (exit 0)"
        : exitCode === null || !Number.isFinite(exitCode) ? "finished; exit unavailable"
          : `failed (exit ${latestFinish.event.exit_code})`;
  } else if (terminalIsCurrent && terminal === latestErrorEntry) {
    outcome = latestError || "worker failed; error detail unavailable";
  } else if (terminalIsCurrent) {
    outcome = "worker run finished; exit outcome unavailable";
  } else if (active) {
    outcome = launchEvidence ? "running; no terminal evidence yet" : "queued; no start event yet";
  } else if (latestStart) {
    outcome = "start observed; finish outcome unavailable";
  } else {
    outcome = "no start/finish lifecycle evidence in the current window";
  }
  return {
    state: stateName, outcome,
    start: latestStart?.event || null,
    finish: terminalIsCurrent && latestFinish === terminal ? latestFinish.event : null,
    startSequence: latestStart?.sequenceId ?? null,
    finishSequence: terminalIsCurrent && latestFinish === terminal ? latestFinish.sequenceId ?? null : null,
    latestError, provenance: [...provenance], usageEvidence: threadUsageEvidence(entries),
  };
}

function buildThreadModels(snapshot = currentSnapshot()) {
  const liveEvents = state.events.get(state.currentId) || [];
  const liveEventsByThread = new Map();
  for (const envelope of liveEvents) {
    const name = eventThreadName(agentEvent(envelope));
    if (!name) continue;
    const entries = liveEventsByThread.get(name) || [];
    entries.push(envelope);
    liveEventsByThread.set(name, entries);
  }
  const steeringByThread = new Map();
  for (const record of snapshot?.thread_steering || []) {
    if (record.thread_name === ORCHESTRATOR_STEERING_TARGET) continue;
    const entries = steeringByThread.get(record.thread_name) || [];
    entries.push(record);
    steeringByThread.set(record.thread_name, entries);
  }
  const recordsByName = new Map((snapshot?.threads || []).map((thread) => [thread.name, thread]));
  const names = new Set([
    ...recordsByName.keys(), ...Object.keys(snapshot?.thread_episodes || {}),
    ...Object.keys(snapshot?.thread_events || {}), ...(snapshot?.active_threads || []),
    ...(snapshot?.message_cycle?.thread_names || []), ...steeringByThread.keys(),
    ...liveEventsByThread.keys(),
  ]);
  const active = new Set(snapshot?.active_threads || []);
  const models = [...names].map((name) => {
    const entries = threadModelEntries(name, snapshot, liveEventsByThread.get(name) || []);
    const lifecycle = threadLifecycleFromEvidence(entries, active.has(name));
    const record = recordsByName.get(name) || null;
    const steering = steeringByThread.get(name) || [];
    const actions = projectThreadActions(entries);
    const observedSteering = new Set(entries.map((entry) => entry.event)
      .filter((event) => event?.type?.startsWith("thread_steering_")).map((event) => event.steering_id));
    for (const durable of steering) if (!observedSteering.has(durable.id)) actions.push(steeringRecordAction(durable));
    if (record || (snapshot?.thread_episodes?.[name] || []).length || steering.length
        || (snapshot?.message_cycle?.thread_names || []).includes(name)) {
      if (!lifecycle.provenance.includes("persisted")) lifecycle.provenance.unshift("persisted");
    }
    return { name, ...lifecycle, record, entries, actions };
  });
  const currentCycle = currentCycleThreadNames(snapshot);
  return models.map((thread) => ({
    ...thread,
    compact: !["running", "queued"].includes(thread.state) && !currentCycle.has(thread.name),
  })).sort((a, b) => {
    const rank = (thread) => thread.state === "running" ? 0 : thread.state === "queued" ? 1 : thread.compact ? 3 : 2;
    const rankDifference = rank(a) - rank(b);
    if (rankDifference) return rankDifference;
    const updatedDifference = String(b.record?.updated_at || "").localeCompare(String(a.record?.updated_at || ""));
    return updatedDifference || a.name.localeCompare(b.name);
  });
}


function currentCycleThreadNames(snapshot) {
  const seed = threadCycleSeed(snapshot);
  const sessionId = state.currentId || snapshot?.metadata?.session_id || "__preview__";
  let cycle = state.threadCycles.get(sessionId);
  if (!cycle || cycle.marker !== seed.marker) {
    cycle = { marker: seed.marker, names: new Set() };
    state.threadCycles.set(sessionId, cycle);
  }
  for (const name of seed.names) cycle.names.add(name);
  return cycle.names;
}

function threadCycleSeed(snapshot) {
  const messages = snapshot?.messages || [];
  const serverCycle = snapshot?.message_cycle;
  const names = new Set(snapshot?.active_threads || []);
  if (serverCycle?.marker) {
    for (const name of serverCycle.thread_names || []) names.add(name);
    return { marker: serverCycle.marker, names };
  }
  const users = messages.filter((message) => message?.role === "user");
  const latest = users.at(-1);
  return { marker: latest ? `${users.length}:${latest.content || ""}` : "none", names };
}

function eventThreadName(event) {
  if (!event) return null;
  if (event.thread_name) return event.thread_name;
  if (["thread_started", "thread_log", "thread_finished", "thread_steering_queued", "thread_steering_delivered", "thread_steering_expired"].includes(event.type)) return event.name || null;
  return null;
}

function steeringRecordAction(record) {
  const result = record?.status || "status unavailable";
  const transitionTime = result === "delivered" ? record.delivered_at : result === "expired" ? record.expired_at : null;
  return {
    name: "steering",
    result,
    state: result === "queued" ? "live" : result === "expired" ? "error" : "done",
    provenance: "persisted",
    kind: "steering_record",
    steeringId: record?.id ?? null,
    timestamp: transitionTime || record?.created_at || null,
    detail: combineActionDetail(
      record?.id == null ? "Steering ID unavailable" : `steering #${record.id}`,
      record?.instruction || "Instruction unavailable",
      record?.created_at ? `created ${record.created_at}` : "created time unavailable",
      record?.delivered_at ? `delivered ${record.delivered_at}` : "",
      record?.expired_at ? `expired ${record.expired_at}` : "",
    ),
  };
}

function renderThreads(snapshot) {
  const activeControl = captureFocusTarget(document.activeElement);
  const models = buildThreadModels(snapshot);
  if (state.targetedThread && !models.some((thread) => thread.name === state.targetedThread && ["running", "queued"].includes(thread.state))) state.targetedThread = null;
  const current = models.filter((thread) => !thread.compact);
  const earlier = models.filter((thread) => thread.compact);
  const currentGrid = current.length ? `<div class="thread-current-grid">${current.map(renderThreadTile).join("")}</div>` : "";
  const earlierGrid = earlier.length ? `<div class="thread-earlier-grid ${current.length ? "" : "is-only"}">${earlier.map(renderThreadTile).join("")}</div>` : "";
  const empty = models.length ? "" : `<p class="thread-board-empty">No thread lifecycle or retained-history evidence.</p>`;
  el.threadGrid.innerHTML = currentGrid + earlierGrid + empty;
  renderComposerTarget();
  scheduleActiveControlRestoration(activeControl);
}

function renderThreadTile(thread) {
  const selected = state.targetedThread === thread.name;
  const status = threadStatusPresentation(thread.state);
  const available = ["running", "queued"].includes(status.state);
  const label = available ? `Target ${thread.name} for steering` : `Open ${thread.name} fullscreen`;
  const ledger = thread.compact ? "" : `<ol class="action-ledger">${renderActionRows(thread.actions, "No action evidence")}</ol>`;
  return `<article class="thread-tile ${thread.compact ? "is-compact" : ""} ${selected ? "is-selected" : ""}" data-state="${escapeAttr(status.state)}"><header class="thread-tile-head"><button class="thread-select" type="button" data-thread-name="${escapeAttr(thread.name)}" data-thread-state="${escapeAttr(status.state)}" aria-pressed="${selected}" aria-label="${escapeAttr(label)}"><span class="thread-name" title="${escapeAttr(thread.name)}">${escapeHtml(thread.name)}</span><span class="thread-state" aria-label="${escapeAttr(status.label)}">${escapeHtml(status.label)}</span></button><button class="expand-button thread-expand" type="button" data-focus-thread="${escapeAttr(thread.name)}" aria-label="Open ${escapeAttr(thread.name)} fullscreen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"></path></svg></button></header>${ledger}</article>`;
}

function selectTileActions(actions, limit = ACTION_LEDGER_LIMIT) {
  if (actions.length <= limit) return [...actions];
  const protectedIndexes = new Set();
  for (const predicate of [
    (action) => action.name === "response",
    (action) => action.kind === "error" || action.name === "error",
    (action) => ["thread_finished", "run_finished"].includes(action.kind),
  ]) {
    const index = actions.findLastIndex(predicate);
    if (index >= 0) protectedIndexes.add(index);
  }
  for (let index = actions.length - 1; index >= 0 && protectedIndexes.size < limit; index -= 1) {
    protectedIndexes.add(index);
  }
  return [...protectedIndexes].sort((left, right) => left - right).map((index) => actions[index]);
}

function renderActionRows(actions, emptyLabel) {
  const visible = selectTileActions(actions);
  const placeholders = Array.from({ length: ACTION_LEDGER_LIMIT - visible.length }, (_, index) => {
    const label = !visible.length && index === ACTION_LEDGER_LIMIT - 1 ? emptyLabel : "";
    return `<li class="action-row is-placeholder" aria-hidden="true">${label ? `<span class="action-detail">${escapeHtml(label)}</span>` : ""}</li>`;
  });
  const rows = visible.map((action) => {
    const rowClass = action.state === "live" ? "is-live" : action.state === "error" ? "is-error" : "";
    const marker = action.state === "live" ? "›" : action.state === "error" ? "×" : action.state === "done" ? "✓" : "·";
    const detail = action.detail ? `<span class="action-detail" title="${escapeAttr(action.detail)}">${escapeHtml(action.detail)}</span>` : "";
    return `<li class="action-row ${rowClass} ${detail ? "has-detail" : ""}"><span class="action-mark">${marker}</span><span class="action-name">${escapeHtml(action.name)}</span><span class="action-result">${escapeHtml(action.result)}</span>${detail}</li>`;
  });
  return placeholders.concat(rows).join("");
}

function toolDisplayName(value) {
  const leaf = String(value || "tool").trim().split("__").at(-1).toLowerCase();
  const names = {
    read: "Read", exec_command: "Command", shell: "Command", exec: "Command", bash: "Command",
    write: "Write", edit: "Edit", write_stdin: "Terminal input", thread: "Thread",
    threads: "Threads", thread_read: "Read thread", thread_delete: "Delete thread",
    workset_define: "Define workset", workset_read: "Read workset", workset_list: "List worksets",
    web_search_exa: "Web search", web_fetch_exa: "Web fetch", searchgithub: "GitHub search",
    resolve_library_id: "Context library lookup", query_docs: "Context documentation",
  };
  if (names[leaf]) return names[leaf];
  const humanized = leaf.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return humanized ? humanized.charAt(0).toUpperCase() + humanized.slice(1) : "Tool";
}

function formatToolArguments(argsPreview) {
  return compactActionDetail(argsPreview, 280) || "Arguments unavailable";
}

function toolCompletionDetail(argumentsDetail, event) {
  const result = compactActionDetail(event?.content_preview, 160);
  return combineActionDetail(argumentsDetail, result ? `result: ${result}` : "");
}

function threadToolCallKey(event) {
  if (event?.call_id === null || event?.call_id === undefined || event.call_id === "") return null;
  return String(event.call_id);
}

function threadToolMatchName(event) {
  return String(event?.name || "").trim().toLowerCase();
}

function queueThreadToolStart(calls, event, action) {
  const key = threadToolCallKey(event);
  if (!key) return;
  const queue = calls.get(key) || [];
  queue.push({ action, name: threadToolMatchName(event) });
  calls.set(key, queue);
}

function takeThreadToolStart(calls, event) {
  const key = threadToolCallKey(event);
  if (!key) return null;
  const queue = calls.get(key);
  if (!queue?.length) return null;
  const finishName = threadToolMatchName(event);
  let index = finishName ? queue.findIndex((candidate) => candidate.name === finishName) : 0;
  if (index < 0) index = 0;
  const [{ action }] = queue.splice(index, 1);
  if (!queue.length) calls.delete(key);
  return action;
}

function completeThreadToolAction(action, event, entry = {}) {
  action.result = event.is_error ? "Failed" : "Done";
  action.state = event.is_error ? "error" : "done";
  action.callId = action.callId || event.call_id || null;
  action.finishSequenceId = entry.sequenceId ?? null;
  action.finishEventId = entry.eventId ?? null;
  action.detail = toolCompletionDetail(action.argumentsDetail, event);
  return action;
}

function compactActionDetail(value, maxChars = 320) {
  const compact = String(value || "").split(/\s+/).filter(Boolean).join(" ");
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars - 1)}…`;
}

function handleThreadClick(event) {
  const expand = event.target.closest("[data-focus-thread]");
  if (expand) {
    openFocusView("thread", expand.dataset.focusThread);
    return;
  }
  const button = event.target.closest("[data-thread-name]");
  if (!button) return;
  const name = button.dataset.threadName;
  if (["running", "queued"].includes(button.dataset.threadState)) {
    state.targetedThread = state.targetedThread === name ? null : name;
    renderThreads(currentSnapshot());
    if (state.targetedThread) el.promptInput.focus();
  } else openFocusView("thread", name);
}

function persistComposerDraft(sessionId = state.currentId) {
  if (!sessionId || !el.promptInput) return "";
  const draft = String(el.promptInput.value || "");
  state.composerDrafts.set(sessionId, draft);
  return draft;
}

function restoreComposerDraft(sessionId = state.currentId) {
  if (!el.promptInput) return "";
  const draft = sessionId ? String(state.composerDrafts.get(sessionId) || "") : "";
  el.promptInput.value = draft;
  state.commandIndex = 0;
  resizeComposer();
  renderCommandMenu();
  return draft;
}

function clearComposerDraftIfUnchanged(sessionId, submittedInput) {
  const stored = String(state.composerDrafts.get(sessionId) || "");
  if (stored.trim() !== submittedInput) return false;
  state.composerDrafts.set(sessionId, "");
  if (state.currentId === sessionId && String(el.promptInput?.value || "").trim() === submittedInput) {
    el.promptInput.value = "";
    resizeComposer();
    renderCommandMenu();
  }
  return true;
}

function renderComposerTarget() {
  const targeted = Boolean(state.targetedThread);
  const orchestratorActive = Boolean(effectiveActiveRun(currentSnapshot(), state.currentId));
  el.composerTarget.hidden = !targeted;
  el.composerTargetName.textContent = state.targetedThread || "";
  el.sendPrompt.disabled = Boolean(state.currentId && state.submittingSessions.has(state.currentId));
  el.promptInput.placeholder = targeted
    ? `Steer ${state.targetedThread} after its current action`
    : orchestratorActive ? "Steer the orchestrator · / for commands" : "Message the orchestrator · / for commands";
  el.promptInput.setAttribute("aria-label", targeted ? `Steer thread ${state.targetedThread}` : orchestratorActive ? "Steer the orchestrator" : "Message the orchestrator");
}

function clearThreadTarget() {
  state.targetedThread = null;
  renderThreads(currentSnapshot());
  el.promptInput.focus();
}

async function submitComposer(event) {
  event.preventDefault();
  const sessionId = state.currentId;
  const rawInput = String(el.promptInput.value || "");
  const input = rawInput.trim();
  if (!input || !sessionId || state.submittingSessions.has(sessionId)) return;
  state.composerDrafts.set(sessionId, rawInput);
  if (input.startsWith("/")) {
    const [name, ...rest] = input.slice(1).split(/\s+/);
    if (commands.some((command) => command.name === name)) {
      state.composerDrafts.set(sessionId, rest.join(" "));
      el.promptInput.value = rest.join(" ");
      resizeComposer();
      runCommand(name);
      return;
    }
  }

  const target = state.targetedThread;
  const activeAtSubmission = !target && Boolean(effectiveActiveRun(state.snapshots.get(sessionId), sessionId));
  const submission = { sessionId, target };
  state.submittingSessions.add(sessionId);
  el.sendPrompt.disabled = true;
  if (!target && state.focusView?.type === "orchestrator") {
    state.orchestratorViewport = { sessionId, pinnedToBottom: true, scrollTop: 0 };
  }
  const contextIsCurrent = () => state.currentId === sessionId;
  const clearSubmittedInput = () => clearComposerDraftIfUnchanged(sessionId, input);
  const notify = (message, error = false) => {
    if (contextIsCurrent()) showToast(message, error);
  };
  const noteAcceptedRun = (accepted) => {
    captureAcceptedRun(sessionId, accepted, input, state.snapshots.get(sessionId));
    noteSessionRunEvent(sessionId, "run_started");
    clearSubmittedInput();
    notify("Run started");
    if (contextIsCurrent()) {
      renderWorkspace();
      loadSessions({ workspaceStats: false });
    }
    scheduleSnapshot(sessionId);
  };

  try {
    if (target) {
      await apiPost(`/sessions/${encodeURIComponent(sessionId)}/threads/${encodeURIComponent(target)}/steering`, { instruction: input });
      clearSubmittedInput();
      notify(`Steering queued for ${target}`);
      scheduleSnapshot(sessionId);
    } else if (activeAtSubmission) {
      let steered = true;
      try {
        await apiPost(`/sessions/${encodeURIComponent(sessionId)}/steering`, { instruction: input });
      } catch (error) {
        const runEnded = error.status === 409 && /no active run|finishing/i.test(error.message);
        if (!runEnded) throw error;
        const accepted = await apiPost(`/sessions/${encodeURIComponent(sessionId)}/runs`, { prompt: input });
        captureAcceptedRun(sessionId, accepted, input, state.snapshots.get(sessionId));
        noteSessionRunEvent(sessionId, "run_started");
        steered = false;
      }
      clearSubmittedInput();
      notify(steered ? "Steering queued for orchestrator" : "Run started");
      scheduleSnapshot(sessionId);
      if (!steered && contextIsCurrent()) {
        renderWorkspace();
        loadSessions({ workspaceStats: false });
      }
    } else {
      const accepted = await apiPost(`/sessions/${encodeURIComponent(sessionId)}/runs`, { prompt: input });
      noteAcceptedRun(accepted);
    }
  } catch (error) {
    notify(error.message, true);
  } finally {
    state.submittingSessions.delete(submission.sessionId);
    if (contextIsCurrent()) {
      el.sendPrompt.disabled = state.submittingSessions.has(sessionId);
      resizeComposer();
      el.promptInput.focus();
    }
  }
}

function handleComposerInput() {
  persistComposerDraft();
  resizeComposer();
  renderCommandMenu();
}

function resizeComposer() {
  const minHeight = Number.parseFloat(getComputedStyle(el.promptInput).minHeight) || 40;
  el.promptInput.style.height = "auto";
  el.promptInput.style.height = `${Math.max(minHeight, Math.min(el.promptInput.scrollHeight, 134))}px`;
}

function matchingCommands() {
  const value = el.promptInput.value;
  if (!value.startsWith("/") || value.includes("\n") || value.includes(" ")) return [];
  const query = value.slice(1).toLowerCase();
  return commands.filter((command) => command.name.startsWith(query));
}

function closeCommandMenu() {
  el.commandMenu.hidden = true;
  el.commandMenu.innerHTML = "";
  el.promptInput.setAttribute?.("aria-expanded", "false");
  el.promptInput.removeAttribute?.("aria-activedescendant");
}

function commandOptionId(name) { return `command-option-${name}`; }

function renderCommandMenu() {
  const matches = matchingCommands();
  if (!matches.length) {
    closeCommandMenu();
    return;
  }
  state.commandIndex = Math.min(state.commandIndex, matches.length - 1);
  el.commandMenu.hidden = false;
  el.promptInput.setAttribute?.("aria-expanded", "true");
  el.promptInput.setAttribute?.("aria-activedescendant", commandOptionId(matches[state.commandIndex].name));
  el.commandMenu.innerHTML = matches.map((command, index) => `<button id="${commandOptionId(command.name)}" class="command-option ${index === state.commandIndex ? "is-active" : ""}" type="button" role="option" aria-selected="${index === state.commandIndex}" tabindex="-1" data-command-option="${command.name}"><code>/${command.name}</code><span>${escapeHtml(command.description)}</span></button>`).join("");
}

function handleComposerKeydown(event) {
  const matches = matchingCommands();
  if (matches.length && ["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    state.commandIndex = (state.commandIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
    renderCommandMenu();
    return;
  }
  if (event.key === "Escape" && !el.commandMenu.hidden) {
    event.preventDefault();
    closeCommandMenu();
    return;
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (matches.length && !el.commandMenu.hidden) runCommand(matches[state.commandIndex].name);
    else el.commandComposer.requestSubmit();
  }
}

function runCommand(name) {
  closeCommandMenu();
  el.promptInput.value = "";
  if (state.currentId) state.composerDrafts.set(state.currentId, "");
  resizeComposer();
  if (name === "worksets") openFocusView("worksets");
  else if (name === "transcript") openFocusView("orchestrator");
  else if (name === "workspace") openFocusView("workspace");
  else if (name === "info") openFocusView("info");
  else if (name === "settings") openFocusView("settings");
  else if (name === "help") showHelpDrawer();
  else if (name === "stop") stopActiveRun();
  else if (name === "rename") renameCurrentSession();
  else if (name === "delete") deleteCurrentSession();
  else if (name === "clear") clearThreadTarget();
}

function setAppModalState(active) {
  if (!el.app) return;
  el.app.inert = Boolean(active);
  if (active) {
    el.app.setAttribute("inert", "");
    el.app.setAttribute("aria-hidden", "true");
  } else {
    el.app.removeAttribute("inert");
    el.app.removeAttribute("aria-hidden");
  }
}

function drawerFocusableElements() {
  const selector = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
  return [...(el.utilityDrawer?.querySelectorAll?.(selector) || [])]
    .filter((item) => !item.hidden && item.getAttribute?.("aria-hidden") !== "true");
}

function openDrawer(title, html, view = "detail") {
  if (el.utilityDrawer.hidden) state.drawerOpener = captureFocusTarget(document.activeElement);
  el.drawerTitle.textContent = title;
  el.drawerContent.innerHTML = html;
  el.utilityDrawer.dataset.view = view;
  el.drawerBackdrop.hidden = false;
  el.utilityDrawer.hidden = false;
  el.closeDrawer.focus({ preventScroll: true });
  setAppModalState(true);
}

function closeDrawer() {
  const wasOpen = !el.utilityDrawer.hidden;
  const returnTarget = state.drawerOpener;
  state.drawerOpener = null;
  el.drawerBackdrop.hidden = true;
  el.utilityDrawer.hidden = true;
  el.drawerContent.innerHTML = "";
  setAppModalState(false);
  if (wasOpen) requestAnimationFrame(() => restoreFocusTarget(returnTarget));
}

function handleDrawerKeydown(event) {
  if (el.utilityDrawer.hidden) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeDrawer();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = drawerFocusableElements();
  if (!focusable.length) {
    event.preventDefault();
    el.utilityDrawer.focus?.({ preventScroll: true });
    return;
  }
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || !el.utilityDrawer.contains?.(document.activeElement))) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && (document.activeElement === last || !el.utilityDrawer.contains?.(document.activeElement))) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}

function showHelpDrawer() {
  openDrawer("commands", `<div class="command-reference">${commands.map((command) => `<div><code>/${command.name}</code><span>${escapeHtml(command.description)}</span></div>`).join("")}</div>`, "compact");
}

async function reconcileCompletedSettingsSave(submission) {
  const tasks = [
    loadSnapshot(submission.sessionId, false),
    loadSessions({ workspaceStats: false, preserveSessionId: submission.sessionId }),
  ];
  if (state.currentId === submission.sessionId && state.focusView?.type === "settings") {
    const requestGeneration = state.settingsRequestGeneration + 1;
    state.settingsRequestGeneration = requestGeneration;
    tasks.push(loadFocusSettings({ requestGeneration, message: "Saved" }));
  }
  return Promise.allSettled(tasks);
}

function setSettingsFormBusy(formElement, busy) {
  if (!formElement) return;
  formElement.inert = busy;
  if (busy) formElement.setAttribute("aria-busy", "true");
  else formElement.removeAttribute("aria-busy");
  const submit = formElement.querySelector?.("[data-settings-submit]");
  if (submit) submit.disabled = busy;
}

function setSettingsFormStatus(formElement, message, error = false) {
  const status = formElement?.querySelector?.("#settingsStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", error);
}

async function handleDrawerSubmit(event) {
  if (event.target.id === "renameForm") {
    event.preventDefault();
    await saveSessionRename(event.target);
    return;
  }
  if (event.target.id === "deleteSessionForm") {
    event.preventDefault();
    await confirmSessionDeletion(event.target);
    return;
  }
  if (event.target.id !== "settingsForm") return;
  event.preventDefault();
  const formElement = event.target;
  const sessionId = state.currentId;
  const requestGeneration = state.settingsRequestGeneration;
  const settings = state.settingsFocus;
  if (!sessionId
      || !settingsContextIsCurrent(requestGeneration, sessionId)
      || settings?.status !== "ready"
      || state.settingsSubmission) return;

  let body;
  try {
    const form = new FormData(formElement);
    body = buildSettingsPatch({
      backend: form.get("backend"),
      reasoning_effort: form.get("reasoning_effort"),
      model: form.get("model"),
      base_url: form.get("base_url"),
      api_key_env: form.get("api_key_env"),
      orchestrator_compaction_threshold: form.get("orchestrator_compaction_threshold"),
      extra_headers: form.get("extra_headers"),
    }, settingsValuesFromConfig(settings.config));
  } catch (error) {
    setSettingsFormStatus(formElement, error.message, true);
    return;
  }

  if (!Object.keys(body).length) {
    setSettingsFormStatus(formElement, "No changes");
    return;
  }

  const submission = { sessionId, requestGeneration };
  state.settingsSubmission = submission;
  setSettingsFormBusy(formElement, true);
  setSettingsFormStatus(formElement, "Saving…");
  let saved = false;
  let completionError = null;
  try {
    await apiPatch(`/sessions/${encodeURIComponent(sessionId)}/config`, body);
    saved = true;
    await reconcileCompletedSettingsSave(submission);
  } catch (error) {
    completionError = error;
  } finally {
    if (state.settingsSubmission === submission) state.settingsSubmission = null;
    const currentForm = el.focusContent?.querySelector?.("#settingsForm");
    if (currentForm) {
      setSettingsFormBusy(currentForm, false);
      const sameSessionView = state.currentId === sessionId && state.focusView?.type === "settings";
      if (sameSessionView && completionError) {
        setSettingsFormStatus(currentForm, completionError.message, true);
      } else if (sameSessionView && saved) {
        setSettingsFormStatus(currentForm, "Saved");
      } else {
        setSettingsFormStatus(currentForm, state.settingsFocus?.message || "");
      }
    }
  }
}
async function stopActiveRun() {
  if (!state.currentId) return;
  try {
    await apiPost(`/sessions/${encodeURIComponent(state.currentId)}/cancel-active-run`);
    showToast("Stop requested");
    scheduleSnapshot(state.currentId);
  } catch (error) { showToast(error.message, true); }
}

function renameCurrentSession() {
  const entry = sessionEntry();
  if (!entry) return;
  openDrawer("rename session", `<form id="renameForm" class="settings-form"><label class="field span-two"><span>session title</span><input name="title" maxlength="120" autocomplete="off" value="${escapeAttr(entry.summary.title || "")}" placeholder="${escapeAttr(shortId(entry.summary.session_id))}"></label><div class="settings-actions"><span class="form-status" data-rename-status role="status" aria-live="polite" aria-atomic="true"></span><button class="button button-primary" type="submit">save title</button></div></form>`, "compact");
  requestAnimationFrame(() => el.drawerContent.querySelector('input[name="title"]')?.focus());
}

async function saveSessionRename(formElement) {
  const entry = sessionEntry();
  if (!entry) return;
  const status = formElement.querySelector("[data-rename-status]");
  const next = String(new FormData(formElement).get("title") || "").trim();
  status.textContent = "Saving…";
  try {
    entry.summary = await apiPut(`/sessions/${encodeURIComponent(state.currentId)}/presentation`, {
      title: next,
      pinned: entry.summary.pinned,
      expected_version: entry.summary.presentation_version,
    });
    renderWorkspace();
    renderPicker();
    closeDrawer();
    showToast("Session renamed");
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("is-error");
  }
}

function deleteCurrentSession() {
  const entry = sessionEntry();
  if (!entry) return;
  openDrawer("delete session", `<form id="deleteSessionForm" class="settings-form" data-session-id="${escapeAttr(entry.summary.session_id)}"><div class="span-two"><p class="workset-goal">Delete <strong>${escapeHtml(displaySessionTitle(entry.summary))}</strong> and its transcript, worksets, retained episodes, and steering history. This cannot be undone.</p></div><div class="settings-actions"><span class="form-status" data-delete-status role="status" aria-live="polite" aria-atomic="true"></span><button class="button button-danger" type="submit">delete permanently</button></div></form>`, "compact");
}

async function confirmSessionDeletion(formElement) {
  const status = formElement.querySelector("[data-delete-status]");
  const sessionId = String(formElement.dataset?.sessionId || state.currentId || "");
  if (!sessionId) return;
  const ownsView = () => state.currentId === sessionId
    && el.drawerContent?.querySelector?.("#deleteSessionForm") === formElement;
  status.textContent = "Deleting…";
  try {
    await apiDelete(`/sessions/${encodeURIComponent(sessionId)}`);
    tombstoneDeletedSessionForListRefresh(sessionId);
    if (ownsView()) showPicker();
    await loadSessions({ workspaceStats: true });
    showToast("Session deleted");
  } catch (error) {
    if (ownsView()) {
      status.textContent = error.message;
      status.classList.add("is-error");
    }
  }
}

function launchModeFromForm() {
  return String(new FormData(el.launchForm).get("execution_mode") || "local");
}

function launchDraftBucket(mode) { return mode === "ssh" ? "ssh" : "localSandbox"; }

function transitionLaunchCwdDrafts(previousMode, nextMode, currentCwd, drafts = {}, rootCwd = "") {
  const updated = {
    localSandbox: drafts.localSandbox ?? String(rootCwd || ""),
    ssh: Object.prototype.hasOwnProperty.call(drafts, "ssh") ? drafts.ssh : null,
  };
  updated[launchDraftBucket(previousMode)] = String(currentCwd ?? "");
  if (nextMode === "ssh" && updated.ssh === null) updated.ssh = "~";
  return {
    drafts: updated,
    cwd: String(updated[launchDraftBucket(nextMode)] ?? ""),
  };
}

function resetLaunchDraftState() {
  const rootCwd = String(state.store?.root_cwd || "");
  state.launchMode = "local";
  state.launchCwdDrafts = { localSandbox: rootCwd, ssh: null };
  state.launchApiKeyModeManual = false;
  state.launchApiKeyAutoManaged = false;
  if (el.launchCwd) el.launchCwd.value = rootCwd;
}

function openLaunchDialog() {
  el.launchStatus.textContent = "";
  el.launchStatus.classList.remove("is-error");
  if (state.launchCwdDrafts.localSandbox === null) resetLaunchDraftState();
  const mode = launchModeFromForm();
  const transition = transitionLaunchCwdDrafts(
    state.launchMode,
    mode,
    el.launchCwd.value,
    state.launchCwdDrafts,
    state.store?.root_cwd,
  );
  state.launchMode = mode;
  state.launchCwdDrafts = transition.drafts;
  el.launchCwd.value = transition.cwd;
  syncLaunchExecutionFields(mode);
  syncLaunchApiKeyMode();
  el.launchDialog.showModal();
  loadLaunchDefaultsPreview();
  requestAnimationFrame(() => el.launchCwd.focus());
}

function syncLaunchExecutionFields(mode) {
  mode = ["local", "ssh", "sandbox"].includes(mode) ? mode : "local";
  const sshActive = mode === "ssh";
  const sandboxActive = mode === "sandbox";
  el.launchSshField.hidden = !sshActive;
  el.launchSshField.inert = !sshActive;
  el.sandboxFields.hidden = !sandboxActive;
  el.sandboxFields.inert = !sandboxActive;
  el.launchSshHost.disabled = !sshActive;
  el.launchSshHost.required = sshActive;
  for (const control of [el.sandboxImage, el.sandboxGpu, el.sandboxWorkdir, el.sandboxShm, el.sandboxMounts, el.sandboxNoMount]) {
    if (control) control.disabled = !sandboxActive;
  }
  if (el.launchExecutionModes) el.launchExecutionModes.dataset.mode = mode;
  if (el.launchCwd) el.launchCwd.dataset.mode = mode;
  if (el.launchCwdLabel) el.launchCwdLabel.textContent = sshActive ? "remote working directory" : "working directory";
  el.launchCwd.placeholder = sshActive ? "~" : "/path/to/repository";
}

function syncLaunchExecutionMode({ refresh = true } = {}) {
  const mode = launchModeFromForm();
  const transition = transitionLaunchCwdDrafts(
    state.launchMode,
    mode,
    el.launchCwd.value,
    state.launchCwdDrafts,
    state.store?.root_cwd,
  );
  state.launchMode = mode;
  state.launchCwdDrafts = transition.drafts;
  el.launchCwd.value = transition.cwd;
  syncLaunchExecutionFields(mode);
  if (refresh) loadLaunchDefaultsPreview();
}

function handleLaunchLocationInput() {
  state.launchCwdDrafts = {
    ...state.launchCwdDrafts,
    [launchDraftBucket(state.launchMode)]: el.launchCwd.value,
  };
  scheduleLaunchDefaultsPreview();
}

function launchDefaultsContext() {
  return {
    mode: state.launchMode || launchModeFromForm(),
    cwd: String(el.launchCwd?.value || ""),
    sshHost: String(el.launchSshHost?.value || ""),
  };
}

function buildLaunchDefaultsRequest(context) {
  const mode = String(context?.mode || "local");
  const cwd = String(context?.cwd || "").trim();
  const sshHost = String(context?.sshHost || "").trim();
  if (mode === "ssh") {
    if (!sshHost) return { ready: false, message: "Enter an SSH host to load the server-side launch defaults." };
    return { ready: true, body: { cwd: cwd || "~", ssh_host: sshHost } };
  }
  return { ready: true, body: cwd ? { cwd } : {} };
}

function invalidateLaunchDefaultsPreview() {
  state.launchDefaultsGeneration += 1;
  if (state.launchDefaultsTimer !== null) window.clearTimeout(state.launchDefaultsTimer);
  state.launchDefaultsTimer = null;
  return state.launchDefaultsGeneration;
}

function scheduleLaunchDefaultsPreview() {
  const generation = invalidateLaunchDefaultsPreview();
  const context = launchDefaultsContext();
  const request = buildLaunchDefaultsRequest(context);
  state.launchDefaultsPreview = request.ready
    ? { status: "loading", data: null, error: "", request: request.body }
    : { status: "waiting", data: null, error: "", message: request.message, request: null };
  renderLaunchDefaultsPreview();
  if (!request.ready) return Promise.resolve(null);
  state.launchDefaultsTimer = window.setTimeout(() => {
    state.launchDefaultsTimer = null;
    requestLaunchDefaultsPreview(context, generation);
  }, 180);
  return null;
}

function loadLaunchDefaultsPreview(context = launchDefaultsContext()) {
  const generation = invalidateLaunchDefaultsPreview();
  return requestLaunchDefaultsPreview(context, generation);
}

async function requestLaunchDefaultsPreview(context, generation) {
  const request = buildLaunchDefaultsRequest(context);
  if (generation !== state.launchDefaultsGeneration) return null;
  if (!request.ready) {
    state.launchDefaultsPreview = { status: "waiting", data: null, error: "", message: request.message, request: null };
    renderLaunchDefaultsPreview();
    return null;
  }
  state.launchDefaultsPreview = { status: "loading", data: null, error: "", request: request.body };
  renderLaunchDefaultsPreview();
  try {
    const data = await apiPost("/sessions/launch-defaults", request.body);
    if (generation !== state.launchDefaultsGeneration) return null;
    state.launchDefaultsPreview = { status: "ready", data: data || {}, error: "", request: request.body };
    syncLaunchApiKeyMode();
    renderLaunchDefaultsPreview();
    return data;
  } catch (error) {
    if (generation !== state.launchDefaultsGeneration) return null;
    state.launchDefaultsPreview = { status: "error", data: null, error: error.message, request: request.body };
    renderLaunchDefaultsPreview();
    return null;
  }
}

const MANAGED_LAUNCH_BACKENDS = {
  "arcee-auth": {
    canonicalUrl: "https://api.arcee.ai/api/v1",
    credentialLabel: "server-stored Arcee login",
  },
  "chatgpt-codex-responses": {
    canonicalUrl: "https://chatgpt.com/backend-api",
    credentialLabel: "server-stored ChatGPT login",
  },
};

function managedLaunchDefaults(backend, baseUrl) {
  const behavior = MANAGED_LAUNCH_BACKENDS[String(backend || "")];
  if (!behavior) return null;
  const configuredUrl = String(baseUrl || "");
  return {
    ...behavior,
    usesCanonicalUrl: configuredUrl === behavior.canonicalUrl,
  };
}

function renderLaunchDefaultsPreviewHtml(preview = state.launchDefaultsPreview) {
  const status = preview?.status || "idle";
  if (status === "loading") return '<p class="launch-default-state">Loading configured backend and base URL…</p>';
  if (status === "waiting") return `<p class="launch-default-state">${escapeHtml(preview.message || "Enter the launch location to load defaults.")}</p>`;
  if (status === "error") {
    return `<div class="launch-default-state is-error" role="alert"><strong>Configured defaults could not be loaded.</strong><span>${escapeHtml(preview.error || "Unknown error")}</span><small>Correct the launch location or refresh to try again.</small></div>`;
  }
  if (status !== "ready") return '<p class="launch-default-state">Open this dialog or refresh to inspect configured defaults.</p>';

  const data = preview.data || {};
  const backend = data.configured_model_backend == null ? "Not configured" : String(data.configured_model_backend);
  const baseUrl = data.configured_model_base_url == null ? "Not configured" : String(data.configured_model_base_url);
  const managed = managedLaunchDefaults(data.configured_model_backend, data.configured_model_base_url);
  const managedHtml = managed ? `<div class="launch-managed-behavior">
    <strong>Managed backend behavior</strong>
    <p>${managed.usesCanonicalUrl
      ? `Canonical URL: <code>${escapeHtml(managed.canonicalUrl)}</code>.`
      : `Default canonical URL: <code>${escapeHtml(managed.canonicalUrl)}</code>. The configured base URL above remains authoritative until session creation validates it.`}</p>
    <p>Credentials come from the ${escapeHtml(managed.credentialLabel)} when the session is created; secret values are never returned in this preview.</p>
  </div>` : "";
  return `<dl class="launch-default-values">
    <div><dt>Configured backend</dt><dd>${escapeHtml(backend)}</dd></div>
    <div><dt>Configured base URL</dt><dd>${escapeHtml(baseUrl)}</dd></div>
  </dl>${managedHtml}<p class="launch-default-scope">This preview reports configured backend and base URL only. It does not validate model availability or whether stored or named credentials will work; session creation may still fail.</p>`;
}

function renderLaunchDefaultsPreview() {
  if (!el.launchDefaultsPreview || !el.launchDefaultsBody) return;
  const status = state.launchDefaultsPreview?.status || "idle";
  el.launchDefaultsPreview.dataset.state = status;
  el.launchDefaultsPreview.setAttribute("aria-busy", status === "loading" ? "true" : "false");
  el.launchDefaultsBody.innerHTML = renderLaunchDefaultsPreviewHtml(state.launchDefaultsPreview);
  if (el.refreshLaunchDefaults) el.refreshLaunchDefaults.disabled = status === "loading";
}

const LAUNCH_API_KEY_HELP = "Inherit omits this field; no environment selector explicitly clears it. Managed stored-login backends default to no environment selector.";

function syncLaunchApiKeyMode({ user = false } = {}) {
  if (!el.launchApiKeyMode) return;
  if (user) {
    state.launchApiKeyModeManual = true;
    state.launchApiKeyAutoManaged = false;
  }
  const configuredBackend = state.launchDefaultsPreview?.status === "ready"
    ? state.launchDefaultsPreview.data?.configured_model_backend
    : null;
  const effectiveBackend = String(el.launchBackend?.value || configuredBackend || "");
  const managedDefaults = MANAGED_LAUNCH_BACKENDS[effectiveBackend] || null;
  if (!user && !state.launchApiKeyModeManual && managedDefaults && el.launchApiKeyMode.value === "inherit") {
    el.launchApiKeyMode.value = "none";
    state.launchApiKeyAutoManaged = true;
  } else if (!user && state.launchApiKeyAutoManaged && !managedDefaults) {
    el.launchApiKeyMode.value = "inherit";
    state.launchApiKeyAutoManaged = false;
  }
  const named = el.launchApiKeyMode.value === "named";
  if (el.launchApiKeyEnvField) el.launchApiKeyEnvField.hidden = !named;
  el.launchApiKeyEnv.disabled = !named;
  el.launchApiKeyEnv.required = named;
  if (el.launchApiKeyHelp) {
    if (state.launchApiKeyAutoManaged && managedDefaults) {
      el.launchApiKeyHelp.textContent = `No environment selector was selected automatically because ${managedDefaults.credentialLabel} supplies credentials. Choose another mode to override this.`;
    } else if (state.launchApiKeyModeManual && managedDefaults) {
      el.launchApiKeyHelp.textContent = `${LAUNCH_API_KEY_HELP} Your explicit credential mode is preserved for this managed backend.`;
    } else {
      el.launchApiKeyHelp.textContent = LAUNCH_API_KEY_HELP;
    }
  }
}

function buildLaunchSessionRequest(values) {
  const mode = String(values?.mode || "local");
  if (!["local", "sandbox", "ssh"].includes(mode)) throw new Error(`Unsupported execution mode: ${mode}`);
  const body = {};
  const cwd = String(values?.cwd || "").trim();
  if (mode === "ssh") {
    const sshHost = String(values?.ssh_host || "").trim();
    if (!sshHost) throw new Error("SSH host is required for remote execution");
    body.cwd = cwd || "~";
    body.ssh_host = sshHost;
  } else if (cwd) body.cwd = cwd;

  for (const key of ["backend", "model", "base_url"]) {
    const value = String(values?.[key] || "").trim();
    if (value) body[key] = value;
  }

  const rawCompactionThreshold = String(values?.orchestrator_compaction_threshold ?? "").trim();
  if (rawCompactionThreshold) {
    body.orchestrator_compaction_threshold = parseCompactionThreshold(rawCompactionThreshold);
  }

  const reasoningMode = String(values?.reasoning_mode || "inherit");
  if (reasoningMode === "unset") body.reasoning_effort = null;
  else if (reasoningMode !== "inherit") {
    if (!["none", "minimal", "low", "medium", "high", "xhigh"].includes(reasoningMode)) {
      throw new Error(`Unsupported reasoning mode: ${reasoningMode}`);
    }
    body.reasoning_effort = reasoningMode;
  }

  const apiKeyMode = String(values?.api_key_mode || "inherit");
  if (apiKeyMode === "none") body.api_key_env = null;
  else if (apiKeyMode === "named") {
    const selector = String(values?.api_key_env || "").trim();
    if (!selector) throw new Error("Enter an API key environment variable name");
    body.api_key_env = selector;
  } else if (apiKeyMode !== "inherit") throw new Error(`Unsupported API key mode: ${apiKeyMode}`);

  const headerText = String(values?.extra_headers || "").trim();
  if (headerText) {
    const headers = serializeSettingsHeaders(headerText);
    body.extra_headers = Object.keys(headers).length ? headers : null;
  }

  if (mode === "sandbox") {
    const sandbox = values?.sandbox || {};
    body.sandbox = {
      enabled: true,
      no_mount_cwd: Boolean(sandbox.no_mount_cwd),
      image: String(sandbox.image || "").trim() || null,
      gpus: String(sandbox.gpus || "").split(",").map((value) => value.trim()).filter(Boolean),
      workdir: String(sandbox.workdir || "").trim() || null,
      shm_size: String(sandbox.shm_size || "").trim() || null,
      mounts: String(sandbox.mounts || "").split(",").map((value) => value.trim()).filter(Boolean),
      mounts_ro: [],
    };
  }
  return body;
}

function upsertCreatedSession(snapshot, request = {}) {
  const sessionId = String(snapshot?.metadata?.session_id || "");
  if (!sessionId) return null;
  const metadata = snapshot?.metadata || {};
  const summary = (snapshot?.sessions || []).find((entry) => entry?.session_id === sessionId) || {
    session_id: sessionId,
    cwd: metadata.cwd || request.cwd || "",
    model: metadata.model || request.model || "",
    backend: metadata.backend || request.backend || "",
    model_config_error: null,
    visible_message_count: (snapshot?.messages || []).filter((message) => message?.role !== "system").length,
    last_user_prompt: null,
    sandboxed: Boolean(request?.sandbox?.enabled || (metadata.sandbox_status && metadata.sandbox_status !== "off")),
    ssh_host: request.ssh_host || null,
    title: null,
    pinned: false,
    sort_order: 0,
    presentation_version: 0,
    created_at: "",
    updated_at: "",
  };
  const entry = { summary, active: true, active_run: snapshot?.active_run || null, workspace_diff: null };
  const index = state.sessions.findIndex((item) => item.summary.session_id === sessionId);
  if (index >= 0) state.sessions.splice(index, 1, entry);
  else state.sessions.push(entry);
  return entry;
}

async function createSession(event) {
  event.preventDefault();
  const form = new FormData(el.launchForm);
  let body;
  try {
    body = buildLaunchSessionRequest({
      mode: form.get("execution_mode") || "local",
      cwd: el.launchCwd.value,
      ssh_host: el.launchSshHost.value,
      backend: el.launchBackend.value,
      reasoning_mode: el.launchEffort.value,
      model: el.launchModel.value,
      base_url: el.launchBaseUrl.value,
      orchestrator_compaction_threshold: el.launchCompactionThreshold?.value ?? "",
      api_key_mode: el.launchApiKeyMode.value,
      api_key_env: el.launchApiKeyEnv.value,
      extra_headers: el.launchExtraHeaders.value,
      sandbox: {
        no_mount_cwd: el.sandboxNoMount.checked,
        image: el.sandboxImage.value,
        gpus: el.sandboxGpu.value,
        workdir: el.sandboxWorkdir.value,
        shm_size: el.sandboxShm.value,
        mounts: el.sandboxMounts.value,
      },
    });
  } catch (error) {
    setLaunchStatus(error.message, true);
    return;
  }
  setLaunchStatus("Creating…");
  const submit = el.launchForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const snapshot = await apiPost("/sessions", body);
    const sessionId = snapshot.metadata.session_id;
    upsertCreatedSession(snapshot, body);
    acceptSnapshot(sessionId, snapshot);
    const initialPrompt = el.initialPrompt.value.trim();
    el.launchDialog.close();
    el.launchForm.reset();
    resetLaunchDraftState();
    syncLaunchExecutionFields("local");
    state.launchDefaultsPreview = { status: "idle", data: null, error: "", request: null };
    syncLaunchApiKeyMode();
    renderLaunchDefaultsPreview();
    openSession(sessionId, true, { fetchSnapshot: false });
    if (initialPrompt) {
      state.composerDrafts.set(sessionId, initialPrompt);
      el.promptInput.value = initialPrompt;
      el.commandComposer.requestSubmit();
    }
    await loadSessions({ workspaceStats: true, preserveSessionId: sessionId });
  } catch (error) { setLaunchStatus(error.message, true); }
  finally { submit.disabled = false; }
}

function setLaunchStatus(message, error = false) {
  el.launchStatus.textContent = message;
  el.launchStatus.classList.toggle("is-error", error);
}

function handleGlobalKeydown(event) {
  if (event.key === "Escape" && state.sessionReorder) {
    event.preventDefault();
    cancelSessionReorder();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && state.currentId) {
    event.preventDefault();
    el.promptInput.focus();
  }
  if (event.key === "Escape" && !el.utilityDrawer.hidden) closeDrawer();
  else if (event.key === "Escape" && state.focusView) closeFocusView();
}

function showToast(message, error = false) {
  window.clearTimeout(state.statusTimer);
  const target = el.sessionWorkspace.hidden ? el.pickerNavStatus : el.sessionNavStatus;
  const inactive = target === el.sessionNavStatus ? el.pickerNavStatus : el.sessionNavStatus;
  inactive.hidden = true;
  inactive.textContent = "";
  target.textContent = message;
  target.title = message;
  target.classList.toggle("is-error", error);
  target.hidden = false;
  state.statusTimer = window.setTimeout(() => {
    target.hidden = true;
    target.textContent = "";
    target.removeAttribute("title");
  }, error ? 5_500 : 2_500);
}

function displaySessionTitle(summary) {
  const title = String(summary?.title || "").trim();
  return title || shortId(summary?.session_id || "session");
}

function shortId(value) { return String(value).split("-")[0] || String(value); }
function basename(path) { return String(path || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(path || ""); }
function shortModel(model) { const value = String(model || "—"); return value.length > 24 ? `${value.slice(0, 21)}…` : value; }
function formatNumber(value) {
  const number = Number(value || 0);
  if (!number) return "—";
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)}m`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 10_000 ? 0 : 1)}k`;
  return String(number);
}

function formatTokenCount(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return "0";
  return formatNumber(number);
}

function formatRuntime(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "00:00:00";
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (part) => String(part).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatDuration(value) {
  if (value === null || value === undefined) return null;
  return formatRuntime(value);
}

function backendOptions(selected) {
  const values = ["openai-responses", "chatgpt-codex-responses", "anthropic-messages", "deepseek-chat", "fireworks-chat", "together-chat", "arcee-auth", "arcee-api"];
  const missing = selected === null || selected === undefined;
  const raw = missing ? "" : String(selected);
  const options = [];
  if (missing) {
    options.push('<option value="" selected disabled>select a backend to repair</option>');
  } else if (!values.includes(raw)) {
    const label = raw || "empty value";
    options.push(`<option value="${escapeAttr(raw)}" selected>${escapeHtml(label)} (unsupported — select a replacement)</option>`);
  }
  options.push(...values.map((value) => `<option value="${value}"${value === raw ? " selected" : ""}>${value}</option>`));
  return options.join("");
}

function effortOptions(selected) {
  const values = [
    ["__unset__", "unset (backend default)"],
    ["none", "none"],
    ["minimal", "minimal"],
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
    ["xhigh", "xhigh"],
  ];
  const raw = selected === null || selected === undefined ? "__unset__" : String(selected);
  const options = [];
  if (!values.some(([value]) => value === raw)) {
    const label = raw || "empty value";
    options.push(`<option value="${escapeAttr(raw)}" selected>${escapeHtml(label)} (unsupported — select a replacement)</option>`);
  }
  options.push(...values.map(([value, label]) => `<option value="${value}"${value === raw ? " selected" : ""}>${label}</option>`));
  return options.join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function escapeAttr(value) { return escapeHtml(value); }
function cssEscape(value) { return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }
