const state = {
  store: null,
  sessions: [],
  snapshots: new Map(),
  snapshotLoadGenerationBySession: new Map(),
  selectedId: null,
  eventsBySession: new Map(),
  activeThreadsBySession: new Map(),
  attentionSessions: new Set(),
  activeRunsBySession: new Map(),
  terminalRunsBySession: new Map(),
  submittingRunsBySession: new Set(),
  submittingRunTimersBySession: new Map(),
  runStartedAtBySession: new Map(),
  liveTimerInterval: null,
  eventSource: null,
  lastSequence: new Map(),
  activeTab: "chat",
  mobileDetailOpen: false,
  inspectorFullscreen: false,
  scrollChatToBottom: false,
  waitingLife: null,
  workspaceSelectedPathBySession: new Map(),
  workspaceDiffEntries: new Map(),
  workspaceDiffRequestSeq: 0,
  expandedThreadNamesBySession: new Map(),
  renderRafId: null,
  renderSessionsPending: false,
  renderMobilePending: false,
  renderInspectorPending: false,
  sessionsPollTimer: null,
  sessionsLoadPromise: null,
  sessionsLoadIncludesWorkspaceStats: false,
  sessionsLoadQueuedOptions: null,
  sessionsLoadQueuedPromise: null,
  sessionsLoadGeneration: 0,
  lastSessionsDigest: "",
  lastSelectedSessionDigest: "",
  lastWorkspaceStatsRefresh: 0,
  transcriptRenderedSessionId: null,
  transcriptRenderedSignature: "",
  pendingDeleteSessionId: null,
  renameSessionId: null,
  renameDialogGeneration: 0,
  renameSubmission: null,
  renameReturnFocus: null,
  presentationMutations: new Set(),
  sessionReorder: null,
  deferredSessionLoadOptions: null,
  renderSessionsDeferred: false,
  pendingSessionFocus: null,
  suppressSessionClickUntil: 0,
  suppressSessionClickSessionId: null,
  paneRatio: 0.5,
  paneResize: null,
  paneDesktopMedia: null,
};

const el = {};

const WORKSPACE_DIFF_STAGE = "all";
const WORKSPACE_DIFF_CONTEXT = 3;
const WORKSPACE_FILE_LIMIT = 80;
const SESSION_POLL_INTERVAL_MS = 5000;
const SESSION_WORKSPACE_STATS_INTERVAL_MS = 30000;
const REORDER_DRAG_THRESHOLD_PX = 6;
const SESSION_TITLE_MAX_CHARS = 120;
const PANE_DESKTOP_QUERY = "(min-width: 1180px)";
const PANE_BOARD_MIN_PX = 340;
const PANE_INSPECTOR_MIN_PX = 420;
const PANE_KEYBOARD_STEP = 0.02;

const SAFE_MARKDOWN_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const MARKDOWN_ALLOWED_TAGS = [
  "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "li", "ol", "p", "pre", "s", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
];
const MARKDOWN_ALLOWED_ATTR = ["class", "href", "rel", "start", "target"];
const MARKDOWN_FORBID_TAGS = ["base", "button", "embed", "form", "iframe", "img", "input", "link", "math", "meta", "object", "script", "select", "style", "svg", "textarea"];
const MARKDOWN_FORBID_ATTR = ["id", "name", "src", "srcdoc", "style"];

let markdownRenderer = null;

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  boot();
});

function bindElements() {
  for (const id of [
    "storePath",
    "appShell",
    "launchOverlay",
    "closeLaunch",
    "launchForm",
    "launchSshHost",
    "launchCwdField",
    "launchCwd",
    "launchBackend",
    "launchEffort",
    "launchModel",
    "launchBaseUrl",
    "launchApiKeyEnv",
    "launchExtraHeaders",
    "sandboxFields",
    "sandboxEnabled",
    "sandboxNoMount",
    "sandboxImage",
    "sandboxGpu",
    "sandboxWorkdir",
    "sandboxShm",
    "sandboxMounts",
    "initialPrompt",
    "launchStatus",
    "sessionGrid",
    "reorderLiveRegion",
    "sessionBoard",
    "sessionInspector",
    "paneSplitter",
    "paneSeparator",
    "inspectorTitle",
    "inspectorMeta",
    "cancelRun",
    "mobileBack",
    "tabs",
    "snapModel",
    "snapBackend",
    "snapMessages",
    "snapRun",
    "snapTokens",
    "snapContext",
    "transcript",
    "promptForm",
    "promptInput",
    "eventStreamStatus",
    "eventLog",
    "threadsView",
    "worksetsView",
    "workspaceView",
    "deleteOverlay",
    "closeDelete",
    "confirmDelete",
    "deleteConfirmText",
    "deleteStatus",
    "deleteSessionBtn",
    "renameSessionBtn",
    "renameOverlay",
    "closeRename",
    "renameForm",
    "renameTitleInput",
    "confirmRename",
    "renameStatus",
    "fullscreenBtn",
    "fullscreenEnterIcon",
    "fullscreenExitIcon",
    "settingsBtn",
    "settingsOverlay",
    "closeSettings",
    "settingsForm",
    "settingsStatus",
    "settingsBackend",
    "settingsEffort",
    "settingsModel",
    "settingsBaseUrl",
    "settingsApiKeyEnv",
    "settingsExtraHeaders",
  ]) {
    el[id] = document.getElementById(id);
  }
}

function bindEvents() {
  el.launchForm.addEventListener("submit", createSession);
  el.launchSshHost.addEventListener("input", renderLaunchHostFields);
  el.promptForm.addEventListener("submit", submitPrompt);
  el.promptInput.addEventListener("keydown", handlePromptKeydown);
  el.cancelRun.addEventListener("click", cancelActiveRun);
  el.deleteSessionBtn.addEventListener("click", () => {
    if (state.selectedId) deleteSession(state.selectedId);
  });
  el.renameSessionBtn.addEventListener("click", showRenameOverlay);
  el.closeRename.addEventListener("click", () => hideRenameOverlay(true));
  el.renameOverlay.addEventListener("click", (event) => {
    if (event.target === el.renameOverlay) hideRenameOverlay(true);
  });
  el.renameOverlay.addEventListener("keydown", containRenameDialogFocus);
  el.renameForm.addEventListener("submit", renameSelectedSession);
  el.fullscreenBtn.addEventListener("click", toggleInspectorFullscreen);
  el.settingsBtn.addEventListener("click", showSettingsOverlay);
  el.closeSettings.addEventListener("click", hideSettingsOverlay);
  el.settingsOverlay.addEventListener("click", (event) => {
    if (event.target === el.settingsOverlay) hideSettingsOverlay();
  });
  el.settingsForm.addEventListener("submit", updateSessionConfig);
  el.mobileBack.addEventListener("click", showMobileSessions);
  el.closeLaunch.addEventListener("click", hideLaunchOverlay);
  el.launchOverlay.addEventListener("click", (event) => {
    if (event.target === el.launchOverlay) hideLaunchOverlay();
  });
  el.closeDelete.addEventListener("click", hideDeleteOverlay);
  el.deleteOverlay.addEventListener("click", (event) => {
    if (event.target === el.deleteOverlay) hideDeleteOverlay();
  });
  el.confirmDelete.addEventListener("click", confirmDeleteSession);

  el.sessionGrid.addEventListener("click", handleSessionGridClick);
  el.sessionGrid.addEventListener("keydown", handleSessionGridKeydown);
  el.sessionGrid.addEventListener("pointerdown", handleSessionPointerDown);
  el.sessionGrid.addEventListener("dragstart", (event) => {
    if (event.target.closest(".reorder-handle")) event.preventDefault();
  });
  document.addEventListener("pointermove", handleSessionPointerMove);
  document.addEventListener("pointerup", handleSessionPointerUp);
  document.addEventListener("pointercancel", handleSessionPointerCancel);
  el.sessionGrid.addEventListener("lostpointercapture", handleSessionLostPointerCapture);
  window.addEventListener("blur", cancelPointerSessionReorder);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") cancelPointerSessionReorder();
  });

  el.paneSeparator.addEventListener("pointerdown", handlePanePointerDown);
  el.paneSeparator.addEventListener("keydown", handlePaneKeydown);
  document.addEventListener("pointermove", handlePanePointerMove);
  document.addEventListener("pointerup", handlePanePointerUp);
  document.addEventListener("pointercancel", handlePanePointerCancel);
  state.paneDesktopMedia = window.matchMedia(PANE_DESKTOP_QUERY);
  const handlePaneMediaChange = () => {
    cancelPaneResize(true);
    syncPaneSplitter();
  };
  if (typeof state.paneDesktopMedia.addEventListener === "function") {
    state.paneDesktopMedia.addEventListener("change", handlePaneMediaChange);
  } else if (typeof state.paneDesktopMedia.addListener === "function") {
    state.paneDesktopMedia.addListener(handlePaneMediaChange);
  }
  window.addEventListener("resize", () => {
    cancelPaneResize(true);
    syncPaneSplitter();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (cancelSessionReorder()) {
      event.preventDefault();
      return;
    }
    if (!el.renameOverlay.hidden) {
      hideRenameOverlay(true);
      return;
    }
    if (!el.settingsOverlay.hidden) {
      hideSettingsOverlay();
      return;
    }
    if (!el.deleteOverlay.hidden) {
      hideDeleteOverlay();
      return;
    }
    if (!el.launchOverlay.hidden) {
      hideLaunchOverlay();
      return;
    }
    if (state.inspectorFullscreen) setInspectorFullscreen(false);
  });

  el.tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tab]");
    if (!button) return;
    state.activeTab = button.dataset.tab;
    if (state.activeTab === "workspace") requestWorkspaceStatsRefresh();
    requestInspectorRender();
  });

  el.workspaceView.addEventListener("click", handleWorkspaceFileClick);
  el.threadsView.addEventListener("click", handleThreadClick);
}

async function boot() {
  syncPaneSplitter();
  try {
    state.store = await apiGet("/store");
    const storePath = state.store.store_path || "--";
    el.storePath.textContent = storePath;
    el.storePath.title = storePath;
    el.launchCwd.value = state.store.root_cwd;
  } catch (error) {
    setLaunchStatus(error.message, true);
  }

  renderLaunchHostFields();
  await loadSessions({ workspaceStats: true, forceRender: true, forceFetch: true });
  scheduleSessionPoll();
}

async function apiGet(path) {
  const response = await fetch(path);
  return readJson(response);
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson(response);
}

async function apiPut(path, body) {
  const response = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return readJson(response);
}

async function apiDelete(path) {
  const response = await fetch(path, { method: "DELETE" });
  return readJson(response);
}

async function readJson(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = {};
  }
  if (!response.ok) {
    const error = new Error(payload.error || `${response.status} ${response.statusText}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function loadSessions(options = {}) {
  const loadOptions = normalizeSessionLoadOptions(options);
  if (sessionReorderInProgress()) {
    state.deferredSessionLoadOptions = mergeSessionLoadOptions(
      state.deferredSessionLoadOptions,
      loadOptions,
    );
    return null;
  }
  if (state.sessionsLoadPromise) {
    const currentIncludesRequestedStats = !loadOptions.workspaceStats || state.sessionsLoadIncludesWorkspaceStats;
    if (!loadOptions.forceFetch && currentIncludesRequestedStats) return joinCurrentSessionLoad(loadOptions);
    state.sessionsLoadQueuedOptions = mergeSessionLoadOptions(state.sessionsLoadQueuedOptions, loadOptions);
    if (!state.sessionsLoadQueuedPromise) {
      state.sessionsLoadQueuedPromise = state.sessionsLoadPromise.then(() => {
        const queuedOptions = state.sessionsLoadQueuedOptions;
        state.sessionsLoadQueuedOptions = null;
        state.sessionsLoadQueuedPromise = null;
        return queuedOptions ? loadSessions(queuedOptions) : null;
      });
    }
    return state.sessionsLoadQueuedPromise;
  }

  state.sessionsLoadIncludesWorkspaceStats = loadOptions.workspaceStats;
  const loadGeneration = state.sessionsLoadGeneration;
  state.sessionsLoadPromise = loadSessionsOnce(loadOptions, loadGeneration);
  try {
    return await state.sessionsLoadPromise;
  } finally {
    state.sessionsLoadPromise = null;
    state.sessionsLoadIncludesWorkspaceStats = false;
  }
}

function normalizeSessionLoadOptions(options = {}) {
  return {
    workspaceStats: Boolean(options.workspaceStats),
    forceRender: Boolean(options.forceRender),
    forceFetch: Boolean(options.forceFetch),
    inspector: Boolean(options.inspector),
  };
}

function mergeSessionLoadOptions(left, right) {
  if (!left) return { ...right };
  return {
    workspaceStats: Boolean(left.workspaceStats || right.workspaceStats),
    forceRender: Boolean(left.forceRender || right.forceRender),
    forceFetch: Boolean(left.forceFetch || right.forceFetch),
    inspector: Boolean(left.inspector || right.inspector),
  };
}

function joinCurrentSessionLoad(loadOptions) {
  if (!loadOptions.forceRender && !loadOptions.inspector) return state.sessionsLoadPromise;
  return state.sessionsLoadPromise.then((sessions) => {
    const shell = loadOptions.forceRender;
    requestRender({
      shell: false,
      sessions: shell,
      mobile: shell,
      inspector: loadOptions.inspector || shell,
    });
    return sessions;
  });
}

async function loadSessionsOnce(options, loadGeneration) {
  try {
    const path = options.workspaceStats ? "/sessions?workspace_stats=true" : "/sessions";
    const sessions = await apiGet(path);
    if (loadGeneration !== state.sessionsLoadGeneration) return null;
    preserveSessionWorkspaceStats(sessions);
    sanitizeSessionListActiveRuns(sessions);
    updateSessionActivity(sessions);
    if (state.runStartedAtBySession.size > 0) {
      startLiveTimer();
    } else {
      stopLiveTimer();
    }

    if (options.workspaceStats) state.lastWorkspaceStatsRefresh = Date.now();
    const previousSelectedId = state.selectedId;
    const selectedSessionMissing = Boolean(
      previousSelectedId
      && !sessions.some((entry) => entry.summary.session_id === previousSelectedId),
    );
    if (selectedSessionMissing) {
      clearSessionClientState(previousSelectedId);
      if (state.eventSource) {
        state.eventSource.close();
        state.eventSource = null;
      }
      state.selectedId = null;
      state.transcriptRenderedSessionId = null;
      state.transcriptRenderedSignature = "";
    }
    if (!state.selectedId && sessions.length > 0) state.selectedId = sessions[0].summary.session_id;
    if (selectedSessionMissing && !state.selectedId) {
      state.mobileDetailOpen = false;
      setInspectorFullscreen(false);
    }

    const nextSessionsDigest = sessionListRenderDigest(sessions);
    const selectedEntry = sessions.find((entry) => entry.summary.session_id === state.selectedId) || null;
    const nextSelectedDigest = sessionEntryRenderDigest(selectedEntry);
    const sessionsChanged = nextSessionsDigest !== state.lastSessionsDigest;
    const selectedChanged = nextSelectedDigest !== state.lastSelectedSessionDigest;
    state.sessions = sessions;
    state.lastSessionsDigest = nextSessionsDigest;
    state.lastSelectedSessionDigest = nextSelectedDigest;

    const needsSelectedSnapshot = Boolean(state.selectedId && !state.snapshots.has(state.selectedId));
    const shellChanged = options.forceRender || sessionsChanged;
    const inspectorChanged = options.inspector || selectedChanged || options.forceRender || needsSelectedSnapshot;
    if (shellChanged || inspectorChanged) {
      requestRender({
        shell: false,
        sessions: shellChanged,
        mobile: shellChanged,
        inspector: inspectorChanged,
      });
    }
    if (state.selectedId && (selectedSessionMissing || needsSelectedSnapshot)) {
      loadSnapshot(state.selectedId, true);
    }
    return sessions;
  } catch (error) {
    setLaunchStatus(error.message, true);
    return null;
  }
}

function preserveSessionWorkspaceStats(sessions) {
  const previousById = new Map(state.sessions.map((entry) => [entry.summary.session_id, entry]));
  for (const entry of sessions) {
    const previous = previousById.get(entry.summary.session_id);
    if (entry.workspace_diff === undefined && previous?.workspace_diff !== undefined) {
      entry.workspace_diff = previous.workspace_diff;
    }
  }
}

function scheduleSessionPoll(delay = SESSION_POLL_INTERVAL_MS) {
  if (state.sessionsPollTimer || typeof setTimeout !== "function") return;
  state.sessionsPollTimer = setTimeout(runSessionPoll, delay);
}

async function runSessionPoll() {
  state.sessionsPollTimer = null;
  try {
    await loadSessions({ workspaceStats: shouldRefreshWorkspaceStats() });
  } finally {
    scheduleSessionPoll();
  }
}

function shouldRefreshWorkspaceStats(now = Date.now()) {
  return !state.lastWorkspaceStatsRefresh || now - state.lastWorkspaceStatsRefresh >= SESSION_WORKSPACE_STATS_INTERVAL_MS;
}

function requestWorkspaceStatsRefresh() {
  loadSessions({ workspaceStats: true, forceRender: true });
}

function sessionListRenderDigest(sessions) {
  return sessionCardListRenderDigest(sessions.map(sessionCardViewModel));
}

function sessionCardListRenderDigest(cards) {
  return cards.map(sessionCardRenderDigest).join("\n");
}

function sessionEntryRenderDigest(entry) {
  return sessionCardRenderDigest(sessionCardViewModel(entry));
}

function sessionCardViewModel(entry) {
  if (!entry) return null;
  const summary = entry.summary || {};
  const sessionId = summary.session_id || "";
  const snapshot = state.snapshots.get(sessionId);
  const workspaceError = snapshot?.workspace?.error || "";
  const diffStats = workspaceDiffStats(snapshot, entry.workspace_diff);
  const cardActive = activeRunCountsForSession(sessionId, entry.active_run);
  const cardSnapshot = {
    ...(snapshot || {}),
    active_run: snapshot?.active_run || entry.active_run,
    messages: snapshot?.messages || [],
  };
  const pendingCount = effectivePendingMessages(sessionId, cardSnapshot).length;
  const promptPreview = latestPendingUserPrompt(sessionId, cardSnapshot)
    || displayPromptFromMessageText(summary.last_user_prompt)
    || "no prompt yet";
  const runActive = activeRunCountsForSession(sessionId, entry.active_run);
  const runStartedAt = runActive
    ? (state.runStartedAtBySession.get(sessionId) || entry.active_run?.started_at_epoch_ms || null)
    : null;
  const snapshotForTiming = state.snapshots.get(sessionId);
  const lastDur = snapshotForTiming?.response_timing?.last_response_duration_ms;
  const runDisplay = runActive
    ? (runStartedAt ? formatRuntime(Date.now() - runStartedAt) : "00:00:00")
    : (lastDur != null ? formatRuntime(lastDur) : "--:--:--");
  return {
    sessionId,
    shortId: shortId(sessionId),
    title: typeof summary.title === "string" ? summary.title : "",
    displayTitle: displaySessionTitle(summary),
    cwd: summary.cwd || "",
    sshHost: summary.ssh_host || "",
    sandboxed: Boolean(summary.sandboxed),
    selected: sessionId === state.selectedId,
    pinned: Boolean(summary.pinned),
    sortOrder: Number(summary.sort_order) || 0,
    presentationVersion: Number(summary.presentation_version) || 0,
    presentationBusy: state.presentationMutations.has(sessionId),
    tone: cardActive ? "" : summary.sandboxed ? "warn" : "",
    errorish: workspaceError && !workspaceError.includes("remote/sandbox-only") ? "errorish" : "",
    statusClass: sessionStatusClass(entry),
    runActive,
    runStartedAt,
    lastDur: lastDur || null,
    runDisplay,
    additions: diffStats.additions,
    deletions: diffStats.deletions,
    promptPreview,
  };
}

function sessionCardRenderDigest(card) {
  if (!card) return "";
  return [
    card.sessionId,
    card.shortId,
    card.title,
    card.displayTitle,
    card.cwd,
    card.sshHost,
    card.sandboxed ? "1" : "0",
    card.selected ? "1" : "0",
    card.pinned ? "1" : "0",
    String(card.sortOrder),
    String(card.presentationVersion),
    card.presentationBusy ? "1" : "0",
    card.tone,
    card.errorish,
    card.statusClass,
    card.runActive ? "1" : "0",
    String(card.runStartedAt || ""),
    String(card.lastDur || ""),
    card.additions,
    card.deletions,
    card.promptPreview,
  ].join("\\x1f");
}

function renderLaunchHostFields() {
  const remote = Boolean(el.launchSshHost.value.trim());
  if (remote && state.store && el.launchCwd.value === state.store.root_cwd) {
    el.launchCwd.value = "~";
  } else if (!remote && state.store && el.launchCwd.value === "~") {
    el.launchCwd.value = state.store.root_cwd;
  }
  setVisible(el.sandboxFields, !remote);
}

function setVisible(element, visible) {
  element.style.display = visible ? "" : "none";
}

async function loadSnapshot(sessionId, openStream = false) {
  if (!sessionId) return null;
  const loadGeneration = state.snapshotLoadGenerationBySession.get(sessionId) || 0;
  try {
    const previousMessageCount = effectiveMessageCount(sessionId);
    const snapshot = await apiGet(`/sessions/${encodeURIComponent(sessionId)}`);
    if (loadGeneration !== (state.snapshotLoadGenerationBySession.get(sessionId) || 0)
      || !sessionEntryById(sessionId)) return null;
    sanitizeSnapshotActiveRun(sessionId, snapshot);
    if (activeRunCountsForSession(sessionId, snapshot.active_run)) {
      clearRunSubmitting(sessionId);
      state.activeRunsBySession.set(sessionId, true);
      if (snapshot.active_run?.started_at_epoch_ms) {
        state.runStartedAtBySession.set(sessionId, snapshot.active_run.started_at_epoch_ms);
      }
    }
    const previousCardDigest = sessionEntryRenderDigest(sessionEntryById(sessionId));
    state.snapshots.set(sessionId, snapshot);
    syncActiveThreadsFromSnapshot(sessionId, snapshot);
    const cardChanged = previousCardDigest !== sessionEntryRenderDigest(sessionEntryById(sessionId));
    if (state.selectedId === sessionId && effectiveMessageCount(sessionId, snapshot) > previousMessageCount) {
      requestChatScrollToBottom();
    }
    if (openStream && state.selectedId === sessionId) openEventStream(sessionId);
    if (state.selectedId === sessionId) {
      if (sessionHasActiveRun(sessionId, snapshot)) {
        startLiveTimer();
      } else if (state.runStartedAtBySession.size === 0) {
        stopLiveTimer();
      }
      requestRender({ shell: false, sessions: cardChanged, inspector: true });
    }
    return snapshot;
  } catch (error) {
    pushLocalEvent("snapshot_error", error.message, sessionId);
    if (state.selectedId === sessionId) requestInspectorRender();
    return null;
  }
}

function selectSession(sessionId) {
  const previousId = state.selectedId;
  if (previousId && previousId !== sessionId) {
    clearSessionAttention(previousId);
  }
  clearSessionAttention(sessionId);
  state.selectedId = sessionId;
  state.activeTab = "chat";
  state.mobileDetailOpen = true;
  state.scrollChatToBottom = true;
  requestRender({ inspector: true });
  focusMobileSessionDetail(sessionId);
  openEventStream(sessionId);
  loadSnapshot(sessionId, false);
}

function focusMobileSessionDetail(sessionId) {
  requestAnimationFrame(() => {
    const mobile = typeof window.matchMedia === "function"
      && window.matchMedia(PANE_DESKTOP_QUERY).matches === false;
    if (!mobile || state.selectedId !== sessionId || !state.mobileDetailOpen) return;
    if (!document.body.classList.contains("detail-open")) return;
    try {
      el.mobileBack.focus({ preventScroll: true });
    } catch (_) {
      el.mobileBack.focus();
    }
  });
}

function showLaunchOverlay() {
  if (!el.launchStatus.classList.contains("error")) {
    setLaunchStatus("", false);
  }
  el.launchOverlay.hidden = false;
  requestAnimationFrame(() => {
    el.launchCwd.focus();
    el.launchCwd.select();
  });
}

function hideLaunchOverlay() {
  el.launchOverlay.hidden = true;
}

function showDeleteOverlay(sessionId) {
  if (!sessionId) return;
  state.pendingDeleteSessionId = sessionId;
  const entry = sessionEntryById(sessionId);
  const label = entry ? displaySessionTitle(entry.summary) : shortId(sessionId);
  el.deleteConfirmText.textContent = `Delete session ${label} (${sessionId})? This permanently removes all threads, episodes, and worksets.`;
  el.deleteStatus.textContent = "";
  el.deleteStatus.classList.remove("error");
  el.deleteOverlay.hidden = false;
}

function hideDeleteOverlay() {
  el.deleteOverlay.hidden = true;
  state.pendingDeleteSessionId = null;
}

function setDeleteStatus(message, error) {
  el.deleteStatus.textContent = message || "";
  el.deleteStatus.classList.toggle("error", Boolean(error));
}

function showSettingsOverlay() {
  const sessionId = state.selectedId;
  if (!sessionId) return;
  const snapshot = state.snapshots.get(sessionId);
  const metadata = snapshot?.metadata;
  if (metadata) {
    el.settingsModel.value = metadata.model || "";
    el.settingsBaseUrl.value = metadata.base_url || "";
    el.settingsBackend.value = metadata.backend || "";
    el.settingsEffort.value = metadata.reasoning_effort || "";
    el.settingsApiKeyEnv.value = metadata.api_key_env || "";
    el.settingsExtraHeaders.value = metadata.extra_headers
      && Object.keys(metadata.extra_headers).length > 0
      ? JSON.stringify(metadata.extra_headers, null, 2)
      : "";
  }
  setSettingsStatus("", false);
  el.settingsOverlay.hidden = false;
}

function hideSettingsOverlay() {
  el.settingsOverlay.hidden = true;
}

function setSettingsStatus(message, error) {
  el.settingsStatus.textContent = message || "";
  el.settingsStatus.classList.toggle("error", Boolean(error));
}

async function updateSessionConfig(event) {
  event.preventDefault();
  const sessionId = state.selectedId;
  if (!sessionId) return;
  setSettingsStatus("saving", false);

  const extraHeadersRaw = el.settingsExtraHeaders.value;
  let extraHeaders = null;
  try {
    extraHeaders = serializeExtraHeaders(extraHeadersRaw);
  } catch (parseError) {
    setSettingsStatus(parseError.message, true);
    return;
  }

  const body = {
    model: nullable(el.settingsModel.value),
    base_url: nullable(el.settingsBaseUrl.value),
    backend: nullable(el.settingsBackend.value),
    reasoning_effort: nullable(el.settingsEffort.value),
    api_key_env: nullable(el.settingsApiKeyEnv.value),
    extra_headers: extraHeaders,
  };

  try {
    const response = await fetch(
      `/sessions/${encodeURIComponent(sessionId)}/config`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      let payload = {};
      try { payload = await response.json(); } catch (_) {}
      throw new Error(payload.error || `${response.status} ${response.statusText}`);
    }
    hideSettingsOverlay();
    // Reconnect SSE and reload snapshot to pick up the new config.
    openEventStream(sessionId);
    await loadSnapshot(sessionId, false);
    await loadSessions({ forceFetch: true });
  } catch (error) {
    setSettingsStatus(error.message, true);
  }
}

function showMobileSessions() {
  setInspectorFullscreen(false);
  state.mobileDetailOpen = false;
  renderMobileMode();
  syncPromptBusy(state.selectedId);
  const target = sessionCardElement(state.selectedId)?.querySelector("[data-action='select-session']")
    || el.sessionGrid.querySelector("[data-action='new-session']");
  if (target) {
    try {
      target.focus({ preventScroll: true });
    } catch (_) {
      target.focus();
    }
  }
}

async function createSession(event) {
  event.preventDefault();
  let extraHeaders = null;
  try {
    extraHeaders = serializeExtraHeaders(el.launchExtraHeaders.value);
  } catch (parseError) {
    setLaunchStatus(parseError.message, true);
    return;
  }

  setLaunchStatus("launching", false);
  const initialPrompt = el.initialPrompt.value.trim();
  const sshHost = nullable(el.launchSshHost.value);
  const body = {
    cwd: sshHost ? (nullable(el.launchCwd.value) || "~") : nullable(el.launchCwd.value),
    ssh_host: sshHost,
    model: nullable(el.launchModel.value),
    base_url: nullable(el.launchBaseUrl.value),
    backend: nullable(el.launchBackend.value),
    reasoning_effort: nullable(el.launchEffort.value),
    api_key_env: nullable(el.launchApiKeyEnv.value),
    extra_headers: extraHeaders,
  };
  if (!sshHost) {
    body.sandbox = {
      enabled: el.sandboxEnabled.checked,
      no_mount_cwd: el.sandboxNoMount.checked,
      image: nullable(el.sandboxImage.value),
      gpus: csv(el.sandboxGpu.value),
      workdir: nullable(el.sandboxWorkdir.value),
      shm_size: nullable(el.sandboxShm.value),
      mounts: csv(el.sandboxMounts.value),
      mounts_ro: [],
    };
  }

  try {
    const snapshot = await apiPost("/sessions", body);
    const sessionId = snapshot.metadata.session_id;
    state.snapshots.set(sessionId, snapshot);
    state.selectedId = sessionId;
    await loadSessions({ forceFetch: true, workspaceStats: true });
    hideLaunchOverlay();
    selectSession(sessionId);
    setLaunchStatus(`launched ${shortId(sessionId)}`, false);
    if (initialPrompt) {
      const hadAttention = state.attentionSessions.has(sessionId);
      markRunSubmitting(sessionId);
      clearSessionAttention(sessionId);
      requestChatScrollToBottom();
      requestRender({ shell: false, sessions: hadAttention, inspector: true });
      try {
        await apiPost(`/sessions/${encodeURIComponent(sessionId)}/runs`, { prompt: initialPrompt });
        scheduleRunSubmittingGrace(sessionId);
        el.initialPrompt.value = "";
        setLaunchStatus(`running ${shortId(sessionId)}`, false);
        await loadSnapshot(sessionId, false);
      } catch (error) {
        clearRunSubmitting(sessionId);
        state.activeRunsBySession.set(sessionId, false);
        requestInspectorRender();
        throw error;
      }
    }
  } catch (error) {
    setLaunchStatus(error.message, true);
  }
}

async function submitPrompt(event) {
  event.preventDefault();
  const sessionId = state.selectedId;
  const prompt = el.promptInput.value.trim();
  if (!sessionId || !prompt) return;
  if (sessionHasActiveRun(sessionId)) {
    syncPromptBusy(sessionId);
    return;
  }

  const hadAttention = state.attentionSessions.has(sessionId);
  markRunSubmitting(sessionId);
  clearSessionAttention(sessionId);
  el.promptInput.value = "";
  requestChatScrollToBottom();
  requestRender({ shell: false, sessions: hadAttention, inspector: true });

  try {
    const result = await apiPost(`/sessions/${encodeURIComponent(sessionId)}/runs`, { prompt });
    scheduleRunSubmittingGrace(sessionId);
    pushLocalEvent("submit", `${result.display_prompt} -> ${shortId(result.run_id)}`, sessionId);
    await loadSessions({ forceFetch: true });
    await loadSnapshot(sessionId, false);
    requestInspectorRender();
  } catch (error) {
    clearRunSubmitting(sessionId);
    state.activeRunsBySession.set(sessionId, false);
    stopWaitingLife();
    pushLocalEvent("submit_error", error.message, sessionId);
    requestInspectorRender();
  }
}

function handlePromptKeydown(event) {
  if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
  event.preventDefault();
  el.promptForm.requestSubmit();
}

async function cancelActiveRun() {
  const sessionId = state.selectedId;
  if (!sessionId) return;
  try {
    await apiPost(`/sessions/${encodeURIComponent(sessionId)}/cancel-active-run`, {});
    pushLocalEvent("cancel", "requested", sessionId);
    await loadSessions({ forceFetch: true });
    await loadSnapshot(sessionId, false);
  } catch (error) {
    pushLocalEvent("cancel_error", error.message, sessionId);
  }
}

async function deleteSession(sessionId) {
  if (!sessionId) return;
  showDeleteOverlay(sessionId);
}

function clearSessionClientState(sessionId) {
  state.snapshotLoadGenerationBySession.set(
    sessionId,
    (state.snapshotLoadGenerationBySession.get(sessionId) || 0) + 1,
  );
  state.snapshots.delete(sessionId);
  state.eventsBySession.delete(sessionId);
  state.activeThreadsBySession.delete(sessionId);
  state.attentionSessions.delete(sessionId);
  state.activeRunsBySession.delete(sessionId);
  state.terminalRunsBySession.delete(sessionId);
  clearRunSubmitting(sessionId);
  state.runStartedAtBySession.delete(sessionId);
  state.lastSequence.delete(sessionId);
  state.workspaceSelectedPathBySession.delete(sessionId);
  for (const entryKey of state.workspaceDiffEntries.keys()) {
    const [entrySessionId] = JSON.parse(entryKey);
    if (entrySessionId === sessionId) state.workspaceDiffEntries.delete(entryKey);
  }
  state.expandedThreadNamesBySession.delete(sessionId);
  state.presentationMutations.delete(sessionId);
  if (state.renameSessionId === sessionId) hideRenameOverlay(false);
}

async function confirmDeleteSession() {
  const sessionId = state.pendingDeleteSessionId;
  if (!sessionId) return;
  setDeleteStatus("deleting", false);
  el.confirmDelete.disabled = true;
  try {
    await apiDelete(`/sessions/${encodeURIComponent(sessionId)}`);
    clearSessionClientState(sessionId);
    // If the deleted session was selected, pick a new one or clear
    if (state.selectedId === sessionId) {
      if (state.eventSource) {
        state.eventSource.close();
        state.eventSource = null;
      }
      state.selectedId = null;
      state.transcriptRenderedSessionId = null;
      state.transcriptRenderedSignature = "";
    }
    hideDeleteOverlay();
    await loadSessions({ forceFetch: true, forceRender: true });
    if (state.selectedId) {
      selectSession(state.selectedId);
    } else {
      state.mobileDetailOpen = false;
      setInspectorFullscreen(false);
      requestRender({ mobile: true, inspector: true });
    }
  } catch (error) {
    pushLocalEvent("delete_error", error.message, sessionId);
    setDeleteStatus(error.message, true);
  } finally {
    el.confirmDelete.disabled = false;
  }
}

function clearSessionSequenceEpoch(sessionId) {
  state.eventsBySession.delete(sessionId);
  state.activeThreadsBySession.delete(sessionId);
  state.expandedThreadNamesBySession.delete(sessionId);
  state.terminalRunsBySession.delete(sessionId);
  requestRender({
    shell: false,
    sessions: true,
    inspector: state.selectedId === sessionId,
  });
}

function openEventStream(sessionId, options = {}) {
  if (!sessionId) return;
  if (state.eventSource) state.eventSource.close();
  const storedPrior = state.lastSequence.get(sessionId);
  const requestedPriorSequence = options.replayFromBeginning
    ? null
    : (Number.isFinite(storedPrior) ? storedPrior : null);
  const params = requestedPriorSequence !== null
    ? `?after_sequence_id=${requestedPriorSequence}&limit=256`
    : "?limit=256";
  const source = new EventSource(`/sessions/${encodeURIComponent(sessionId)}/events/stream${params}`);
  state.eventSource = source;
  let observationFloor = null;

  source.addEventListener("replay_boundary", (event) => {
    if (state.eventSource !== source) return;
    try {
      const payload = JSON.parse(event.data);
      const boundary = Number(payload.replay_boundary_sequence_id);
      if (!Number.isSafeInteger(boundary) || boundary < 0) throw new Error("invalid replay boundary");
      const observedPrior = state.lastSequence.get(sessionId);
      const priorAtBoundary = Number.isFinite(observedPrior) ? observedPrior : requestedPriorSequence;
      if (priorAtBoundary === null) {
        observationFloor = boundary;
      } else if (priorAtBoundary <= boundary) {
        observationFloor = priorAtBoundary;
      } else {
        clearSessionSequenceEpoch(sessionId);
        state.lastSequence.delete(sessionId);
        if (requestedPriorSequence !== null) {
          // Native EventSource reconnects retain their URL, so replace a stale
          // cursor-bearing source before hydrating the new sequence epoch.
          openEventStream(sessionId, { replayFromBeginning: true });
          return;
        }
        // This source already requests the full replay; keep it so repeated
        // epoch resets cannot create a cursor-free reconnect loop.
        observationFloor = boundary;
      }
    } catch (error) {
      const observedPrior = state.lastSequence.get(sessionId);
      observationFloor = Number.isFinite(observedPrior)
        ? observedPrior
        : (requestedPriorSequence ?? Number.POSITIVE_INFINITY);
      pushLocalEvent("stream", error.message || "invalid replay boundary", sessionId);
    }
  });

  source.addEventListener("session_event", (event) => {
    if (state.eventSource !== source) return;
    let envelope;
    try {
      envelope = JSON.parse(event.data);
    } catch (_) {
      pushLocalEvent("stream", "invalid session event", sessionId);
      return;
    }

    const sequenceId = Number(envelope.sequence_id);
    if (!Number.isSafeInteger(sequenceId) || sequenceId < 0) return;
    const lastSequence = state.lastSequence.get(sessionId);
    if (Number.isFinite(lastSequence) && sequenceId <= lastSequence) return;

    state.lastSequence.set(sessionId, sequenceId);
    pushEnvelopeForSession(sessionId, envelope);
    const historicalHydration = observationFloor === null || sequenceId <= observationFloor;
    const runStarted = !historicalHydration && isRunStartedSessionEvent(envelope);
    const terminalRun = !historicalHydration && isTerminalSessionEvent(envelope);
    if (runStarted) {
      handleRunStarted(sessionId, envelope);
      loadSessions({ forceFetch: true });
    }
    if (terminalRun) {
      handleTerminalRun(sessionId, envelope);
      loadSessions({ forceFetch: true });
    }
    if (!historicalHydration && shouldRefreshSnapshot(envelope)) {
      loadSnapshot(sessionId, false);
    }
    requestRender({
      shell: false,
      sessions: runStarted || terminalRun,
      inspector: true,
    });
  });

  source.addEventListener("replay_gap", (event) => {
    if (state.eventSource !== source) return;
    pushLocalEvent("replay_gap", event.data, sessionId);
  });

  source.addEventListener("lagged", (event) => {
    if (state.eventSource !== source) return;
    pushLocalEvent("lagged", event.data, sessionId);
  });

  source.onerror = () => {
    if (state.eventSource !== source) return;
    pushLocalEvent("stream", "connection interrupted", sessionId);
  };
}

function isRunStartedSessionEvent(envelope) {
  return envelope.event?.type === "run_started";
}

function isTerminalSessionEvent(envelope) {
  const type = envelope.event?.type;
  return type === "run_completed" || type === "run_failed";
}

function isSnapshotSavedSessionEvent(envelope) {
  return envelope.event?.type === "snapshot_saved";
}

function shouldRefreshSnapshot(envelope) {
  if (isRunStartedSessionEvent(envelope) || isTerminalSessionEvent(envelope) || isSnapshotSavedSessionEvent(envelope)) return true;
  const event = agentEvent(envelope);
  return event?.type === "thread_started" || event?.type === "thread_finished";
}

function activeRunFromStartedEnvelope(envelope) {
  const runId = runIdFromEnvelope(envelope);
  const submitted = envelope.event?.submitted_user_message || null;
  return {
    run_id: runId,
    client_id: envelope.client_id || submitted?.client_id || null,
    prompt_preview: envelope.event?.prompt_preview || "",
    submitted_user_message: submitted ? {
      ...submitted,
      run_id: submitted.run_id || runId,
      client_id: submitted.client_id || envelope.client_id || null,
    } : null,
    started_at_epoch_ms: envelope.event?.started_at_epoch_ms || Date.now(),
  };
}

function terminalRunIdForSession(sessionId, envelope) {
  return runIdFromEnvelope(envelope)
    || activeRunId(state.snapshots.get(sessionId)?.active_run)
    || activeRunId(sessionEntryById(sessionId)?.active_run)
    || "";
}

function runIdFromEnvelope(envelope) {
  return String(envelope?.run_id || envelope?.event?.run_id || "");
}

function activeRunId(activeRun) {
  return String(activeRun?.run_id || activeRun?.id || activeRun?.runId || "");
}

function sessionEntryById(sessionId) {
  return state.sessions.find((entry) => entry.summary.session_id === sessionId) || null;
}

function activeRunMatchesRunId(activeRun, runId) {
  if (!activeRun) return false;
  const activeId = activeRunId(activeRun);
  return !runId || !activeId || activeId === runId;
}

function activeRunCountsForSession(sessionId, activeRun) {
  if (!activeRun) return false;
  const terminal = state.terminalRunsBySession.get(sessionId);
  if (!terminal) return true;
  return !activeRunMatchesRunId(activeRun, terminal.runId);
}

function sanitizeSnapshotActiveRun(sessionId, snapshot) {
  if (snapshot && activeRunCountsForSession(sessionId, snapshot.active_run) === false) {
    snapshot.active_run = null;
  }
}

function sanitizeSessionListActiveRuns(sessions) {
  for (const entry of sessions) {
    if (!activeRunCountsForSession(entry.summary.session_id, entry.active_run)) {
      entry.active_run = null;
    }
  }
}

function clearCachedActiveRun(sessionId, runId) {
  const snapshot = state.snapshots.get(sessionId);
  if (snapshot && activeRunMatchesRunId(snapshot.active_run, runId)) snapshot.active_run = null;
  const entry = sessionEntryById(sessionId);
  if (entry && activeRunMatchesRunId(entry.active_run, runId)) entry.active_run = null;
}

function markRunSubmitting(sessionId) {
  if (!sessionId) return;
  clearRunSubmittingTimer(sessionId);
  state.submittingRunsBySession.add(sessionId);
}

function scheduleRunSubmittingGrace(sessionId) {
  if (!sessionId || !state.submittingRunsBySession.has(sessionId)) return;
  clearRunSubmittingTimer(sessionId);
  if (typeof setTimeout !== "function") return;

  const timerId = setTimeout(() => expireRunSubmitting(sessionId), SUBMITTING_RUN_GRACE_MS);
  state.submittingRunTimersBySession.set(sessionId, timerId);
}

function clearRunSubmitting(sessionId) {
  if (!sessionId) return;
  state.submittingRunsBySession.delete(sessionId);
  clearRunSubmittingTimer(sessionId);
}

function clearRunSubmittingTimer(sessionId) {
  const timerId = state.submittingRunTimersBySession.get(sessionId);
  if (timerId !== undefined && typeof clearTimeout === "function") clearTimeout(timerId);
  state.submittingRunTimersBySession.delete(sessionId);
}

function expireRunSubmitting(sessionId) {
  state.submittingRunTimersBySession.delete(sessionId);
  if (!state.submittingRunsBySession.delete(sessionId)) return;

  const stillActive = cachedActiveRunCountsForSession(sessionId);
  state.activeRunsBySession.set(sessionId, stillActive);
  if (!stillActive && state.selectedId === sessionId) stopWaitingLife();
  if (state.selectedId === sessionId) requestInspectorRender();
}

function cachedActiveRunCountsForSession(sessionId, snapshot = state.snapshots.get(sessionId)) {
  if (!sessionId) return false;
  return Boolean(activeRunCountsForSession(sessionId, snapshot?.active_run)
    || state.sessions.some((entry) => entry.summary.session_id === sessionId && activeRunCountsForSession(sessionId, entry.active_run)));
}

function handleRunStarted(sessionId, envelope) {
  const activeRun = activeRunFromStartedEnvelope(envelope);
  state.terminalRunsBySession.delete(sessionId);
  state.activeRunsBySession.set(sessionId, true);
  state.runStartedAtBySession.set(sessionId, activeRun.started_at_epoch_ms);
  clearRunSubmitting(sessionId);
  clearSessionAttention(sessionId);
  const snapshot = state.snapshots.get(sessionId);
  if (snapshot) {
    snapshot.active_run = activeRun;
  }
  const entry = sessionEntryById(sessionId);
  if (entry) entry.active_run = activeRun;
  if (state.selectedId === sessionId) {
    requestChatScrollToBottom();
  }
  startLiveTimer();
}

function handleTerminalRun(sessionId, envelope) {
  const wasActive = sessionHasActiveRun(sessionId);
  const runId = terminalRunIdForSession(sessionId, envelope);
  state.terminalRunsBySession.set(sessionId, {
    runId,
    sequenceId: envelope.sequence_id || 0,
  });
  state.activeRunsBySession.set(sessionId, false);
  state.runStartedAtBySession.delete(sessionId);
  clearRunSubmitting(sessionId);
  clearCachedActiveRun(sessionId, runId);
  if (wasActive) state.attentionSessions.add(sessionId);
  if (state.selectedId === sessionId) {
    stopWaitingLife();
  }
  if (state.runStartedAtBySession.size === 0) {
    stopLiveTimer();
  }
}

function requestRender(options = {}) {
  const hasShellBits = "shell" in options
    || "sessions" in options
    || "mobile" in options;
  const shell = options.shell === true || (!hasShellBits && options.shell !== false);
  if (shell || options.sessions) state.renderSessionsPending = true;
  if (shell || options.mobile) state.renderMobilePending = true;
  if (options.inspector !== false) state.renderInspectorPending = true;

  const hasPendingRender = state.renderSessionsPending
    || state.renderMobilePending
    || state.renderInspectorPending;
  if (!hasPendingRender || state.renderRafId) return;

  const schedule = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : (callback) => setTimeout(callback, 0);
  state.renderRafId = schedule(flushRender);
}

function requestInspectorRender() {
  requestRender({ shell: false, inspector: true });
}

function requestEventsRender() {
  requestRender({
    shell: false,
    inspector: state.activeTab === "events",
  });
}

function flushRender() {
  state.renderRafId = null;
  const renderSessionsPending = state.renderSessionsPending;
  const renderMobilePending = state.renderMobilePending;
  const renderInspectorPending = state.renderInspectorPending;
  state.renderSessionsPending = false;
  state.renderMobilePending = false;
  state.renderInspectorPending = false;

  if (renderSessionsPending && renderMobilePending) {
    renderShell();
  } else {
    if (renderSessionsPending) renderSessions();
    if (renderMobilePending) renderMobileMode();
  }
  if (renderInspectorPending) renderInspector();
}

function renderShell() {
  renderSessions();
  renderMobileMode();
}

function selectedSessionIsUsable() {
  const sessionId = state.selectedId;
  return Boolean(sessionId && state.snapshots.has(sessionId) && sessionEntryById(sessionId));
}

function toggleInspectorFullscreen() {
  if (!selectedSessionIsUsable()) return;
  setInspectorFullscreen(!state.inspectorFullscreen);
}

function setInspectorFullscreen(enabled) {
  const nextEnabled = Boolean(enabled);
  const inspector = el.fullscreenBtn.closest(".inspector");
  const focusWouldBeHidden = state.inspectorFullscreen
    && !nextEnabled
    && !state.mobileDetailOpen
    && typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(WAITING_LIFE_MOBILE_QUERY).matches
    && inspector?.contains(document.activeElement);

  if (nextEnabled !== state.inspectorFullscreen) cancelPaneResize(true);
  state.inspectorFullscreen = nextEnabled;
  renderInspectorFullscreenMode();
  if (focusWouldBeHidden) {
    el.sessionGrid.querySelector("[data-action='new-session']")?.focus();
  }
}

function renderInspectorFullscreenMode() {
  const enabled = state.inspectorFullscreen;
  const label = enabled ? "Exit full screen" : "Enter full screen";
  document.body.classList.toggle("inspector-fullscreen", enabled);
  el.fullscreenBtn.setAttribute("aria-label", label);
  el.fullscreenBtn.setAttribute("title", label);
  el.fullscreenBtn.setAttribute("aria-pressed", String(enabled));
  el.fullscreenEnterIcon.hidden = enabled;
  el.fullscreenExitIcon.hidden = !enabled;
  syncPaneSplitter();
}

function renderMobileMode() {
  document.body.classList.toggle("detail-open", Boolean(state.mobileDetailOpen && state.selectedId));
  renderInspectorFullscreenMode();
  if (!chatPanelIsVisible(state.selectedId)) stopWaitingLife();
}

function renderSessions() {
  if (sessionReorderInProgress()) {
    state.renderSessionsDeferred = true;
    return;
  }

  const focusedControl = focusedSessionControl();
  const cards = filteredSessions().map(sessionCardViewModel).filter(Boolean);
  const pinnedCards = cards.filter((card) => card.pinned);
  const unpinnedCards = cards.filter((card) => !card.pinned);
  const sections = [];
  if (pinnedCards.length > 0) sections.push(renderSessionGroup(true, pinnedCards));
  sections.push(renderSessionGroup(false, unpinnedCards));
  el.sessionGrid.innerHTML = sections.join("");
  restorePendingSessionFocus(focusedControl);
  state.lastSessionsDigest = sessionCardListRenderDigest(cards);
  state.lastSelectedSessionDigest = sessionCardRenderDigest(cards.find((card) => card.sessionId === state.selectedId));
}

function renderSessionGroup(pinned, cards) {
  const label = pinned ? "Pinned sessions" : "Sessions";
  const groupName = pinned ? "pinned" : "unpinned";
  const sessionCards = cards.map((card, index) => renderSessionCard(card, index, cards.length)).join("");
  const body = `${pinned ? "" : renderNewSessionCard()}${sessionCards}`;
  return `
    <section class="session-group" data-session-group="${groupName}" aria-label="${label}">
      <div class="session-card-grid" data-pinned="${pinned}" role="list" aria-label="${label}">
        ${body}
      </div>
    </section>`;
}

function renderNewSessionCard() {
  return `
    <div class="new-session-card-item" role="listitem">
      <button class="session-card new-session-card" data-action="new-session" type="button">
        <span class="new-session-plus">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14"></path>
            <path d="M5 12h14"></path>
          </svg>
        </span>
        <span>
          <strong>New Session</strong>
          <small>ssh, cwd, sandbox, model, prompt</small>
        </span>
      </button>
    </div>`;
}

function renderSessionCard(card, index, count) {
  if (!card) return "";
  const busy = card.presentationBusy ? " disabled" : "";
  const pinLabel = card.pinned ? `Unpin ${card.displayTitle}` : `Pin ${card.displayTitle}`;
  const groupLabel = card.pinned ? "pinned sessions" : "sessions";
  return `
    <article class="session-card ${card.tone} ${card.errorish} ${card.selected ? "selected" : ""} ${card.pinned ? "pinned" : ""}" data-session-id="${escapeAttr(card.sessionId)}" data-pinned="${card.pinned}" role="listitem" title="Session ID: ${escapeAttr(card.sessionId)}">
      <button class="session-card-select" data-action="select-session" type="button" aria-label="Select ${escapeAttr(card.displayTitle)}, session ${escapeAttr(card.sessionId)}">
        <div class="session-card-head">
          <div>
            <h2><span class="status-dot ${card.statusClass}" aria-hidden="true"></span><span class="session-card-title-text">${escapeHtml(card.displayTitle)}${card.sandboxed ? ` <svg class="icon sandbox-icon" viewBox="0 0 24 24" aria-hidden="true"><title>sandbox active</title><rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M8 8h8"></path></svg>` : ""}${card.sshHost ? ` <svg class="icon ssh-icon" viewBox="0 0 24 24" aria-hidden="true"><title>ssh: ${escapeHtml(card.sshHost)}</title><rect x="4" y="5" width="16" height="14" rx="2"></rect><path d="M7 10l3 2-3 2"></path><path d="M13 14h4"></path></svg>` : ""}</span></h2>
            <div class="cwd">${escapeHtml(card.cwd)}</div>
          </div>
        </div>
        <div class="telemetry-grid">
          <div><span>run</span><strong data-run-timer="${escapeAttr(card.sessionId)}" class="run-tile${card.runActive ? " run-tile-active" : ""}">${card.runDisplay}</strong></div>
          <div><span>add</span><strong>${escapeHtml(card.additions)}</strong></div>
          <div><span>del</span><strong>${escapeHtml(card.deletions)}</strong></div>
        </div>
        <div class="last-prompt">${escapeHtml(card.promptPreview)}</div>
      </button>
      <div class="session-card-controls">
        <button class="session-card-action session-pin-button" data-action="toggle-pin" type="button" aria-label="${escapeAttr(pinLabel)}" title="${escapeAttr(pinLabel)} — ${escapeAttr(card.sessionId)}" aria-pressed="${card.pinned}"${busy}>
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z"></path><path d="M12 14v7"></path></svg>
        </button>
        <button class="session-card-action reorder-handle" data-action="reorder-handle" type="button" aria-label="Reorder ${escapeAttr(card.displayTitle)} in ${groupLabel}; position ${index + 1} of ${count}" title="Reorder ${escapeAttr(card.displayTitle)} — ${escapeAttr(card.sessionId)}" aria-describedby="reorderInstructions"${busy}>
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="7" r="1"></circle><circle cx="16" cy="7" r="1"></circle><circle cx="8" cy="12" r="1"></circle><circle cx="16" cy="12" r="1"></circle><circle cx="8" cy="17" r="1"></circle><circle cx="16" cy="17" r="1"></circle></svg>
        </button>
      </div>
    </article>`;
}

function handleSessionGridClick(event) {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget || !el.sessionGrid.contains(actionTarget)) return;
  const action = actionTarget.dataset.action;
  const card = actionTarget.closest("[data-session-id]");
  const sessionId = card?.dataset.sessionId || null;

  if (state.suppressSessionClickUntil > Date.now()
    && sessionId
    && sessionId === state.suppressSessionClickSessionId) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (action === "new-session") {
    showLaunchOverlay();
  } else if (action === "select-session" && sessionId && !sessionReorderInProgress()) {
    selectSession(sessionId);
  } else if (action === "toggle-pin" && sessionId) {
    toggleSessionPin(sessionId, actionTarget);
  }
}

function currentSessionSummary(sessionId) {
  return sessionEntryById(sessionId)?.summary || null;
}

function sessionGroupEntries(pinned) {
  return state.sessions.filter((entry) => Boolean(entry.summary.pinned) === Boolean(pinned));
}

function sessionGroupIds(pinned) {
  return sessionGroupEntries(pinned).map((entry) => entry.summary.session_id);
}

function expectedVersionsForSessionIds(sessionIds) {
  const expectedVersions = {};
  for (const sessionId of sessionIds) {
    const summary = currentSessionSummary(sessionId);
    if (!summary) return null;
    expectedVersions[sessionId] = Number(summary.presentation_version) || 0;
  }
  return expectedVersions;
}

async function toggleSessionPin(sessionId, button) {
  if (!sessionId || sessionReorderInProgress() || state.presentationMutations.has(sessionId)) return;
  const summary = currentSessionSummary(sessionId);
  if (!summary) return;
  state.presentationMutations.add(sessionId);
  setSessionCardActionsDisabled(sessionId, true);
  if (button) button.setAttribute("aria-busy", "true");

  try {
    await apiPut(`/sessions/${encodeURIComponent(sessionId)}/presentation`, {
      title: typeof summary.title === "string" ? summary.title : "",
      pinned: !Boolean(summary.pinned),
      expected_version: Number(summary.presentation_version) || 0,
    });
    state.pendingSessionFocus = { sessionId, action: "toggle-pin" };
    announceReorder(`${displaySessionTitle(summary)} ${summary.pinned ? "unpinned" : "pinned"}.`);
  } catch (error) {
    announceReorder(`Could not ${summary.pinned ? "unpin" : "pin"} ${displaySessionTitle(summary)}: ${error.message}. Reloaded current sessions.`);
  } finally {
    state.presentationMutations.delete(sessionId);
    const loaded = await loadSessions({ forceFetch: true, forceRender: true });
    if (loaded === null) state.pendingSessionFocus = null;
  }
}

function setSessionCardActionsDisabled(sessionId, disabled) {
  const card = sessionCardElement(sessionId);
  card?.querySelectorAll(".session-card-action").forEach((button) => {
    button.disabled = Boolean(disabled);
  });
}

function showRenameOverlay() {
  if (sessionReorderInProgress() || state.presentationMutations.has(state.selectedId)) return;
  const summary = currentSessionSummary(state.selectedId);
  if (!summary) return;
  const active = document.activeElement;
  state.renameDialogGeneration += 1;
  state.renameSessionId = summary.session_id;
  state.renameSubmission = null;
  state.renameReturnFocus = el.appShell.contains(active) && active !== document.body
    ? active
    : el.renameSessionBtn;
  el.renameTitleInput.value = typeof summary.title === "string" ? summary.title : "";
  setRenameStatus("", false);
  el.renameForm.removeAttribute("aria-busy");
  el.confirmRename.disabled = false;
  el.appShell.setAttribute("inert", "");
  el.renameOverlay.hidden = false;
  const dialogGeneration = state.renameDialogGeneration;
  const sessionId = state.renameSessionId;
  requestAnimationFrame(() => {
    if (el.renameOverlay.hidden
      || state.renameDialogGeneration !== dialogGeneration
      || state.renameSessionId !== sessionId
      || el.renameOverlay.contains(document.activeElement)) return;
    el.renameTitleInput.focus();
    el.renameTitleInput.select();
  });
}

function hideRenameOverlay(restoreFocus = false) {
  const returnFocus = state.renameReturnFocus;
  state.renameDialogGeneration += 1;
  state.renameSubmission = null;
  state.renameReturnFocus = null;
  el.renameOverlay.hidden = true;
  el.appShell.removeAttribute("inert");
  state.renameSessionId = null;
  el.renameForm.removeAttribute("aria-busy");
  setRenameStatus("", false);
  if (!restoreFocus) return;
  const target = returnFocus?.isConnected && !returnFocus.disabled
    ? returnFocus
    : (!el.renameSessionBtn.disabled ? el.renameSessionBtn : null);
  target?.focus();
}

function containRenameDialogFocus(event) {
  if (event.key !== "Tab" || el.renameOverlay.hidden) return;
  const focusable = Array.from(el.renameOverlay.querySelectorAll(
    "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
  )).filter((target) => !target.hidden && target.getAttribute("aria-hidden") !== "true");
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !el.renameOverlay.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function setRenameStatus(message, error) {
  el.renameStatus.textContent = message || "";
  el.renameStatus.classList.toggle("error", Boolean(error));
}

function renameSubmissionIsCurrent(submission) {
  return state.renameSubmission === submission
    && state.renameDialogGeneration === submission.dialogGeneration
    && state.renameSessionId === submission.sessionId
    && !el.renameOverlay.hidden;
}

async function renameSelectedSession(event) {
  event.preventDefault();
  const sessionId = state.renameSessionId;
  const summary = currentSessionSummary(sessionId);
  if (!sessionId || !summary || state.presentationMutations.has(sessionId)) return;
  const title = el.renameTitleInput.value;
  const normalized = title.trim();
  if (Array.from(normalized).length > SESSION_TITLE_MAX_CHARS) {
    setRenameStatus(`Title must be at most ${SESSION_TITLE_MAX_CHARS} characters.`, true);
    el.renameTitleInput.focus();
    return;
  }

  const submission = {
    dialogGeneration: state.renameDialogGeneration,
    sessionId,
  };
  state.renameSubmission = submission;
  state.presentationMutations.add(sessionId);
  el.renameForm.setAttribute("aria-busy", "true");
  el.confirmRename.disabled = true;
  setRenameStatus("saving", false);
  try {
    await apiPut(`/sessions/${encodeURIComponent(sessionId)}/presentation`, {
      title,
      pinned: Boolean(summary.pinned),
      expected_version: Number(summary.presentation_version) || 0,
    });
    if (renameSubmissionIsCurrent(submission)) hideRenameOverlay(true);
  } catch (error) {
    if (renameSubmissionIsCurrent(submission)) setRenameStatus(error.message, true);
  } finally {
    state.presentationMutations.delete(sessionId);
    if (renameSubmissionIsCurrent(submission)) {
      state.renameSubmission = null;
      el.renameForm.removeAttribute("aria-busy");
      el.confirmRename.disabled = false;
    }
    await loadSessions({ forceFetch: true, forceRender: true });
  }
}

function sessionReorderInProgress() {
  return Boolean(state.sessionReorder);
}

function sessionCardElement(sessionId) {
  return Array.from(el.sessionGrid.querySelectorAll("article[data-session-id]"))
    .find((card) => card.dataset.sessionId === sessionId) || null;
}

function sessionGroupGridForCard(card) {
  return card?.closest(".session-card-grid") || null;
}

function announceReorder(message) {
  el.reorderLiveRegion.textContent = "";
  requestAnimationFrame(() => {
    el.reorderLiveRegion.textContent = message || "";
  });
}

function sessionPositionAnnouncement(sessionId, position, count, pinned, suffix = "") {
  const summary = currentSessionSummary(sessionId);
  const title = summary ? displaySessionTitle(summary) : shortId(sessionId);
  const group = pinned ? "pinned sessions" : "sessions";
  return `${title}, position ${position + 1} of ${count} in ${group}.${suffix ? ` ${suffix}` : ""}`;
}

function handleSessionGridKeydown(event) {
  const handle = event.target.closest(".reorder-handle");
  if (!handle || !el.sessionGrid.contains(handle)) return;
  const card = handle.closest("article[data-session-id]");
  const sessionId = card?.dataset.sessionId;
  if (!sessionId) return;

  const reorder = state.sessionReorder;
  if (!reorder) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      startKeyboardSessionReorder(sessionId);
    }
    return;
  }
  if (reorder.kind !== "keyboard" || reorder.sessionId !== sessionId) return;

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    commitKeyboardSessionReorder();
    return;
  }

  let nextIndex = reorder.currentIds.indexOf(sessionId);
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex -= 1;
  else if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex += 1;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = reorder.currentIds.length - 1;
  else return;

  event.preventDefault();
  moveKeyboardSessionTo(nextIndex);
}

function startKeyboardSessionReorder(sessionId) {
  if (sessionReorderInProgress() || state.presentationMutations.size > 0) return;
  const summary = currentSessionSummary(sessionId);
  if (!summary) return;
  const pinned = Boolean(summary.pinned);
  const originalIds = sessionGroupIds(pinned);
  const card = sessionCardElement(sessionId);
  const grid = sessionGroupGridForCard(card);
  if (!card || !grid) return;

  state.sessionsLoadGeneration += 1;
  state.sessionReorder = {
    kind: "keyboard",
    sessionId,
    pinned,
    originalIds,
    currentIds: originalIds.slice(),
    card,
    grid,
  };
  card.classList.add("is-reordering", "keyboard-reordering");
  grid.classList.add("is-reordering");
  document.body.classList.add("session-reordering");
  const position = originalIds.indexOf(sessionId);
  announceReorder(sessionPositionAnnouncement(sessionId, position, originalIds.length, pinned, "Use arrow keys, Home, or End, then Enter or Space to save."));
}

function moveKeyboardSessionTo(rawIndex) {
  const reorder = state.sessionReorder;
  if (!reorder || reorder.kind !== "keyboard") return;
  const currentIndex = reorder.currentIds.indexOf(reorder.sessionId);
  const nextIndex = clampInt(rawIndex, 0, reorder.currentIds.length - 1);
  if (nextIndex === currentIndex) return;
  reorder.currentIds.splice(currentIndex, 1);
  reorder.currentIds.splice(nextIndex, 0, reorder.sessionId);
  reorderGroupCardsDom(reorder.grid, reorder.currentIds);
  updateGroupCardPositionControls(reorder.grid);
  reorder.card.querySelector(".reorder-handle")?.focus();
  announceReorder(sessionPositionAnnouncement(reorder.sessionId, nextIndex, reorder.currentIds.length, reorder.pinned));
}

function commitKeyboardSessionReorder() {
  const reorder = state.sessionReorder;
  if (!reorder || reorder.kind !== "keyboard") return;
  const ids = reorder.currentIds.slice();
  cleanupSessionReorderDom(reorder, false);
  reorder.kind = "committing";
  submitSessionOrder(reorder, ids);
}

function handleSessionPointerDown(event) {
  const handle = event.target.closest(".reorder-handle");
  if (!handle || !el.sessionGrid.contains(handle) || handle.disabled) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (sessionReorderInProgress() || state.presentationMutations.size > 0) return;
  const card = handle.closest("article[data-session-id]");
  const grid = sessionGroupGridForCard(card);
  const sessionId = card?.dataset.sessionId;
  const summary = currentSessionSummary(sessionId);
  if (!card || !grid || !summary) return;

  const rect = card.getBoundingClientRect();
  state.sessionsLoadGeneration += 1;
  state.sessionReorder = {
    kind: "pointer-pending",
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    sessionId,
    pinned: Boolean(summary.pinned),
    originalIds: sessionGroupIds(Boolean(summary.pinned)),
    card,
    grid,
    handle,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    cardRect: rect,
    placeholder: null,
  };
  try { handle.setPointerCapture(event.pointerId); } catch (_) {}
}

function handleSessionPointerMove(event) {
  const reorder = state.sessionReorder;
  if (!reorder || !reorder.kind.startsWith("pointer") || reorder.pointerId !== event.pointerId) return;
  if (reorder.kind === "pointer-pending") {
    const distance = Math.hypot(event.clientX - reorder.startX, event.clientY - reorder.startY);
    if (distance < REORDER_DRAG_THRESHOLD_PX) return;
    beginPointerSessionReorder(reorder);
  }
  if (reorder.kind !== "pointer") return;
  event.preventDefault();
  positionDraggedSessionCard(reorder, event.clientX, event.clientY);
  positionSessionPlaceholder(reorder, event.clientX, event.clientY);
}

function beginPointerSessionReorder(reorder) {
  if (state.sessionReorder !== reorder || reorder.kind !== "pointer-pending") return;
  const placeholder = document.createElement("div");
  placeholder.className = "session-card-placeholder";
  placeholder.style.minHeight = `${Math.max(1, Math.round(reorder.cardRect.height))}px`;
  placeholder.setAttribute("aria-hidden", "true");
  const marker = document.createElement("span");
  marker.className = "session-drop-marker";
  placeholder.append(marker);
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
  announceReorder(sessionPositionAnnouncement(
    reorder.sessionId,
    reorder.originalIds.indexOf(reorder.sessionId),
    reorder.originalIds.length,
    reorder.pinned,
    "Dragging. Drop within this group or press Escape to cancel.",
  ));
}

function positionDraggedSessionCard(reorder, clientX, clientY) {
  reorder.card.style.left = `${Math.round(clientX - reorder.offsetX)}px`;
  reorder.card.style.top = `${Math.round(clientY - reorder.offsetY)}px`;
}

function positionSessionPlaceholder(reorder, clientX, clientY) {
  const gridRect = reorder.grid.getBoundingClientRect();
  if (clientX < gridRect.left || clientX > gridRect.right || clientY < gridRect.top || clientY > gridRect.bottom) return;
  const candidates = Array.from(reorder.grid.querySelectorAll(":scope > article[data-session-id]"))
    .filter((card) => card !== reorder.card);
  let before = null;
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    const beforeRow = clientY < rect.top + rect.height / 2;
    const beforeInRow = clientY <= rect.bottom && clientX < rect.left + rect.width / 2;
    if (beforeRow || beforeInRow) {
      before = candidate;
      break;
    }
  }
  if (before) reorder.grid.insertBefore(reorder.placeholder, before);
  else reorder.grid.append(reorder.placeholder);

  const ids = sessionIdsAtPointerPlaceholder(reorder);
  const position = ids.indexOf(reorder.sessionId);
  if (position >= 0 && position !== reorder.lastAnnouncedPosition) {
    reorder.lastAnnouncedPosition = position;
    announceReorder(sessionPositionAnnouncement(reorder.sessionId, position, ids.length, reorder.pinned));
  }
}

function sessionIdsAtPointerPlaceholder(reorder) {
  const ids = [];
  for (const child of reorder.grid.children) {
    if (child === reorder.card) continue;
    if (child === reorder.placeholder) ids.push(reorder.sessionId);
    else if (child.matches?.("article[data-session-id]")) ids.push(child.dataset.sessionId);
  }
  return ids;
}

function pointerIsInsideSessionGroup(reorder, clientX, clientY) {
  const rect = reorder.grid?.getBoundingClientRect();
  return Boolean(rect
    && clientX >= rect.left
    && clientX <= rect.right
    && clientY >= rect.top
    && clientY <= rect.bottom);
}

function handleSessionPointerUp(event) {
  const reorder = state.sessionReorder;
  if (!reorder || !reorder.kind.startsWith("pointer") || reorder.pointerId !== event.pointerId) return;
  if (reorder.kind === "pointer-pending") {
    state.sessionReorder = null;
    releaseSessionPointerCapture(reorder);
    flushDeferredSessionLoad(false);
    return;
  }

  event.preventDefault();
  state.suppressSessionClickUntil = Date.now() + 600;
  state.suppressSessionClickSessionId = reorder.sessionId;
  if (!pointerIsInsideSessionGroup(reorder, event.clientX, event.clientY)) {
    cancelSessionReorder();
    return;
  }

  const ids = sessionIdsAtPointerPlaceholder(reorder);
  cleanupSessionReorderDom(reorder, false);
  reorder.kind = "committing";
  reorder.currentIds = ids;
  releaseSessionPointerCapture(reorder);
  submitSessionOrder(reorder, ids);
}

function handleSessionPointerCancel(event) {
  const reorder = state.sessionReorder;
  if (!reorder || !reorder.kind.startsWith("pointer") || reorder.pointerId !== event.pointerId) return;
  cancelSessionReorder();
}

function handleSessionLostPointerCapture(event) {
  const reorder = state.sessionReorder;
  if (!reorder || !reorder.kind.startsWith("pointer") || reorder.pointerId !== event.pointerId) return;
  if (!reorder.pointerCaptureReleased) cancelSessionReorder();
}

function cancelPointerSessionReorder() {
  const reorder = state.sessionReorder;
  if (!reorder || !reorder.kind.startsWith("pointer")) return false;
  return cancelSessionReorder();
}

function releaseSessionPointerCapture(reorder) {
  reorder.pointerCaptureReleased = true;
  try {
    if (reorder.handle?.hasPointerCapture(reorder.pointerId)) {
      reorder.handle.releasePointerCapture(reorder.pointerId);
    }
  } catch (_) {}
}

function cancelSessionReorder() {
  const reorder = state.sessionReorder;
  if (!reorder || reorder.kind === "committing") return false;
  releaseSessionPointerCapture(reorder);
  cleanupSessionReorderDom(reorder, true);
  state.sessionReorder = null;
  state.pendingSessionFocus = { sessionId: reorder.sessionId, action: "reorder-handle" };
  announceReorder(`Reorder cancelled for ${displaySessionTitle(currentSessionSummary(reorder.sessionId) || { session_id: reorder.sessionId })}.`);
  flushDeferredSessionLoad(true);
  return true;
}

function cleanupSessionReorderDom(reorder, restoreOriginal) {
  if (reorder.kind === "pointer" && reorder.placeholder) {
    reorder.grid.insertBefore(reorder.card, reorder.placeholder);
    reorder.placeholder.remove();
    reorder.placeholder = null;
  }
  if (reorder.card) {
    reorder.card.classList.remove("is-reordering", "is-dragging", "keyboard-reordering");
    reorder.card.removeAttribute("aria-grabbed");
    for (const property of ["position", "left", "top", "width", "height", "margin", "z-index"]) {
      reorder.card.style.removeProperty(property);
    }
  }
  reorder.grid?.classList.remove("is-reordering", "is-dragging");
  document.body.classList.remove("session-reordering");
  if (restoreOriginal && reorder.grid && reorder.originalIds) {
    reorderGroupCardsDom(reorder.grid, reorder.originalIds);
    updateGroupCardPositionControls(reorder.grid);
  }
}

function reorderGroupCardsDom(grid, sessionIds) {
  const cards = new Map(
    Array.from(grid?.querySelectorAll(":scope > article[data-session-id]") || [])
      .map((card) => [card.dataset.sessionId, card]),
  );
  for (const sessionId of sessionIds) {
    const card = cards.get(sessionId);
    if (card) grid.append(card);
  }
}

function updateGroupCardPositionControls(grid) {
  const cards = Array.from(grid?.querySelectorAll(":scope > article[data-session-id]") || []);
  cards.forEach((card, index) => {
    const summary = currentSessionSummary(card.dataset.sessionId);
    const title = summary ? displaySessionTitle(summary) : shortId(card.dataset.sessionId);
    const pinned = card.dataset.pinned === "true";
    const handle = card.querySelector(".reorder-handle");
    if (handle) {
      handle.setAttribute("aria-label", `Reorder ${title} in ${pinned ? "pinned sessions" : "sessions"}; position ${index + 1} of ${cards.length}`);
    }
  });
}

function sessionOrdersMatch(left, right) {
  return left.length === right.length && left.every((sessionId, index) => sessionId === right[index]);
}

async function submitSessionOrder(reorder, sessionIds) {
  if (sessionOrdersMatch(sessionIds, reorder.originalIds || [])) {
    await finishSessionReorder(reorder, true, null, sessionIds, true);
    return;
  }

  const expectedVersions = expectedVersionsForSessionIds(sessionIds);
  if (!expectedVersions) {
    announceReorder("Could not reorder sessions because the session list changed. Reloading.");
    await finishSessionReorder(reorder, false);
    return;
  }

  let succeeded = false;
  let failure = null;
  try {
    await apiPut("/sessions/order", {
      pinned: reorder.pinned,
      session_ids: sessionIds,
      expected_versions: expectedVersions,
    });
    succeeded = true;
  } catch (error) {
    failure = error;
  }
  await finishSessionReorder(reorder, succeeded, failure, sessionIds);
}

async function finishSessionReorder(reorder, succeeded, failure = null, sessionIds = null, unchanged = false) {
  if (state.sessionReorder !== reorder) return;
  if (!succeeded) cleanupSessionReorderDom(reorder, true);
  else cleanupSessionReorderDom(reorder, false);
  state.sessionReorder = null;
  state.pendingSessionFocus = { sessionId: reorder.sessionId, action: "reorder-handle" };
  const finalIds = sessionIds || reorder.originalIds || [];
  const position = finalIds.indexOf(reorder.sessionId);
  if (unchanged) {
    announceReorder(sessionPositionAnnouncement(reorder.sessionId, Math.max(0, position), finalIds.length, reorder.pinned, "Order unchanged."));
  } else if (succeeded) {
    announceReorder(sessionPositionAnnouncement(reorder.sessionId, Math.max(0, position), finalIds.length, reorder.pinned, "Saved."));
  } else if (failure) {
    announceReorder(`Could not reorder ${displaySessionTitle(currentSessionSummary(reorder.sessionId) || { session_id: reorder.sessionId })}: ${failure.message}. Reloaded current order.`);
  }
  await flushDeferredSessionLoad(!unchanged);
  restorePendingSessionFocus();
}

async function flushDeferredSessionLoad(forceReload) {
  const deferred = state.deferredSessionLoadOptions;
  state.deferredSessionLoadOptions = null;
  const renderDeferred = state.renderSessionsDeferred;
  state.renderSessionsDeferred = false;
  if (forceReload || deferred) {
    const options = mergeSessionLoadOptions(deferred, {
      forceFetch: Boolean(forceReload),
      forceRender: Boolean(forceReload || renderDeferred),
      workspaceStats: false,
      inspector: false,
    });
    const loaded = await loadSessions(options);
    if (loaded === null) state.pendingSessionFocus = null;
  } else if (renderDeferred) {
    requestRender({ shell: false, sessions: true });
  }
}

function focusedSessionControl() {
  const active = document.activeElement;
  if (!(active instanceof Element) || !el.sessionGrid.contains(active)) return null;
  const actionTarget = active.closest("[data-action]");
  if (!actionTarget) return null;
  return {
    sessionId: actionTarget.closest("article[data-session-id]")?.dataset.sessionId || null,
    action: actionTarget.dataset.action || null,
  };
}

function sessionControlForFocus(descriptor) {
  if (!descriptor?.action) return null;
  if (!descriptor.sessionId) {
    return Array.from(el.sessionGrid.querySelectorAll("[data-action]"))
      .find((target) => target.dataset.action === descriptor.action) || null;
  }
  const card = sessionCardElement(descriptor.sessionId);
  return Array.from(card?.querySelectorAll("[data-action]") || [])
    .find((target) => target.dataset.action === descriptor.action) || null;
}

function restorePendingSessionFocus(fallback = null) {
  const pending = state.pendingSessionFocus;
  const descriptor = pending || fallback;
  if (!descriptor) return;
  const target = sessionControlForFocus(descriptor);
  if (pending) state.pendingSessionFocus = null;
  if (!target || target.disabled) return;
  try {
    target.focus({ preventScroll: true });
  } catch (_) {
    target.focus();
  }
}

function paneSplitterIsUsable() {
  return Boolean(state.paneDesktopMedia?.matches && !state.inspectorFullscreen);
}

function paneLayoutMetrics() {
  const boardRect = el.sessionBoard.getBoundingClientRect();
  const inspectorRect = el.sessionInspector.getBoundingClientRect();
  const splitterWidth = el.paneSplitter.getBoundingClientRect().width;
  const paneWidth = boardRect.width + inspectorRect.width;
  if (!Number.isFinite(paneWidth) || paneWidth <= 0) return null;
  let minBoard = Math.min(PANE_BOARD_MIN_PX, paneWidth / 2);
  let maxBoard = paneWidth - Math.min(PANE_INSPECTOR_MIN_PX, paneWidth / 2);
  if (maxBoard < minBoard) {
    minBoard = paneWidth / 2;
    maxBoard = paneWidth / 2;
  }
  return {
    boardLeft: boardRect.left,
    paneWidth,
    splitterWidth,
    minRatio: minBoard / paneWidth,
    maxRatio: maxBoard / paneWidth,
  };
}

function syncPaneSplitter() {
  if (!el.paneSeparator || !state.paneDesktopMedia) return;
  const usable = paneSplitterIsUsable();
  el.paneSeparator.tabIndex = usable ? 0 : -1;
  el.paneSeparator.setAttribute("aria-disabled", String(!usable));
  if (usable) applyPaneRatio(state.paneRatio);
}

function applyPaneRatio(ratio) {
  if (!paneSplitterIsUsable()) return;
  const metrics = paneLayoutMetrics();
  if (!metrics) return;
  const nextRatio = Math.min(metrics.maxRatio, Math.max(metrics.minRatio, ratio));
  state.paneRatio = nextRatio;
  const boardWidth = Math.round(metrics.paneWidth * nextRatio);
  document.documentElement.style.setProperty("--board-width", `${boardWidth}px`);
  const minPercent = Math.round(metrics.minRatio * 100);
  const maxPercent = Math.round(metrics.maxRatio * 100);
  const valuePercent = Math.round(nextRatio * 100);
  el.paneSeparator.setAttribute("aria-valuemin", String(minPercent));
  el.paneSeparator.setAttribute("aria-valuemax", String(maxPercent));
  el.paneSeparator.setAttribute("aria-valuenow", String(valuePercent));
  el.paneSeparator.setAttribute("aria-valuetext", `${valuePercent}% session matrix width`);
}

function adjustPaneRatio(delta) {
  if (!paneSplitterIsUsable()) return;
  applyPaneRatio(state.paneRatio + delta);
}

function handlePaneKeydown(event) {
  if (!paneSplitterIsUsable()) return;
  const step = event.shiftKey ? 0.1 : PANE_KEYBOARD_STEP;
  if (event.key === "ArrowLeft") adjustPaneRatio(-step);
  else if (event.key === "ArrowRight") adjustPaneRatio(step);
  else if (event.key === "Home") {
    const metrics = paneLayoutMetrics();
    if (metrics) applyPaneRatio(metrics.minRatio);
  } else if (event.key === "End") {
    const metrics = paneLayoutMetrics();
    if (metrics) applyPaneRatio(metrics.maxRatio);
  } else return;
  event.preventDefault();
}

function handlePanePointerDown(event) {
  if (!paneSplitterIsUsable() || (event.pointerType === "mouse" && event.button !== 0)) return;
  state.paneResize = {
    pointerId: event.pointerId,
    startRatio: state.paneRatio,
  };
  el.paneSplitter.classList.add("is-resizing");
  try { el.paneSeparator.setPointerCapture(event.pointerId); } catch (_) {}
  event.preventDefault();
}

function handlePanePointerMove(event) {
  const resize = state.paneResize;
  if (!resize || resize.pointerId !== event.pointerId || !paneSplitterIsUsable()) return;
  const metrics = paneLayoutMetrics();
  if (!metrics) return;
  event.preventDefault();
  applyPaneRatio((event.clientX - metrics.boardLeft - metrics.splitterWidth / 2) / metrics.paneWidth);
}

function handlePanePointerUp(event) {
  if (!state.paneResize || state.paneResize.pointerId !== event.pointerId) return;
  finishPaneResize();
}

function handlePanePointerCancel(event) {
  if (!state.paneResize || state.paneResize.pointerId !== event.pointerId) return;
  cancelPaneResize(true);
}

function finishPaneResize() {
  const resize = state.paneResize;
  if (!resize) return;
  try {
    if (el.paneSeparator.hasPointerCapture(resize.pointerId)) {
      el.paneSeparator.releasePointerCapture(resize.pointerId);
    }
  } catch (_) {}
  state.paneResize = null;
  el.paneSplitter.classList.remove("is-resizing");
}

function cancelPaneResize(restoreStart) {
  const resize = state.paneResize;
  if (!resize) return false;
  finishPaneResize();
  if (restoreStart) {
    state.paneRatio = resize.startRatio;
    if (paneSplitterIsUsable()) applyPaneRatio(resize.startRatio);
  }
  return true;
}

function renderInspector() {
  const sessionId = state.selectedId;
  const selectedEntry = sessionEntryById(sessionId);
  const selectedTitle = selectedEntry ? displaySessionTitle(selectedEntry.summary) : (sessionId ? shortId(sessionId) : null);
  const snapshot = selectedSessionIsUsable() ? state.snapshots.get(sessionId) : null;
  if (!sessionId || !snapshot) {
    el.inspectorTitle.textContent = selectedTitle || "No session selected";
    el.inspectorTitle.title = sessionId || "";
    el.inspectorMeta.textContent = sessionId ? "Loading snapshot." : "Launch or select a session.";
    el.snapModel.textContent = "--";
    el.snapBackend.textContent = "--";
    el.snapMessages.textContent = "0";
    el.snapRun.textContent = "idle";
    el.snapTokens.textContent = "--";
    el.snapContext.textContent = "--";
    el.cancelRun.disabled = true;
    el.deleteSessionBtn.disabled = !selectedEntry;
    el.renameSessionBtn.disabled = !selectedEntry;
    el.fullscreenBtn.disabled = true;
    el.settingsBtn.disabled = true;
    el.transcript.innerHTML = `<div class="empty-state">No selected session.</div>`;
    state.transcriptRenderedSessionId = null;
    el.threadsView.innerHTML = "";
    el.worksetsView.innerHTML = "";
    el.workspaceView.innerHTML = "";
    renderTabs();
    syncPromptBusy(sessionId, snapshot);
    return;
  }

  const metadata = snapshot.metadata;
  const runActive = sessionHasActiveRun(metadata.session_id, snapshot);
  el.inspectorTitle.textContent = selectedEntry
    ? displaySessionTitle(selectedEntry.summary)
    : shortId(metadata.session_id);
  el.inspectorTitle.title = metadata.session_id;
  el.inspectorMeta.textContent = metadata.cwd;
  el.snapModel.textContent = metadata.model;
  el.snapBackend.textContent = metadata.backend;
  el.snapMessages.textContent = effectiveMessageCount(metadata.session_id, snapshot);
  if (runActive) {
    const startedAt = state.runStartedAtBySession.get(metadata.session_id)
      || snapshot.active_run?.started_at_epoch_ms;
    el.snapRun.textContent = startedAt
      ? formatRuntime(Date.now() - startedAt)
      : "active";
  } else {
    const lastDur = snapshot.response_timing?.last_response_duration_ms;
    el.snapRun.textContent = lastDur != null ? formatDuration(lastDur) : "idle";
  }
  el.cancelRun.disabled = !runActive;
  el.deleteSessionBtn.disabled = false;
  el.renameSessionBtn.disabled = false;
  el.fullscreenBtn.disabled = false;
  el.settingsBtn.disabled = false;

  const tokenUsage = snapshot.response_timing?.cumulative_token_usage
    ?? snapshot.response_timing?.last_token_usage;
  if (tokenUsage) {
    const cacheRead = tokenUsage.cache_read_tokens > 0 ? ` R${formatTokens(tokenUsage.cache_read_tokens)}` : "";
    el.snapTokens.textContent = `↑${formatTokens(tokenUsage.input_tokens)}${cacheRead} ↓${formatTokens(tokenUsage.output_tokens)}`;
    el.snapContext.textContent = formatTokens(tokenUsage.total_tokens);
  } else {
    el.snapTokens.textContent = "--";
    el.snapContext.textContent = "--";
  }

  renderTabs();
  syncPromptBusy(metadata.session_id, snapshot);
  renderActiveInspectorPanel(snapshot);
}

function renderActiveInspectorPanel(snapshot) {
  switch (state.activeTab) {
    case "events":
      renderEvents(snapshot);
      break;
    case "threads":
      renderThreads(snapshot);
      break;
    case "worksets":
      renderWorksets(snapshot);
      break;
    case "workspace":
      renderWorkspace(snapshot);
      break;
    case "chat":
    default:
      renderTranscript(snapshot.metadata.session_id, snapshot.messages, snapshot);
      break;
  }
}

function renderTranscript(sessionId, messages, snapshot = state.snapshots.get(sessionId)) {
  const transcriptMessages = [
    ...(messages || []),
    ...effectivePendingMessages(sessionId, snapshot),
  ];
  const visibleMessages = transcriptMessages.slice(-80);

  const durationArr = snapshot?.response_timing?.response_durations_ms;
  const durations = Array.isArray(durationArr) ? durationArr : [];
  const offset = transcriptMessages.length - visibleMessages.length;
  const durationByTranscriptIdx = new Map();
  let responseIdx = 0;
  transcriptMessages.forEach((message, idx) => {
    if (message.role === "assistant" && !(message.tool_calls?.length > 0) && !message.pending) {
      const dur = durations[responseIdx];
      if (dur != null) durationByTranscriptIdx.set(idx, dur);
      responseIdx++;
    }
  });

  const messageSig = transcriptMessagesSignature(visibleMessages);
  const durationSig = JSON.stringify(durations);
  const signature = `${messageSig}|${durationSig}`;
  if (state.transcriptRenderedSessionId === sessionId
    && state.transcriptRenderedSignature === signature) {
    scrollTranscriptToBottomIfRequested();
    return;
  }

  state.transcriptRenderedSessionId = sessionId;
  state.transcriptRenderedSignature = signature;
  if (visibleMessages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No messages yet.";
    el.transcript.replaceChildren(empty);
    scrollTranscriptToBottomIfRequested();
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleMessages.forEach((message, index) => {
    const role = message.role || "unknown";
    const body = messageDisplayText(message);
    const row = document.createElement("div");
    row.className = "message-row";
    if (message.pending) row.classList.add("pending");

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const metaLeft = document.createElement("span");
    metaLeft.className = "message-meta-left";

    const roleElement = document.createElement("span");
    roleElement.className = "message-role";
    const roleClass = safeClassToken(role);
    if (roleClass) roleElement.classList.add(roleClass);
    roleElement.textContent = role;
    metaLeft.append(roleElement);

    const transcriptIdx = offset + index;
    const durationMs = durationByTranscriptIdx.get(transcriptIdx);
    if (durationMs != null) {
      const sep = document.createElement("span");
      sep.className = "message-meta-sep";
      sep.textContent = "•";
      const durationElement = document.createElement("span");
      durationElement.className = "message-duration";
      durationElement.textContent = formatDuration(durationMs);
      metaLeft.append(sep, durationElement);
    }

    const markerElement = document.createElement("span");
    markerElement.textContent = message.pending ? "submitted" : `#${index + 1}`;

    meta.append(metaLeft, markerElement);

    const bodyElement = document.createElement("div");
    bodyElement.className = "message-body markdown";
    if (!body) bodyElement.classList.add("muted");
    bodyElement.append(renderMarkdownFragment(body || "[empty]"));

    row.append(meta, bodyElement);
    fragment.append(row);
  });

  el.transcript.replaceChildren(fragment);
  scrollTranscriptToBottomIfRequested();
}

function transcriptMessagesSignature(messages) {
  return JSON.stringify((messages || []).map((message) => [
    message.id || "",
    message.role || "",
    message.pending ? 1 : 0,
    message.run_id || "",
    message.client_id || "",
    messageDisplayText(message),
  ]));
}

function scrollTranscriptToBottomIfRequested() {
  if (!state.scrollChatToBottom) return;
  state.scrollChatToBottom = false;
  requestAnimationFrame(() => {
    el.transcript.scrollTop = el.transcript.scrollHeight;
  });
}

const SUBMITTING_RUN_GRACE_MS = 15000;
const WAITING_LIFE_TICK_MS = 75;
const WAITING_LIFE_MAX_CATCHUP_STEPS = 2;
const WAITING_LIFE_SIZE_CHECK_MS = 500;
const WAITING_LIFE_SQUARE_SCALE = 0.29;
const WAITING_LIFE_LED_BLOOM_SCALE = 2.6;
const WAITING_LIFE_LED_AFTERIMAGE_SCALE = 1.7;
const WAITING_LIFE_LED_BLOOM_FILL = "rgba(145, 205, 255, 0.08)";
const WAITING_LIFE_LED_BORN_BLOOM_FILL = "rgba(215, 240, 255, 0.12)";
const WAITING_LIFE_LED_AFTERIMAGE_FILL = "rgba(80, 155, 230, 0.045)";
const WAITING_LIFE_MOBILE_QUERY = "(max-width: 1179px)";
const WAITING_LIFE_PATTERNS = [
  {
    name: "glider",
    width: 3,
    height: 3,
    cells: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
  },
  {
    name: "r-pentomino",
    width: 3,
    height: 3,
    cells: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
  },
  {
    name: "acorn",
    width: 7,
    height: 3,
    cells: [[1, 0], [3, 1], [0, 2], [1, 2], [4, 2], [5, 2], [6, 2]],
  },
  {
    name: "lwss",
    width: 5,
    height: 4,
    cells: [[1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [4, 1], [4, 2], [0, 3], [3, 3]],
  },
];

function waitingLifeSeedKey(sessionId, snapshot, messages) {
  const activeRun = snapshot?.active_run;
  const prompt = activeRun?.prompt_preview
    || latestPendingUserPrompt(sessionId)
    || latestUserPromptFromMessages(messages || snapshot?.messages || [])
    || "";
  return [
    "life-generator-v1",
    sessionId || "",
    activeRun?.run_id || "",
    prompt,
  ].join("|");
}

function latestUserPromptFromMessages(messages) {
  for (let index = (messages || []).length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return messageDisplayText(message);
  }
  return "";
}

function chatPanelIsVisible(sessionId) {
  if (!sessionId || state.selectedId !== sessionId || state.activeTab !== "chat") return false;
  const mobileMode = typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(WAITING_LIFE_MOBILE_QUERY).matches;
  return !mobileMode || Boolean(state.mobileDetailOpen || state.inspectorFullscreen);
}

function waitingLifeIsStillActive(life) {
  if (!life?.canvas || !life.canvas.isConnected) return false;
  if (!chatPanelIsVisible(life.sessionId)) return false;
  if (!el.promptForm?.isConnected) return false;

  const promptLife = el.promptLife?.isConnected
    ? el.promptLife
    : el.promptForm.querySelector(".prompt-life");
  if (!promptLife || promptLife.hidden || promptLife.getAttribute("aria-hidden") === "true") return false;
  if (!el.promptForm.contains(promptLife)) return false;

  const promptCanvas = el.promptLifeCanvas?.isConnected && promptLife.contains(el.promptLifeCanvas)
    ? el.promptLifeCanvas
    : promptLife.querySelector(".prompt-life-canvas");
  if (promptCanvas !== life.canvas || !promptLife.contains(life.canvas)) return false;
  return promptLife.dataset.sessionId === life.sessionId;
}

function syncWaitingLife(canvas, sessionId, seedKey, runActive) {
  if (!runActive || !canvas || !canvas.isConnected || !chatPanelIsVisible(sessionId)) {
    stopWaitingLife();
    return;
  }

  const current = state.waitingLife;
  const sameVisibleLife = current
    && current.canvas === canvas
    && current.sessionId === sessionId;
  let created = false;
  if (!sameVisibleLife) {
    stopWaitingLife();
    state.waitingLife = createWaitingLife(canvas, sessionId, seedKey);
    created = true;
  }

  const life = state.waitingLife;
  const shouldCheckSize = created || !life.field || life.sizeDirty;
  const resized = shouldCheckSize ? ensureWaitingLifeSize(life) : false;
  if (resized || created) {
    drawLifeField(life);
    scheduleWaitingLifePostLayoutDraw(life);
  }
  if (life.rafId) return;

  life.lastTime = performanceNow();
  life.rafId = requestAnimationFrame(tickWaitingLife);
}

function createWaitingLife(canvas, sessionId, seedKey) {
  const life = {
    canvas,
    context: canvas.getContext("2d"),
    sessionId,
    seedKey,
    rafId: null,
    lastTime: 0,
    accumulator: 0,
    pixelWidth: 0,
    pixelHeight: 0,
    dpr: 1,
    cols: 0,
    rows: 0,
    field: null,
    postLayoutRafId: null,
    sizeDirty: true,
    lastSizeCheck: 0,
    resizeObserver: null,
  };

  if (typeof ResizeObserver === "function") {
    try {
      life.resizeObserver = new ResizeObserver(() => markWaitingLifeSizeDirty(life));
      life.resizeObserver.observe(canvas);
    } catch (_) {
      life.resizeObserver = null;
    }
  }

  return life;
}

function markWaitingLifeSizeDirty(life) {
  if (!life || state.waitingLife !== life) return;
  life.sizeDirty = true;
  scheduleWaitingLifePostLayoutDraw(life);
}

function stopWaitingLife() {
  const life = state.waitingLife;
  if (life?.rafId && typeof cancelAnimationFrame === "function") cancelAnimationFrame(life.rafId);
  if (life?.postLayoutRafId && typeof cancelAnimationFrame === "function") cancelAnimationFrame(life.postLayoutRafId);
  if (life?.resizeObserver) life.resizeObserver.disconnect();
  state.waitingLife = null;
}

function scheduleWaitingLifePostLayoutDraw(life) {
  if (!life || life.postLayoutRafId || typeof requestAnimationFrame !== "function") return;
  life.postLayoutRafId = requestAnimationFrame(() => {
    if (state.waitingLife !== life) return;
    life.postLayoutRafId = null;
    if (!waitingLifeIsStillActive(life)) {
      stopWaitingLife();
      return;
    }
    const resized = ensureWaitingLifeSize(life);
    if (resized) drawLifeField(life);
  });
}

function tickWaitingLife(time) {
  const life = state.waitingLife;
  if (!life) return;
  life.rafId = null;

  if (!waitingLifeIsStillActive(life)) {
    stopWaitingLife();
    return;
  }

  const now = Number.isFinite(time) ? time : performanceNow();
  const lastTime = Number.isFinite(life.lastTime) ? life.lastTime : now;
  const lastSizeCheck = Number.isFinite(life.lastSizeCheck) ? life.lastSizeCheck : 0;
  const hasResizeObserver = Boolean(life.resizeObserver);
  const dprChanged = waitingLifeDevicePixelRatioChanged(life);
  const shouldCheckSize = !life.field
    || life.sizeDirty
    || dprChanged
    || (!hasResizeObserver && now - lastSizeCheck >= WAITING_LIFE_SIZE_CHECK_MS);
  const resized = shouldCheckSize ? ensureWaitingLifeSize(life, now) : false;
  const elapsed = Math.min(Math.max(0, now - lastTime), 500);
  life.lastTime = now;
  life.accumulator = Number.isFinite(life.accumulator) ? life.accumulator + elapsed : elapsed;

  const tickMs = WAITING_LIFE_TICK_MS;
  let stepped = false;
  let steps = 0;
  while (life.accumulator >= tickMs && steps < WAITING_LIFE_MAX_CATCHUP_STEPS) {
    stepLifeField(life.field);
    life.accumulator -= tickMs;
    stepped = true;
    steps += 1;
  }
  if (life.accumulator >= tickMs) life.accumulator %= tickMs;

  if (stepped || resized) drawLifeField(life);
  life.rafId = requestAnimationFrame(tickWaitingLife);
}

function ensureWaitingLifeSize(life, now = performanceNow()) {
  life.lastSizeCheck = Number.isFinite(now) ? now : performanceNow();
  const rect = life.canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(rect.width || life.canvas.clientWidth || life.canvas.width || 320));
  const cssHeight = Math.max(1, Math.round(rect.height || life.canvas.clientHeight || life.canvas.height || 96));
  const dpr = waitingLifeDevicePixelRatio();
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
  const cols = clampInt(Math.ceil(cssWidth / 6), 24, 192);
  const rows = clampInt(Math.ceil(cssHeight / 6), 10, 44);

  if (life.pixelWidth === pixelWidth
    && life.pixelHeight === pixelHeight
    && life.cols === cols
    && life.rows === rows
    && life.field) {
    life.dpr = dpr;
    life.sizeDirty = false;
    return false;
  }

  life.canvas.width = pixelWidth;
  life.canvas.height = pixelHeight;
  life.pixelWidth = pixelWidth;
  life.pixelHeight = pixelHeight;
  life.dpr = dpr;
  life.cols = cols;
  life.rows = rows;
  life.field = createLifeField(cols, rows, `${life.seedKey}|${cols}x${rows}`);
  life.accumulator = 0;
  life.sizeDirty = false;
  return true;
}

function waitingLifeDevicePixelRatio() {
  return Math.max(1, Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1));
}

function waitingLifeDevicePixelRatioChanged(life) {
  return Math.abs(waitingLifeDevicePixelRatio() - (Number.isFinite(life?.dpr) ? life.dpr : 1)) > 0.001;
}

function performanceNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function createLifeField(cols, rows, seedKey) {
  const field = {
    cols,
    rows,
    cells: new Uint8Array(cols * rows),
    next: new Uint8Array(cols * rows),
    changed: new Uint8Array(cols * rows),
    rng: mulberry32(fnv1a32(seedKey)),
    generation: 0,
    aliveCount: 0,
  };
  seedLifeField(field);
  return field;
}

function seedLifeField(field) {
  const rng = field.rng;
  for (let index = 0; index < field.cells.length; index += 1) {
    if (rng() < 0.01) setLifeCell(field, index % field.cols, Math.floor(index / field.cols), 1);
  }

  const methuselahs = WAITING_LIFE_PATTERNS.filter((pattern) => pattern.name === "r-pentomino" || pattern.name === "acorn");
  for (let index = 0, count = randomRangeInclusive(rng, 2, 5); index < count; index += 1) {
    placeLifePattern(field, randomChoice(rng, methuselahs), randomInt(rng, field.cols), randomInt(rng, field.rows), randomInt(rng, 4), rng() < 0.5, rng);
  }

  const movers = WAITING_LIFE_PATTERNS.filter((pattern) => pattern.name === "glider" || pattern.name === "lwss");
  for (let index = 0, count = randomRangeInclusive(rng, 2, 4); index < count; index += 1) {
    const pattern = randomChoice(rng, movers);
    const x = randomInt(rng, field.cols);
    const y = randomInt(rng, field.rows);
    const rotation = randomInt(rng, 4);
    const flip = rng() < 0.5;
    placeLifePattern(field, pattern, x, y, rotation, flip, rng);
    placeLifePattern(field, pattern, (field.cols - x) % field.cols, (field.rows - y) % field.rows, (rotation + 2) % 4, flip, rng);
  }

  for (let index = 0, count = randomRangeInclusive(rng, 2, 4); index < count; index += 1) {
    placeLifeBlob(field, randomInt(rng, field.cols), randomInt(rng, field.rows), randomRangeInclusive(rng, 4, 6), rng);
  }

  field.aliveCount = 0;
  for (let index = 0; index < field.cells.length; index += 1) {
    if (field.cells[index]) {
      field.changed[index] = 1;
      field.aliveCount += 1;
    }
  }
}

function placeLifePattern(field, pattern, originX, originY, rotation, flip, rng) {
  for (const [cellX, cellY] of pattern.cells) {
    let [x, y] = rotateLifePatternCell(cellX, cellY, pattern, rotation);
    if (flip) x = pattern.width - 1 - x;

    const mutate = rng() < 0.05;
    if (mutate && rng() < 0.5) continue;
    setLifeCell(field, originX + x, originY + y, 1);
    if (mutate && rng() < 0.3) {
      setLifeCell(field, originX + x + randomRangeInclusive(rng, -1, 1), originY + y + randomRangeInclusive(rng, -1, 1), 1);
    }
  }
}

function rotateLifePatternCell(x, y, pattern, rotation) {
  switch (rotation % 4) {
    case 1:
      return [pattern.height - 1 - y, x];
    case 2:
      return [pattern.width - 1 - x, pattern.height - 1 - y];
    case 3:
      return [y, pattern.width - 1 - x];
    default:
      return [x, y];
  }
}

function placeLifeBlob(field, originX, originY, size, rng) {
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (rng() < 0.5) setLifeCell(field, originX + x, originY + y, 1);
    }
  }
}

function setLifeCell(field, rawX, rawY, alive) {
  const x = wrapIndex(rawX, field.cols);
  const y = wrapIndex(rawY, field.rows);
  const index = y * field.cols + x;
  field.cells[index] = alive ? 1 : 0;
}

function stepLifeField(field) {
  if (!field) return;
  let aliveCount = 0;
  for (let y = 0; y < field.rows; y += 1) {
    for (let x = 0; x < field.cols; x += 1) {
      const index = y * field.cols + x;
      const alive = field.cells[index] === 1;
      const neighbors = countLifeNeighbors(field, x, y);
      const nextAlive = alive
        ? neighbors === 2 || neighbors === 3 || neighbors === 6
        : neighbors === 3;
      field.next[index] = nextAlive ? 1 : 0;
      field.changed[index] = alive === nextAlive ? 0 : 1;
      if (nextAlive) aliveCount += 1;
    }
  }

  const previous = field.cells;
  field.cells = field.next;
  field.next = previous;
  field.generation += 1;
  field.aliveCount = aliveCount;
}

function countLifeNeighbors(field, x, y) {
  let count = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const neighborX = wrapIndex(x + dx, field.cols);
      const neighborY = wrapIndex(y + dy, field.rows);
      count += field.cells[neighborY * field.cols + neighborX];
    }
  }
  return count;
}

function drawLifeField(life) {
  if (!life?.context || !life.field) return;
  const { context, field } = life;
  const cellSize = Math.max(1, Math.max(life.pixelWidth / field.cols, life.pixelHeight / field.rows));
  const squareSize = Math.max(0.5, cellSize * WAITING_LIFE_SQUARE_SCALE);
  const inset = (cellSize - squareSize) / 2;
  const bloomSquareSize = Math.max(
    squareSize,
    Math.min(cellSize, squareSize * WAITING_LIFE_LED_BLOOM_SCALE),
  );
  const bloomInset = (cellSize - bloomSquareSize) / 2;
  const afterimageSquareSize = Math.max(
    squareSize,
    Math.min(cellSize, squareSize * WAITING_LIFE_LED_AFTERIMAGE_SCALE),
  );
  const afterimageInset = (cellSize - afterimageSquareSize) / 2;
  const offsetX = Math.min(0, (life.pixelWidth - cellSize * field.cols) / 2);
  const offsetY = Math.min(0, (life.pixelHeight - cellSize * field.rows) / 2);

  context.save();
  context.clearRect(0, 0, life.pixelWidth, life.pixelHeight);
  context.shadowBlur = 0;
  context.shadowColor = "transparent";
  context.globalCompositeOperation = "source-over";
  context.imageSmoothingEnabled = false;

  drawLifeSquares(context, field, offsetX, offsetY, cellSize, afterimageSquareSize, afterimageInset, "dead", WAITING_LIFE_LED_AFTERIMAGE_FILL);
  context.globalCompositeOperation = "lighter";
  drawLifeSquares(context, field, offsetX, offsetY, cellSize, bloomSquareSize, bloomInset, "alive", WAITING_LIFE_LED_BLOOM_FILL);
  drawLifeSquares(context, field, offsetX, offsetY, cellSize, bloomSquareSize, bloomInset, "born", WAITING_LIFE_LED_BORN_BLOOM_FILL);
  context.globalCompositeOperation = "source-over";
  drawLifeSquares(context, field, offsetX, offsetY, cellSize, squareSize, inset, "dead", "rgba(80, 150, 215, 0.055)");
  drawLifeSquares(context, field, offsetX, offsetY, cellSize, squareSize, inset, "alive", "rgba(255, 255, 255, 0.68)");
  context.globalCompositeOperation = "lighter";
  drawLifeSquares(context, field, offsetX, offsetY, cellSize, squareSize, inset, "born", "rgba(255, 255, 255, 0.34)");

  context.restore();
}

function drawLifeSquares(context, field, offsetX, offsetY, cellSize, squareSize, inset, mode, fillStyle) {
  context.fillStyle = fillStyle;
  for (let y = 0; y < field.rows; y += 1) {
    const rowOffset = y * field.cols;
    const top = offsetY + y * cellSize + inset;
    for (let x = 0; x < field.cols; x += 1) {
      const index = rowOffset + x;
      const alive = field.cells[index] === 1;
      const changed = field.changed[index] === 1;
      if (mode === "alive" && !alive) continue;
      if (mode === "born" && (!alive || !changed)) continue;
      if (mode === "dead" && (alive || !changed)) continue;
      context.fillRect(offsetX + x * cellSize + inset, top, squareSize, squareSize);
    }
  }
}

function fnv1a32(value) {
  let hash = 0x811c9dc5;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let stateValue = seed >>> 0;
  return () => {
    stateValue = (stateValue + 0x6d2b79f5) >>> 0;
    let mixed = stateValue;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng, max) {
  if (max <= 0) return 0;
  return Math.floor(rng() * max);
}

function randomRangeInclusive(rng, min, max) {
  return min + randomInt(rng, max - min + 1);
}

function randomChoice(rng, items) {
  return items[randomInt(rng, items.length)];
}

function wrapIndex(value, size) {
  return ((value % size) + size) % size;
}

function clampInt(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function renderMarkdownFragment(text) {
  const normalized = String(text ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const renderer = getMarkdownRenderer();
  if (!renderer || typeof window.DOMPurify?.sanitize !== "function") {
    return renderPlainTextFragment(normalized);
  }

  const html = renderer.render(normalized);
  const sanitized = window.DOMPurify.sanitize(html, {
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    ALLOWED_ATTR: MARKDOWN_ALLOWED_ATTR,
    ALLOWED_TAGS: MARKDOWN_ALLOWED_TAGS,
    FORBID_ATTR: MARKDOWN_FORBID_ATTR,
    FORBID_TAGS: MARKDOWN_FORBID_TAGS,
    RETURN_DOM_FRAGMENT: true,
  });
  return hardenMarkdownFragment(sanitized);
}

function getMarkdownRenderer() {
  if (markdownRenderer) return markdownRenderer;
  if (typeof window === "undefined" || typeof window.markdownit !== "function") return null;

  markdownRenderer = window.markdownit({
    html: false,
    breaks: true,
    linkify: false,
    typographer: false,
  });
  markdownRenderer.validateLink = (target) => Boolean(safeMarkdownLinkHref(target));
  markdownRenderer.renderer.rules.image = renderMarkdownImageToken;
  return markdownRenderer;
}

function renderMarkdownImageToken(tokens, index, options, env, renderer) {
  const token = tokens[index];
  const target = token.attrGet("src") || "";
  const alt = renderer.renderInlineAsText(token.children || [], options, env) || "image";
  const text = `image: ${alt}${target ? ` <${target}>` : ""}`;
  return `<span class="md-image-text">${escapeHtml(text)}</span>`;
}

function renderPlainTextFragment(text) {
  const fragment = document.createDocumentFragment();
  String(text ?? "").split("\n").forEach((line, index) => {
    if (index > 0) fragment.append(document.createElement("br"));
    fragment.append(document.createTextNode(line));
  });
  return fragment;
}

function hardenMarkdownFragment(fragment) {
  if (!fragment || typeof fragment.querySelectorAll !== "function") {
    return renderPlainTextFragment("");
  }

  fragment.querySelectorAll("*").forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || MARKDOWN_FORBID_ATTR.includes(name)) {
        element.removeAttribute(attribute.name);
      }
    }

    const tag = element.tagName.toLowerCase();
    if (tag === "a") {
      const href = safeMarkdownLinkHref(element.getAttribute("href") || "");
      if (!href) {
        element.replaceWith(document.createTextNode(element.textContent || ""));
        return;
      }
      element.setAttribute("href", href);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    } else {
      element.removeAttribute("href");
      element.removeAttribute("target");
      element.removeAttribute("rel");
    }

    if (tag === "span" && element.classList.contains("md-image-text")) {
      element.className = "md-image-text";
    } else {
      element.removeAttribute("class");
    }

    if (tag === "ol") {
      const start = element.getAttribute("start");
      if (start && !/^[1-9][0-9]{0,5}$/.test(start)) element.removeAttribute("start");
    } else {
      element.removeAttribute("start");
    }
  });

  return fragment;
}

function safeMarkdownLinkHref(target) {
  const raw = String(target || "");
  if (!raw || /[\s\u0000-\u001f\u007f]/.test(raw)) return null;
  const trimmed = raw.trim();
  const protocolMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!protocolMatch) return null;
  const protocol = `${protocolMatch[1].toLowerCase()}:`;
  if (!SAFE_MARKDOWN_LINK_PROTOCOLS.has(protocol)) return null;

  try {
    const url = new URL(trimmed);
    return SAFE_MARKDOWN_LINK_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch (_) {
    return null;
  }
}

function renderEvents(snapshot) {
  const sessionId = snapshot?.metadata?.session_id || state.selectedId;
  const events = getSessionEvents(sessionId);
  el.eventStreamStatus.textContent = eventStreamStatus(events);
  const previousScrollTop = el.eventLog.scrollTop;
  el.eventLog.innerHTML = renderGroupedEventStreams(snapshot, events);
  el.eventLog.scrollTop = previousScrollTop;
}

function eventStreamStatus(events) {
  const notices = events.filter((envelope) => envelope.local).slice(0, 40);
  if (notices.some((envelope) => envelope.event?.type === "replay_gap")) {
    return "Replay gap · lifecycle may be incomplete";
  }
  if (notices.some((envelope) => envelope.event?.type === "lagged")) {
    return "Lag detected · lifecycle may be incomplete";
  }
  const interruptedIndex = events.findIndex((envelope) => envelope.local && envelope.event?.type === "stream");
  const latestServerIndex = events.findIndex((envelope) => !envelope.local);
  if (interruptedIndex >= 0 && (latestServerIndex < 0 || interruptedIndex < latestServerIndex)) {
    return "Reconnecting · stream interrupted";
  }
  if (state.eventSource?.readyState === 1) return "Live";
  if (state.eventSource?.readyState === 0) return "Connecting";
  return "Snapshot · stream unavailable";
}

function indexedEventEvidence(events) {
  return events.map((envelope, index) => ({
    envelope,
    index,
    event: agentEvent(envelope),
    runId: runIdFromEnvelope(envelope),
  }));
}

function workerNameForEnvelope(envelope) {
  const event = agentEvent(envelope);
  if (!event) return null;
  if (["thread_started", "thread_finished", "thread_log"].includes(event.type)) {
    return event.name || null;
  }
  return event.thread_name || null;
}

function evidenceIsNewer(left, right) {
  if (!left) return false;
  if (!right) return true;
  const leftSequence = Number(left.envelope?.sequence_id);
  const rightSequence = Number(right.envelope?.sequence_id);
  if (Number.isSafeInteger(leftSequence) && Number.isSafeInteger(rightSequence)) {
    return leftSequence > rightSequence;
  }
  return left.index < right.index;
}

function evidenceRunsMatch(left, right) {
  return !left?.runId || !right?.runId || left.runId === right.runId;
}

function currentRunIdForEvents(snapshot, evidence) {
  const active = String(snapshot?.active_run?.run_id || "");
  if (active) return active;
  const canonical = evidence.find((item) => item.envelope.event?.type === "run_started");
  return canonical?.runId || "";
}

function latestEpisode(episodes) {
  return [...(episodes || [])].sort((left, right) => {
    const leftId = Number(left?.id);
    const rightId = Number(right?.id);
    if (Number.isFinite(leftId) && Number.isFinite(rightId)) return rightId - leftId;
    return String(right?.created_at || "").localeCompare(String(left?.created_at || ""));
  })[0] || null;
}

function selectThreadDispatch(items, currentRunId, snapshotActive) {
  const starts = items.filter((item) => item.event?.type === "thread_started");
  const finishes = items.filter((item) => item.event?.type === "thread_finished");
  let start = null;
  let finish = null;

  if (currentRunId) {
    start = starts.find((item) => item.runId === currentRunId) || null;
    finish = finishes.find((item) => item.runId === currentRunId) || null;
    if (start && finish && (!evidenceIsNewer(finish, start) || !evidenceRunsMatch(start, finish))) {
      finish = null;
    }
    if (start || finish || snapshotActive) {
      return { start, finish, runId: currentRunId };
    }
  }

  start = starts[0] || null;
  finish = finishes[0] || null;
  if (start && finish) {
    if (evidenceIsNewer(finish, start) && evidenceRunsMatch(start, finish)) {
      return { start, finish, runId: finish.runId || start.runId };
    }
    return { start, finish: null, runId: start.runId };
  }
  return {
    start,
    finish,
    runId: start?.runId || finish?.runId || "",
  };
}

function dispatchActivity(items, dispatch) {
  let scoped = items;
  if (dispatch.runId) {
    const matching = items.filter((item) => !item.runId || item.runId === dispatch.runId);
    if (matching.length > 0) scoped = matching;
  }
  if (dispatch.start && dispatch.finish) {
    scoped = scoped.filter((item) => item.index >= dispatch.finish.index && item.index <= dispatch.start.index);
  } else if (dispatch.start) {
    scoped = scoped.filter((item) => item.index <= dispatch.start.index);
  }
  return scoped;
}

function classifyWorkerThread({ items, dispatch, snapshotActive, retained, persisted }) {
  if (dispatch.finish) {
    const event = dispatch.finish.event;
    if (event.timed_out) return { area: "finished", label: "Timed out", tone: "danger" };
    if (Number(event.exit_code) !== 0) return { area: "finished", label: "Failed", tone: "danger" };
    return { area: "finished", label: "Finished", tone: "finished" };
  }
  const threadError = items.find((item) => item.event?.type === "error");
  if (dispatch.start) {
    const terminalError = threadError
      && evidenceIsNewer(threadError, dispatch.start);
    if (terminalError) {
      return { area: "finished", label: "Dispatch error", tone: "danger", error: threadError };
    }
    return { area: "running", label: "Running", tone: "running" };
  }
  if (snapshotActive) return { area: "queued", label: "Active — execution not confirmed", tone: "queued" };
  if (threadError) return { area: "finished", label: "Dispatch error", tone: "danger", error: threadError };
  const hasUnterminatedEvidence = items.some((item) => [
    "run_started", "model_call_started", "tool_call_started", "tool_call_finished",
    "thread_log", "assistant_message", "run_finished",
  ].includes(item.event?.type));
  if (hasUnterminatedEvidence) return { area: "finished", label: "Outcome not observed", tone: "unknown" };
  if (retained || persisted) return { area: "finished", label: "Retained history", tone: "history" };
  return { area: "finished", label: "Outcome not observed", tone: "unknown" };
}

function workerCurrentOperation(classification, activity, finish) {
  if (finish) {
    if (finish.event.timed_out) return finish.event.timeout_reason || `Exit ${finish.event.exit_code}`;
    if (Number(finish.event.exit_code) !== 0) return `Exit ${finish.event.exit_code}`;
    return "Exited successfully";
  }
  if (classification.area === "queued") return "Execution not confirmed from the available lifecycle stream";
  if (classification.label === "Dispatch error") {
    return classification.error?.event?.message || "Worker finish was not emitted";
  }
  if (classification.label === "Retained history") return "Lifecycle unavailable";
  if (classification.label === "Outcome not observed") return "Finish outcome was not observed";

  const latest = activity.find((item) => item.event?.type !== "thread_started");
  const event = latest?.event;
  if (!event) return "Worker started";
  switch (event.type) {
    case "model_call_started": return `Model call · iteration ${event.iteration}`;
    case "tool_call_started": return `Tool · ${event.name || "unknown"}`;
    case "tool_call_finished": return `${event.is_error ? "Tool error" : "Tool result"} · ${event.name || "unknown"}`;
    case "assistant_message": return "Response observed";
    case "error": return `Error · ${event.message || "unknown error"}`;
    case "thread_log": return `Diagnostics · ${event.line || ""}`;
    case "run_started": return "Agent started";
    case "run_finished": return "Agent response complete";
    default: return event.type.replaceAll("_", " ");
  }
}

function deriveThreadPresentations(snapshot, evidence) {
  const activeNames = new Set(snapshot?.active_threads || []);
  const persistedByName = new Map((snapshot?.threads || []).map((thread) => [thread.name, thread]));
  const names = new Set([
    ...activeNames,
    ...persistedByName.keys(),
    ...Object.keys(snapshot?.thread_episodes || {}),
  ]);
  const byName = new Map();
  for (const item of evidence) {
    const name = workerNameForEnvelope(item.envelope);
    if (!name) continue;
    names.add(name);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(item);
  }

  const currentRunId = currentRunIdForEvents(snapshot, evidence);
  return Array.from(names).map((name) => {
    const items = byName.get(name) || [];
    const persisted = persistedByName.get(name) || null;
    const episodes = snapshot?.thread_episodes?.[name] || [];
    const retained = latestEpisode(episodes);
    const dispatch = selectThreadDispatch(items, currentRunId, activeNames.has(name));
    const activity = dispatchActivity(items, dispatch);
    const classification = classifyWorkerThread({
      items: activity.length > 0 ? activity : items,
      dispatch,
      snapshotActive: activeNames.has(name),
      retained,
      persisted,
    });
    const observedEvidence = activity.find((item) => item.event?.type === "assistant_message")
      || (!dispatch.runId ? items.find((item) => item.event?.type === "assistant_message") : null);
    const observed = observedEvidence?.event?.content
      ? { content: observedEvidence.event.content, evidence: observedEvidence }
      : null;
    const startEvent = dispatch.start?.event;
    const action = startEvent?.action || retained?.action || persisted?.latest_action || "No action available";
    const sources = startEvent?.source_threads || [];
    return {
      key: `worker:${name}`,
      name,
      action,
      sources,
      episodes,
      retained,
      observed,
      persisted,
      snapshotActive: activeNames.has(name),
      dispatch,
      classification,
      activity,
      items,
      currentOperation: workerCurrentOperation(classification, activity, dispatch.finish),
      latestIndex: Math.min(...items.map((item) => item.index), Number.MAX_SAFE_INTEGER),
    };
  }).sort((left, right) => left.latestIndex - right.latestIndex || left.name.localeCompare(right.name));
}

function deriveOrchestratorPresentation(snapshot, evidence) {
  const canonical = evidence.filter((item) => ["run_started", "run_completed", "run_failed"].includes(item.envelope.event?.type));
  const activeRunId = String(snapshot?.active_run?.run_id || "");
  const scopedCanonical = activeRunId
    ? canonical.filter((item) => !item.runId || item.runId === activeRunId)
    : canonical;
  const latestLifecycle = activeRunId ? (scopedCanonical[0] || null) : (canonical[0] || null);
  const event = latestLifecycle?.envelope?.event;
  let label = "No active run observed";
  let tone = "history";
  if (event?.type === "run_completed") { label = "Completed"; tone = "finished"; }
  else if (event?.type === "run_failed") { label = "Failed"; tone = "danger"; }
  else if (event?.type === "run_started" || snapshot?.active_run) { label = "Running"; tone = "running"; }

  const allActivity = evidence.filter((item) => item.envelope.local || !workerNameForEnvelope(item.envelope));
  const runId = latestLifecycle?.runId || activeRunId;
  const activity = allActivity.filter((item) => {
    if (item.envelope.local) return false;
    if (runId && item.runId && item.runId !== runId) return false;
    return true;
  });
  return {
    label,
    tone,
    activity,
  };
}

function renderGroupedEventStreams(snapshot, events) {
  const evidence = indexedEventEvidence(events);
  const orchestrator = deriveOrchestratorPresentation(snapshot, evidence);
  const threads = deriveThreadPresentations(snapshot, evidence);
  const areas = {
    running: threads.filter((thread) => thread.classification.area === "running"),
    queued: threads.filter((thread) => thread.classification.area === "queued"),
    finished: threads.filter((thread) => thread.classification.area === "finished"),
  };
  return `
    <div class="event-stream-stack">
      ${renderEventStreamArea("Orchestrator", [orchestrator], "orchestrator")}
      ${renderEventStreamArea("Running", areas.running, "running")}
      ${renderEventStreamArea("Queued", areas.queued, "queued")}
      ${renderEventStreamArea("Finished", areas.finished, "finished")}
    </div>`;
}

function renderEventStreamArea(title, streams, area) {
  const count = area === "orchestrator" ? "" : `<span>${streams.length}</span>`;
  const content = streams.length > 0
    ? `<div class="event-stream-tile-grid">${streams.map((stream) => area === "orchestrator"
      ? renderDenseEventStream("Orchestrator", stream.label, stream.activity, stream.tone, "No orchestrator events captured.")
      : renderDenseEventStream(stream.name, stream.classification.label, stream.items, stream.classification.tone,
        stream.classification.area === "queued" ? stream.currentOperation : "No captured lifecycle events for this thread."))
      .join("")}</div>`
    : `<div class="event-stream-area-empty">None</div>`;
  return `
    <section class="event-stream-area event-stream-area-${area}" aria-labelledby="event-stream-${area}-title">
      <h3 id="event-stream-${area}-title" class="event-stream-area-title"><span>${title}</span>${count}</h3>
      ${content}
    </section>`;
}

function renderDenseEventStream(name, status, items, tone, emptyText) {
  return `
    <article class="event-thread-stream event-tone-${tone}">
      <header class="event-thread-header">
        <h4>${escapeHtml(name)}</h4>
        <span>${escapeHtml(status)}</span>
      </header>
      ${items.length > 0 ? `<ol class="event-stream-rows">${items.map(renderDenseEventRow).join("")}</ol>`
        : `<div class="event-stream-state">${escapeHtml(emptyText)}</div>`}
    </article>`;
}

function renderDenseEventRow(item) {
  const kind = eventKind(item.envelope);
  const rawDetail = String(eventDetail(item.envelope) ?? "");
  const detail = rawDetail.length > 360 ? `${rawDetail.slice(0, 359)}…` : rawDetail;
  const isError = kind === "error" || kind === "run_failed" || (kind === "tool_call_finished" && item.event?.is_error);
  return `
    <li class="event-stream-row${isError ? " is-error" : ""}">
      <span class="event-stream-sequence">${item.envelope.sequence_id ? `#${item.envelope.sequence_id}` : "local"}</span>
      <span class="event-stream-kind">${escapeHtml(kind)}</span>
      <span class="event-stream-detail">${escapeHtml(detail)}</span>
    </li>`;
}

function threadCardDomId(sessionId, key) {
  let hash = 2166136261;
  const value = `${sessionId}:${key}`;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `thread-card-${(hash >>> 0).toString(36)}`;
}

function tokenUsageSummary(usage) {
  const parts = [];
  if (usage.input_tokens != null) parts.push(`Input ${formatTokens(usage.input_tokens)}`);
  if (usage.cache_read_tokens) parts.push(`Cache ${formatTokens(usage.cache_read_tokens)}`);
  if (usage.output_tokens != null) parts.push(`Output ${formatTokens(usage.output_tokens)}`);
  return parts.join(" · ");
}

function activityLabel(item) {
  const event = item.event;
  const kind = event?.type || eventKind(item.envelope);
  if (event?.type === "thread_started") return `Assigned · ${event.action || "No action"}`;
  if (event?.type === "thread_finished") {
    return event.timed_out ? `Timed out · ${event.timeout_reason || `exit ${event.exit_code}`}` : `Finished · exit ${event.exit_code}`;
  }
  if (event?.type === "tool_call_started") return `Tool started · ${event.name || "unknown"} · ${event.args_preview || ""}`;
  if (event?.type === "tool_call_finished") return `${event.is_error ? "Tool error" : "Tool preview"} · ${event.name || "unknown"} · ${event.content_preview || ""}`;
  if (event?.type === "assistant_message") return "Assistant response emitted";
  if (event?.type === "thread_log") return `Diagnostics · ${event.line || ""}`;
  if (event?.type === "error") return `Error · ${event.message || ""}`;
  if (event?.type === "model_call_started") return `Model call · iteration ${event.iteration}`;
  if (event?.type === "run_started") return `Agent started · ${event.prompt_preview || ""}`;
  if (event?.type === "run_finished") return "Agent response complete";
  return `${kind} · ${eventDetail(item.envelope)}`;
}

function renderThreadActivity(activity) {
  if (!activity || activity.length === 0) return `<div class="thread-detail-empty">No lifecycle activity available.</div>`;
  return `<ol class="thread-activity-list">${[...activity].reverse().map((item) => `
    <li>
      <span>${item.envelope.sequence_id ? `#${item.envelope.sequence_id}` : "local"}</span>
      <div>${escapeHtml(activityLabel(item))}</div>
    </li>`).join("")}</ol>`;
}

function expandedThreadCards(sessionId) {
  let expanded = state.expandedThreadNamesBySession.get(sessionId);
  if (!expanded) {
    expanded = new Set();
    state.expandedThreadNamesBySession.set(sessionId, expanded);
  }
  return expanded;
}

function handleThreadClick(event) {
  const button = event.target.closest("button[data-thread-key]");
  if (!button || !el.threadsView.contains(button)) return;
  const sessionId = state.selectedId;
  const key = button.dataset.threadKey;
  if (!sessionId || !key) return;
  const expanded = expandedThreadCards(sessionId);
  if (expanded.has(key)) expanded.delete(key);
  else expanded.add(key);
  requestInspectorRender();
}

function renderThreads(snapshot) {
  const sessionId = snapshot.metadata.session_id;
  const events = getSessionEvents(sessionId);
  const evidence = indexedEventEvidence(events);
  const threads = deriveThreadPresentations(snapshot, evidence);
  const live = state.activeThreadsBySession.get(sessionId) || new Map();
  const areas = {
    running: threads.filter((thread) => thread.classification.area === "running"),
    queued: threads.filter((thread) => thread.classification.area === "queued"),
    finished: threads.filter((thread) => thread.classification.area === "finished"),
  };
  const focusedKey = el.threadsView.contains(document.activeElement)
    ? document.activeElement?.dataset?.threadKey || null
    : null;
  const previousScrollTop = el.threadsView.scrollTop;

  el.threadsView.innerHTML = `
    <div class="thread-lifecycle-stack">
      ${renderThreadTileArea("Running", areas.running, "running", snapshot, live)}
      ${renderThreadTileArea("Queued", areas.queued, "queued", snapshot, live)}
      ${renderThreadTileArea("Finished", areas.finished, "finished", snapshot, live)}
    </div>`;
  el.threadsView.scrollTop = previousScrollTop;

  if (focusedKey) {
    const replacement = Array.from(el.threadsView.querySelectorAll("button[data-thread-key]"))
      .find((button) => button.dataset.threadKey === focusedKey);
    if (replacement) {
      try { replacement.focus({ preventScroll: true }); } catch (_) { replacement.focus(); }
    }
  }
}

function renderThreadTileArea(title, tiles, area, snapshot, live) {
  const content = tiles.length > 0
    ? `<ol class="thread-tile-grid">${tiles.map((tile) => renderWorkerThreadTile(tile, snapshot, live.get(tile.name))).join("")}</ol>`
    : `<div class="thread-area-empty">None</div>`;
  return `
    <section class="thread-lifecycle-area thread-area-${area}" aria-labelledby="thread-area-${area}-title">
      <h3 id="thread-area-${area}-title" class="thread-area-title"><span>${title}</span><span>${tiles.length}</span></h3>
      ${content}
    </section>`;
}

function renderThreadDisclosure(key, expanded, controlsId) {
  return `
    <button type="button" class="thread-card-disclosure" data-thread-key="${escapeAttr(key)}"
      aria-expanded="${expanded ? "true" : "false"}" aria-controls="${escapeAttr(controlsId)}">
      ${expanded ? "Hide details" : "Details"}
    </button>`;
}

function renderWorkerThreadTile(tile, snapshot, liveThread) {
  const sessionId = snapshot.metadata.session_id;
  const expanded = expandedThreadCards(sessionId).has(tile.key);
  const detailId = `${threadCardDomId(sessionId, tile.key)}-details`;
  const classes = ["thread-tile-cell", expanded ? "is-expanded" : ""].filter(Boolean).join(" ");
  const episodeCount = tile.persisted?.episode_count ?? tile.episodes.length;
  const preview = tile.retained?.content || "No retained output.";
  const action = tile.action === "No action available" && liveThread?.action
    ? liveThread.action
    : tile.action;
  return `
    <li class="${classes}">
      <article class="thread-pulse-card thread-tone-${tile.classification.tone}" aria-labelledby="${detailId}-title">
        <header class="thread-card-header">
          <h4 id="${detailId}-title" title="${escapeAttr(tile.name)}">${escapeHtml(tile.name)}</h4>
          <span class="thread-card-status">${escapeHtml(tile.classification.label)}</span>
        </header>
        <div class="thread-card-action">${escapeHtml(action)}</div>
        <div class="thread-card-operation">${escapeHtml(tile.currentOperation)}</div>
        <div class="thread-response-preview">
          <div class="thread-response-label">Latest retained output · ${episodeCount} episode${episodeCount === 1 ? "" : "s"}</div>
          <div class="thread-response-excerpt">${escapeHtml(preview)}</div>
        </div>
        <footer class="thread-card-footer">
          <span>${tile.sources.length > 0 ? `${tile.sources.length} source${tile.sources.length === 1 ? "" : "s"}` : tile.persisted ? "Stored thread" : "Observed thread"}</span>
          ${renderThreadDisclosure(tile.key, expanded, detailId)}
        </footer>
        ${expanded ? renderWorkerThreadDetails(tile, liveThread, detailId, sessionId) : ""}
      </article>
    </li>`;
}

function renderWorkerThreadDetails(tile, liveThread, detailId, sessionId) {
  const finish = tile.dispatch.finish?.event;
  const metadataRows = [
    ["session", tile.persisted?.session_id || sessionId],
    ["created", tile.persisted?.created_at],
    ["updated", tile.persisted?.updated_at],
    ["latest action", tile.persisted?.latest_action],
    ["live action", liveThread?.action || tile.dispatch.start?.event?.action],
    ["sources", liveThread?.source_threads || tile.sources],
    ["started seq", liveThread?.started_sequence_id ?? liveThread?.started_sequence ?? tile.dispatch.start?.envelope?.sequence_id],
    ["finished seq", liveThread?.finished_sequence_id ?? liveThread?.finished_sequence ?? tile.dispatch.finish?.envelope?.sequence_id],
    ["exit code", liveThread?.exit_code ?? finish?.exit_code],
    ["timed out", liveThread?.timed_out ?? finish?.timed_out],
    ["timeout reason", finish?.timeout_reason],
    ["error", tile.classification.error?.event?.message],
    ["usage", finish?.usage ? tokenUsageSummary(finish.usage) : null],
    ["last log", liveThread?.last_log],
  ];
  return `
    <div id="${detailId}" class="thread-card-details">
      <section aria-label="Thread metadata">
        <h5>Metadata and outcome</h5>
        ${renderDetailRows(metadataRows)}
      </section>
      <section aria-label="Observed thread activity">
        <h5>Observed activity</h5>
        ${renderThreadActivity(tile.activity)}
      </section>
      <section class="thread-retained-section" aria-label="Retained episodes">
        <h5>Retained episodes (${tile.episodes.length})</h5>
        ${tile.episodes.length === 0
          ? `<div class="thread-detail-empty">No retained episodes.</div>`
          : `<div class="dense-sublist">${tile.episodes.map(renderThreadEpisode).join("")}</div>`}
      </section>
    </div>`;
}

function renderWorksets(snapshot) {
  const worksets = snapshot.worksets?.items || [];
  if (snapshot.worksets?.error) {
    el.worksetsView.innerHTML = `<div class="empty-state">${escapeHtml(snapshot.worksets.error)}</div>`;
    return;
  }
  if (worksets.length === 0) {
    el.worksetsView.innerHTML = `<div class="empty-state">No worksets.</div>`;
    return;
  }

  el.worksetsView.innerHTML = worksets.map((workset) => {
    const items = workset.items || [];
    return `
      <div class="dense-item workset-row">
        <div class="dense-title"><span>${escapeHtml(workset.id)}</span><span>${escapeHtml(workset.status)}</span></div>
        <div class="dense-meta"><span>${items.length} items</span><span>updated ${escapeHtml(formatDetailValue(workset.updated_at))}</span></div>
        ${renderDetailRows([
          ["session", workset.session_id],
          ["created", workset.created_at],
          ["updated", workset.updated_at],
          ["summary", workset.summary],
          ["goal", workset.goal],
          ["verification", workset.verification_recipe],
        ])}
        <div class="dense-section-title">items</div>
        ${items.length === 0
          ? `<div class="dense-body muted">No workset items.</div>`
          : `<div class="dense-sublist">${items.map(renderWorksetItem).join("")}</div>`}
      </div>`;
  }).join("");
}

function renderThreadEpisode(episode) {
  return `
    <div class="dense-subitem">
      ${renderDetailRows([
        ["episode", episode.id],
        ["session", episode.session_id],
        ["created", episode.created_at],
        ["action", episode.action],
      ])}
      <div class="dense-body">${escapeHtml(episode.content || "")}</div>
    </div>`;
}

function renderWorksetItem(item, index) {
  return `
    <div class="dense-subitem">
      <div class="dense-title dense-title-compact"><span>${index + 1}. ${escapeHtml(formatDetailValue(item.title))}</span><span>${escapeHtml(formatDetailValue(item.role))}</span></div>
      ${renderDetailRows([
        ["scope", item.scope],
        ["description", item.description],
        ["depends on", item.depends_on],
        ["acceptance", item.acceptance],
        ["notes", item.notes],
        ["updated", item.updated_at],
      ])}
    </div>`;
}

function renderDetailRows(rows) {
  return `<div class="dense-detail-grid">${rows.map(([label, value]) => renderDetailRow(label, value)).join("")}</div>`;
}

function renderDetailRow(label, value) {
  return `
    <div class="dense-detail-row">
      <span>${escapeHtml(label)}</span>
      <span>${escapeHtml(formatDetailValue(value))}</span>
    </div>`;
}

function formatDetailValue(value) {
  if (Array.isArray(value)) {
    return value.length ? value.map(formatDetailValue).join(", ") : "--";
  }
  if (value === null || value === undefined || value === "") return "--";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function handleWorkspaceFileClick(event) {
  const button = event.target.closest("button[data-workspace-path]");
  if (!button || !el.workspaceView.contains(button) || button.disabled) return;

  const sessionId = state.selectedId;
  const path = button.dataset.workspacePath;
  if (!sessionId || !path) return;

  const selectedPath = state.workspaceSelectedPathBySession.get(sessionId);
  if (selectedPath === path) {
    state.workspaceSelectedPathBySession.delete(sessionId);
    clearResolvedWorkspaceDiff(sessionId, path);
    requestInspectorRender();
    return;
  }

  if (selectedPath) clearResolvedWorkspaceDiff(sessionId, selectedPath);
  state.workspaceSelectedPathBySession.set(sessionId, path);
  requestWorkspaceDiff(sessionId, path);
  requestInspectorRender();
}

function requestWorkspaceDiff(sessionId, path) {
  if (!sessionId || !path) return null;

  const entryKey = workspaceDiffEntryKey(sessionId, path);
  const entry = state.workspaceDiffEntries.get(entryKey);
  if (entry?.status === "loading") return entry;

  const requestId = ++state.workspaceDiffRequestSeq;
  const loadingEntry = { status: "loading", requestId };
  state.workspaceDiffEntries.set(entryKey, loadingEntry);
  loadWorkspaceDiff(sessionId, path, entryKey, requestId);
  return loadingEntry;
}

async function loadWorkspaceDiff(sessionId, path, entryKey = workspaceDiffEntryKey(sessionId, path), requestId = ++state.workspaceDiffRequestSeq) {
  state.workspaceDiffEntries.set(entryKey, { status: "loading", requestId });

  try {
    const params = new URLSearchParams({
      path,
      stage: WORKSPACE_DIFF_STAGE,
      context: String(WORKSPACE_DIFF_CONTEXT),
    });
    const payload = await apiGet(`/sessions/${encodeURIComponent(sessionId)}/workspace/diff?${params.toString()}`);
    if (!workspaceDiffRequestIsCurrent(entryKey, requestId)) return;
    if (state.workspaceSelectedPathBySession.get(sessionId) !== path) {
      state.workspaceDiffEntries.delete(entryKey);
      return;
    }
    state.workspaceDiffEntries.set(entryKey, { status: "ready", payload });
  } catch (error) {
    if (!workspaceDiffRequestIsCurrent(entryKey, requestId)) return;
    if (state.workspaceSelectedPathBySession.get(sessionId) !== path) {
      state.workspaceDiffEntries.delete(entryKey);
      return;
    }
    state.workspaceDiffEntries.set(entryKey, {
      status: "error",
      error: error.message || String(error),
    });
  }

  if (state.selectedId === sessionId && state.activeTab === "workspace") requestInspectorRender();
}

function workspaceDiffRequestIsCurrent(entryKey, requestId) {
  const entry = state.workspaceDiffEntries.get(entryKey);
  return entry?.status === "loading" && entry.requestId === requestId;
}

function clearResolvedWorkspaceDiff(sessionId, path) {
  const entryKey = workspaceDiffEntryKey(sessionId, path);
  const entry = state.workspaceDiffEntries.get(entryKey);
  if (entry?.status !== "loading") state.workspaceDiffEntries.delete(entryKey);
}

function workspaceDiffEntryKey(sessionId, path) {
  return JSON.stringify([sessionId, path, WORKSPACE_DIFF_STAGE, WORKSPACE_DIFF_CONTEXT]);
}

function renderWorkspace(snapshot) {
  const sessionId = snapshot.metadata?.session_id || state.selectedId;

  const workspace = snapshot.workspace;
  if (!workspace) {
    el.workspaceView.innerHTML = `<div class="empty-state">No workspace snapshot.</div>`;
    return;
  }
  if (workspace.error) {
    el.workspaceView.innerHTML = `<div class="empty-state">${escapeHtml(workspace.error)}</div>`;
    return;
  }

  const files = workspace.changed_files || [];
  const visibleFiles = files.slice(0, WORKSPACE_FILE_LIMIT);
  let selectedPath = sessionId ? state.workspaceSelectedPathBySession.get(sessionId) : null;
  if (selectedPath && !visibleFiles.some((file) => file.path === selectedPath && workspaceFileIsExpandable(file))) {
    clearResolvedWorkspaceDiff(sessionId, selectedPath);
    state.workspaceSelectedPathBySession.delete(sessionId);
    selectedPath = null;
  }

  const header = `
    <div class="dense-item workspace-summary">
      <div class="dense-title"><span>${escapeHtml(workspace.repo_label || "workspace")}</span><span>${escapeHtml(workspace.branch || "detached")}</span></div>
      <div class="dense-meta"><span>${files.length} files</span><span>+${workspace.total_additions} -${workspace.total_deletions}</span></div>
    </div>`;
  const rows = files.length === 0
    ? `<div class="empty-state">Working tree clean.</div>`
    : visibleFiles.map((file, index) => renderWorkspaceFile(sessionId, file, selectedPath, index)).join("");
  const limitNotice = files.length > visibleFiles.length
    ? `<div class="workspace-limit">Showing first ${WORKSPACE_FILE_LIMIT} of ${files.length} changed files.</div>`
    : "";
  el.workspaceView.innerHTML = header + rows + limitNotice;
}

function renderWorkspaceFile(sessionId, file, selectedPath, index) {
  const path = file?.path || "";
  const status = file?.status || "";
  const additions = file?.additions ?? 0;
  const deletions = file?.deletions ?? 0;
  const unsupportedReason = workspaceFileUnsupportedReason(file);
  const regionId = `workspace-diff-${index}`;

  if (unsupportedReason) {
    return `
      <div class="workspace-file-block">
        <button type="button" class="dense-item workspace-file unsupported" disabled aria-disabled="true" title="${escapeAttr(unsupportedReason)}">
          <span class="dense-title"><span>${escapeHtml(path)}</span><span>${escapeHtml(status)}</span></span>
          <span class="dense-meta"><span>+${additions}</span><span>-${deletions}</span><span class="workspace-file-affordance">${escapeHtml(workspaceFileUnsupportedLabel(file))}</span></span>
        </button>
      </div>`;
  }

  const isSelected = path === selectedPath;
  return `
    <div class="workspace-file-block">
      <button type="button" class="dense-item workspace-file ${isSelected ? "selected" : ""}" data-workspace-path="${escapeAttr(path)}" aria-expanded="${isSelected ? "true" : "false"}"${isSelected ? ` aria-controls="${escapeAttr(regionId)}"` : ""}>
        <span class="dense-title"><span>${escapeHtml(path)}</span><span>${escapeHtml(status)}</span></span>
        <span class="dense-meta"><span>+${additions}</span><span>-${deletions}</span></span>
      </button>
      ${isSelected ? renderWorkspaceDiff(sessionId, path, regionId) : ""}
    </div>`;
}

function workspaceFileIsExpandable(file) {
  return !workspaceFileUnsupportedReason(file);
}

function workspaceFileUnsupportedReason(file) {
  if (workspaceFileHasPathPair(file)) return null;

  const kind = workspaceFileUnsupportedKind(file);
  if (!kind) return null;

  return `${kind} diff unavailable: workspace data does not include separate old/new paths.`;
}

function workspaceFileUnsupportedLabel(file) {
  const kind = workspaceFileUnsupportedKind(file);
  return kind ? `${kind.toLowerCase()} unsupported` : "unsupported";
}

function workspaceFileUnsupportedKind(file) {
  const status = String(file?.status || "").toUpperCase();
  if (status.includes("C")) return "Copy";
  if (status.includes("R")) return "Rename";
  if (/\s(?:->|=>)\s/.test(String(file?.path || ""))) return "Rename/copy";
  return null;
}

function workspaceFileHasPathPair(file) {
  return Boolean(file?.old_path && file?.path && file.old_path !== file.path);
}

function renderWorkspaceDiff(sessionId, path, regionId) {
  const entry = state.workspaceDiffEntries.get(workspaceDiffEntryKey(sessionId, path));

  if (!entry) {
    return `
      <section id="${escapeAttr(regionId)}" class="diff-viewer" role="region" aria-label="Diff for ${escapeAttr(path)}">
        <div class="diff-state">Diff is not loaded. Close and reopen this row to fetch it.</div>
      </section>`;
  }
  if (entry.status === "loading") {
    return `
      <section id="${escapeAttr(regionId)}" class="diff-viewer" role="region" aria-live="polite" aria-label="Diff for ${escapeAttr(path)}">
        <div class="diff-state">Loading diff...</div>
      </section>`;
  }
  if (entry.status === "error") {
    return `
      <section id="${escapeAttr(regionId)}" class="diff-viewer" role="region" aria-label="Diff for ${escapeAttr(path)}">
        <div class="diff-state error">Failed to load diff: ${escapeHtml(entry.error)}. Close and reopen this row to retry.</div>
      </section>`;
  }
  return renderWorkspaceDiffPayload(entry.payload, path, regionId);
}

function renderWorkspaceDiffPayload(payload, fallbackPath, regionId) {
  const path = payload?.path || fallbackPath;
  const oldPath = payload?.old_path && payload.old_path !== path ? payload.old_path : null;
  const title = oldPath ? `${oldPath} -> ${path}` : path;
  const sections = Array.isArray(payload?.sections) ? payload.sections : [];
  const rootError = payload?.error ? renderDiffState(payload.error, "error") : "";
  const body = sections.length
    ? sections.map((section) => renderWorkspaceDiffSection(section, path)).join("")
    : renderDiffState("No diff sections returned.", "muted");

  return `
    <section id="${escapeAttr(regionId)}" class="diff-viewer" role="region" aria-label="Diff for ${escapeAttr(path)}">
      <div class="diff-viewer-title"><span>${escapeHtml(title)}</span><span>${sections.length} section${sections.length === 1 ? "" : "s"}</span></div>
      ${rootError}${body}
    </section>`;
}

function renderWorkspaceDiffSection(section, path) {
  const stage = section?.stage || "diff";
  const status = section?.status || "changed";
  const additions = section?.additions ?? 0;
  const deletions = section?.deletions ?? 0;
  const hunks = Array.isArray(section?.hunks) ? section.hunks : [];
  const flags = [
    section?.binary ? "binary" : null,
    section?.too_large ? "too large" : null,
    section?.truncated ? "truncated" : null,
  ].filter(Boolean);
  const meta = [`${additions} additions`, `${deletions} deletions`, ...flags];
  const messages = [];
  if (section?.error) messages.push(renderDiffState(section.error, "error"));
  if (section?.binary) messages.push(renderDiffState("Binary or non-UTF-8 content; inline hunks are unavailable.", "muted"));
  if (section?.too_large) messages.push(renderDiffState("File is too large for inline diff rendering.", "muted"));
  if (section?.truncated) messages.push(`<div class="diff-warning">Diff was truncated by the backend.</div>`);

  let body = messages.join("");
  if (!section?.error && !section?.binary && !section?.too_large) {
    body += hunks.length
      ? renderWorkspaceDiffTable(path, stage, hunks)
      : renderDiffState("No hunks for this section.", "muted");
  }

  return `
    <div class="diff-section">
      <div class="diff-section-head">
        <div><span class="diff-section-stage">${escapeHtml(stage)}</span><span>${escapeHtml(status)}</span></div>
        <div>${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
      </div>
      ${body}
    </div>`;
}

function renderWorkspaceDiffTable(path, stage, hunks) {
  return `
    <div class="diff-table-wrap">
      <table class="diff-table">
        <caption>${escapeHtml(path)} ${escapeHtml(stage)} unified diff</caption>
        <thead>
          <tr><th scope="col">Old</th><th scope="col">New</th><th scope="col">Mark</th><th scope="col">Content</th></tr>
        </thead>
        ${hunks.map(renderWorkspaceDiffHunk).join("")}
      </table>
    </div>`;
}

function renderWorkspaceDiffHunk(hunk) {
  const lines = Array.isArray(hunk?.lines) ? hunk.lines : [];
  const oldStart = hunk?.old_start ?? 0;
  const oldLines = hunk?.old_lines ?? 0;
  const newStart = hunk?.new_start ?? 0;
  const newLines = hunk?.new_lines ?? 0;
  const hunkLabel = `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@${hunk?.function_context ? ` ${hunk.function_context}` : ""}`;
  return `
    <tbody>
      <tr class="diff-line hunk">
        <td class="diff-gutter old">${escapeHtml(oldStart)}</td>
        <td class="diff-gutter new">${escapeHtml(newStart)}</td>
        <td class="diff-marker">@@</td>
        <td class="diff-code">${escapeHtml(hunkLabel)}</td>
      </tr>
      ${lines.map(renderWorkspaceDiffLine).join("")}
    </tbody>`;
}

function renderWorkspaceDiffLine(line) {
  const kind = line?.kind || "context";
  const lineClass = kind === "insert" ? "add" : kind === "delete" ? "del" : "context";
  const marker = kind === "insert" ? "+" : kind === "delete" ? "-" : " ";
  const markerLabel = kind === "insert" ? "added" : kind === "delete" ? "deleted" : "context";
  const oldLine = line?.old_lineno ?? "";
  const newLine = line?.new_lineno ?? "";
  const noNewline = line?.has_trailing_newline === false
    ? `<span class="diff-no-newline"> No newline at end of file</span>`
    : "";

  return `
    <tr class="diff-line ${lineClass}">
      <td class="diff-gutter old">${escapeHtml(oldLine)}</td>
      <td class="diff-gutter new">${escapeHtml(newLine)}</td>
      <td class="diff-marker" aria-label="${escapeAttr(markerLabel)}">${marker === " " ? "&nbsp;" : escapeHtml(marker)}</td>
      <td class="diff-code">${escapeHtml(line?.content ?? "")}${noNewline}</td>
    </tr>`;
}

function renderDiffState(message, tone) {
  return `<div class="diff-state ${tone === "error" ? "error" : ""}">${escapeHtml(message)}</div>`;
}

function renderTabs() {
  el.tabs.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.activeTab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${state.activeTab}`);
  });
  if (!chatPanelIsVisible(state.selectedId)) stopWaitingLife();
}

function filteredSessions() {
  return state.sessions;
}

function getSessionEvents(sessionId) {
  if (!sessionId) return [];
  return state.eventsBySession.get(sessionId) || [];
}

function serverSubmittedUserMessages(sessionId, snapshot = state.snapshots.get(sessionId)) {
  const activeRun = snapshot?.active_run;
  const submitted = activeRun?.submitted_user_message;
  if (!submitted || !submitted.content) return [];
  const runId = String(submitted.run_id || activeRunId(activeRun) || "");
  return [{
    id: `server-pending-${runId || submitted.submitted_at_epoch_ms || sessionId}`,
    role: "user",
    content: submitted.content,
    pending: true,
    run_id: runId,
    client_id: submitted.client_id || activeRun?.client_id || null,
    baselineUserCount: Number.isInteger(submitted.baseline_user_message_count) ? submitted.baseline_user_message_count : null,
    submitted_at_epoch_ms: submitted.submitted_at_epoch_ms || activeRun?.started_at_epoch_ms || null,
  }];
}

function effectivePendingMessages(sessionId, snapshot = state.snapshots.get(sessionId)) {
  const canonicalMessages = snapshot?.messages || [];
  return serverSubmittedUserMessages(sessionId, snapshot)
    .filter((message) => !pendingMessageCoveredByCanonical(message, canonicalMessages));
}

function latestPendingUserPrompt(sessionId, snapshot = state.snapshots.get(sessionId)) {
  const pending = effectivePendingMessages(sessionId, snapshot);
  const message = pending.at(-1);
  return message ? messageDisplayText(message) : null;
}

function pendingMessageCoveredByCanonical(pendingMessage, canonicalMessages) {
  const baseline = pendingMessage?.baselineUserCount;
  if (!Number.isInteger(baseline)) return false;
  const userMessages = (canonicalMessages || []).filter((message) => message.role === "user");
  for (let index = baseline; index < userMessages.length; index += 1) {
    if (pendingMessagesMatch(userMessages[index], pendingMessage)) return true;
  }
  return false;
}

function pendingMessagesMatch(left, right) {
  const leftRunId = String(left?.run_id || "");
  const rightRunId = String(right?.run_id || "");
  if (leftRunId && rightRunId && leftRunId === rightRunId) return true;
  return messageText(left) === messageText(right);
}

function effectiveMessageCount(sessionId, snapshot = state.snapshots.get(sessionId)) {
  return (snapshot?.messages?.length || 0) + effectivePendingMessages(sessionId, snapshot).length;
}

function requestChatScrollToBottom() {
  state.scrollChatToBottom = true;
}

function syncPromptBusy(sessionId, snapshot = state.snapshots.get(sessionId)) {
  const hasSession = Boolean(sessionId);
  const hasUsableSession = Boolean(sessionId && snapshot);
  const busy = hasSession && sessionHasActiveRun(sessionId, snapshot);
  const disabled = !hasUsableSession || busy;
  const showLife = busy && chatPanelIsVisible(sessionId);
  el.promptForm.classList.toggle("busy", busy);
  el.promptForm.dataset.busyText = busy && !showLife ? "Awaiting orchestrator reply." : "";
  el.promptForm.setAttribute("aria-busy", busy ? "true" : "false");
  el.promptInput.disabled = disabled;
  el.promptInput.hidden = showLife;
  el.promptInput.setAttribute("aria-busy", busy ? "true" : "false");
  const submitButton = el.promptForm.querySelector(".prompt-submit");
  if (submitButton) {
    submitButton.disabled = disabled;
    submitButton.setAttribute("aria-disabled", disabled ? "true" : "false");
  }
  syncPromptLife(sessionId, snapshot, showLife);
}

function ensurePromptLifeElement() {
  let promptLife = el.promptLife && el.promptLife.isConnected
    ? el.promptLife
    : el.promptForm.querySelector(".prompt-life");

  if (!promptLife) {
    promptLife = document.createElement("div");
    promptLife.className = "prompt-life life-waiting";
    promptLife.hidden = true;
    promptLife.setAttribute("role", "status");
    promptLife.setAttribute("aria-live", "polite");
    promptLife.setAttribute("aria-atomic", "true");
  } else {
    promptLife.classList.add("prompt-life", "life-waiting");
    promptLife.setAttribute("role", promptLife.getAttribute("role") || "status");
    promptLife.setAttribute("aria-live", promptLife.getAttribute("aria-live") || "polite");
    promptLife.setAttribute("aria-atomic", promptLife.getAttribute("aria-atomic") || "true");
  }

  promptLife.style.background = "transparent";

  let canvas = promptLife.querySelector(".prompt-life-canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.className = "prompt-life-canvas life-waiting-canvas";
    canvas.setAttribute("aria-hidden", "true");
    promptLife.prepend(canvas);
  } else {
    canvas.classList.add("prompt-life-canvas", "life-waiting-canvas");
    canvas.setAttribute("aria-hidden", "true");
  }
  canvas.style.background = "transparent";

  let label = promptLife.querySelector(".prompt-life-label");
  if (!label) {
    label = document.createElement("div");
    label.className = "prompt-life-label life-waiting-label";
    promptLife.append(label);
  } else {
    label.classList.add("prompt-life-label", "life-waiting-label");
  }
  label.textContent = "Awaiting orchestrator reply.";

  const submitButton = el.promptForm.querySelector(".prompt-submit");
  if (promptLife.parentElement !== el.promptForm || promptLife.nextElementSibling !== submitButton) {
    if (submitButton && submitButton.parentElement === el.promptForm) {
      el.promptForm.insertBefore(promptLife, submitButton);
    } else if (el.promptInput.parentElement === el.promptForm) {
      el.promptInput.insertAdjacentElement("afterend", promptLife);
    } else {
      el.promptForm.append(promptLife);
    }
  }

  el.promptLife = promptLife;
  el.promptLifeCanvas = canvas;
  el.promptLifeLabel = label;
  return promptLife;
}

function syncPromptLife(sessionId, snapshot, showLife) {
  const promptLife = ensurePromptLifeElement();
  promptLife.hidden = !showLife;
  promptLife.setAttribute("aria-hidden", showLife ? "false" : "true");
  if (!showLife) {
    delete promptLife.dataset.sessionId;
    stopWaitingLife();
    return;
  }

  promptLife.dataset.sessionId = sessionId || "";
  syncWaitingLife(
    el.promptLifeCanvas,
    sessionId,
    waitingLifeSeedKey(sessionId, snapshot, snapshot?.messages),
    true,
  );
}

function pushEnvelopeForSession(sessionId, envelope) {
  const events = getSessionEvents(sessionId).slice();
  events.unshift(envelope);
  state.eventsBySession.set(sessionId, events.slice(0, 320));
  observeThreadEvent(sessionId, envelope);
}

function pushLocalEvent(kind, detail, sessionId = state.selectedId) {
  if (!sessionId) return;
  pushEnvelopeForSession(sessionId, {
    local: true,
    sequence_id: null,
    session_id: sessionId,
    event: { type: kind, detail },
  });
  requestEventsRender();
}

function eventKind(envelope) {
  if (envelope.local) return envelope.event.type;
  const event = envelope.event || {};
  if (event.type === "agent") return event.event?.type || "agent";
  return event.type || "event";
}

function agentEvent(envelope) {
  const event = envelope.event || {};
  return event.type === "agent" ? event.event || null : null;
}

function observeThreadEvent(sessionId, envelope) {
  const event = agentEvent(envelope);
  if (!event || !event.name) return;
  if (!["thread_started", "thread_finished", "thread_log"].includes(event.type)) return;

  const threads = new Map(state.activeThreadsBySession.get(sessionId) || []);
  const existing = threads.get(event.name) || {
    name: event.name,
    status: "pending",
    action: "waiting",
    source_threads: [],
  };

  if (event.type === "thread_started") {
    threads.set(event.name, {
      ...existing,
      status: "active",
      action: event.action || existing.action,
      source_threads: event.source_threads || [],
      started_sequence_id: envelope.sequence_id,
    });
  } else if (event.type === "thread_finished") {
    threads.set(event.name, {
      ...existing,
      status: event.timed_out ? "timed out" : "finished",
      exit_code: event.exit_code,
      timed_out: event.timed_out,
      finished_sequence_id: envelope.sequence_id,
    });
  } else if (event.type === "thread_log") {
    threads.set(event.name, {
      ...existing,
      last_log: event.line || "",
    });
  }

  state.activeThreadsBySession.set(sessionId, threads);
}

function syncActiveThreadsFromSnapshot(sessionId, snapshot) {
  const activeNames = new Set(snapshot.active_threads || []);
  const threads = new Map(state.activeThreadsBySession.get(sessionId) || []);
  for (const name of activeNames) {
    if (!threads.has(name)) {
      threads.set(name, {
        name,
        status: "active",
        action: "running",
        source_threads: [],
      });
    } else {
      threads.set(name, { ...threads.get(name), status: "active" });
    }
  }

  for (const [name, thread] of threads) {
    if (thread.status === "active" && !activeNames.has(name)) {
      threads.set(name, { ...thread, status: "finished" });
    }
  }

  state.activeThreadsBySession.set(sessionId, threads);
}

function eventDetail(envelope) {
  const event = envelope.event || {};
  if (envelope.local) return event.detail || "";
  if (event.type === "agent") {
    const inner = event.event || {};
    if (inner.type === "tool_call_started") {
      const args = inner.args_preview || (inner.args_detail ? inner.args_detail.slice(0, 200) : "");
      return `${inner.name || "tool"}(${args})`;
    }
    if (inner.type === "tool_call_finished") {
      const prefix = inner.is_error ? "ERROR " : "";
      return `${prefix}${inner.name || "tool"}: ${inner.content_preview || ""}`;
    }
    return inner.message || inner.line || inner.content || inner.name || inner.prompt_preview || JSON.stringify(inner);
  }
  return event.response || event.message || event.prompt_preview || event.session_id || JSON.stringify(event);
}

function updateSessionActivity(sessions) {
  const seen = new Set();
  for (const entry of sessions) {
    const sessionId = entry.summary.session_id;
    const remoteActive = activeRunCountsForSession(sessionId, entry.active_run);
    if (remoteActive) {
      clearRunSubmitting(sessionId);
      if (entry.active_run?.started_at_epoch_ms) {
        state.runStartedAtBySession.set(sessionId, entry.active_run.started_at_epoch_ms);
      }
    }
    const isSubmitting = state.submittingRunsBySession.has(sessionId);
    const isActive = remoteActive || isSubmitting;
    const wasActive = state.activeRunsBySession.get(sessionId) === true;
    if (isActive) {
      clearSessionAttention(sessionId);
    } else if (wasActive) {
      state.attentionSessions.add(sessionId);
    }
    if (!isActive) {
      state.runStartedAtBySession.delete(sessionId);
    }
    state.activeRunsBySession.set(sessionId, isActive);
    seen.add(sessionId);
  }

  for (const sessionId of state.activeRunsBySession.keys()) {
    if (!seen.has(sessionId)) {
      state.activeRunsBySession.delete(sessionId);
      state.terminalRunsBySession.delete(sessionId);
      state.runStartedAtBySession.delete(sessionId);
      clearRunSubmitting(sessionId);
      state.attentionSessions.delete(sessionId);
    }
  }
}

function clearSessionAttention(sessionId) {
  state.attentionSessions.delete(sessionId);
}

function markSessionAttention(sessionId) {
  if (!sessionIsActive(sessionId)) return;
  state.attentionSessions.add(sessionId);
  state.activeRunsBySession.set(sessionId, false);
}

function sessionIsActive(sessionId) {
  if (!sessionId) return false;
  if (state.submittingRunsBySession.has(sessionId)) return true;
  if (state.activeRunsBySession.get(sessionId) === true) return true;
  return state.sessions.some((entry) => entry.summary.session_id === sessionId && activeRunCountsForSession(sessionId, entry.active_run));
}

function sessionHasActiveRun(sessionId, snapshot = state.snapshots.get(sessionId)) {
  if (!sessionId) return false;
  if (state.submittingRunsBySession.has(sessionId)) return true;
  if (state.activeRunsBySession.get(sessionId) === true) return true;
  return Boolean(activeRunCountsForSession(sessionId, snapshot?.active_run) || sessionIsActive(sessionId));
}

function sessionStatusClass(entry) {
  const sessionId = entry.summary.session_id;
  if (activeRunCountsForSession(sessionId, entry.active_run)) return "active";
  if (state.attentionSessions.has(sessionId)) return "attention";
  if (entry.summary.sandboxed) return "sandbox";
  return "idle";
}

function workspaceDiffStats(snapshot, listDiff) {
  const workspace = snapshot?.workspace;
  if (workspace && !workspace.error) {
    return formatWorkspaceDiffTotals(workspace);
  }
  if (listDiff && !listDiff.error) {
    return formatWorkspaceDiffTotals(listDiff);
  }
  return { additions: "--", deletions: "--" };
}

function formatWorkspaceDiffTotals(totals) {
  const additions = Number(totals.total_additions);
  const deletions = Number(totals.total_deletions);
  if (!Number.isFinite(additions) || !Number.isFinite(deletions)) {
    return { additions: "--", deletions: "--" };
  }

  return { additions: `+${additions}`, deletions: `-${deletions}` };
}

function formatToolCalls(toolCalls) {
  if (!toolCalls || toolCalls.length === 0) return "";
  return toolCalls.map((call) => {
    const name = call.function?.name || "tool";
    const args = call.function?.arguments || "";
    const preview = args.length > 100 ? args.slice(0, 97) + "..." : args;
    return `${name}(${preview}) [${call.id}]`;
  }).join("\n");
}

function messageText(message) {
  return message.content || message.reasoning_text || formatToolCalls(message.tool_calls) || "";
}

function messageDisplayText(message) {
  const text = messageText(message);
  return message.role === "user" ? displayPromptFromMessageText(text) : text;
}

function displayPromptFromMessageText(content) {
  const text = String(content || "");
  const normalized = text.replaceAll("\r\n", "\n");
  const header = normalized.split("\n", 1)[0] || "";
  const match = header.match(/^# \/(plan|run)\s*:/);
  if (!match) return text;

  const kind = match[1];
  const marker = kind === "run" ? "Workset id:\n" : "User instruction:\n";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) return text;

  const valueStart = markerIndex + marker.length;
  const valueEnd = normalized.indexOf("\n\n", valueStart);
  if (valueEnd === -1) return text;

  const value = normalized.slice(valueStart, valueEnd).trim();
  return value ? `/${kind} ${value}` : text;
}

function displaySessionTitle(summary) {
  const title = typeof summary?.title === "string" ? summary.title.trim() : "";
  return title || shortId(summary?.session_id || "");
}

function setLaunchStatus(message, error) {
  el.launchStatus.textContent = message || "";
  el.launchStatus.classList.toggle("error", Boolean(error));
}

function serializeExtraHeaders(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw new Error("Extra Headers must be valid JSON");
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Extra Headers must be a JSON object with string keys and string values");
  }
  for (const [key, headerValue] of Object.entries(parsed)) {
    if (typeof headerValue !== "string") {
      throw new Error(`Extra Headers value for "${key}" must be a string`);
    }
  }
  return JSON.stringify(parsed);
}

function nullable(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed : null;
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function shortId(id) {
  if (!id) return "--";
  return id.length > 13 ? `${id.slice(0, 8)}:${id.slice(-4)}` : id;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function safeClassToken(value) {
  const token = String(value || "");
  return /^[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

function formatRuntime(ms) {
  if (ms == null || ms < 0) return "00:00:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatDuration(ms) {
  if (ms == null) return null;
  return formatRuntime(ms);
}

function formatTokens(n) {
  if (n == null || !Number.isFinite(n)) return "--";
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + "k";
  if (n < 1000000) return Math.round(n / 1000) + "k";
  return (n / 1000000).toFixed(1) + "M";
}

function startLiveTimer() {
  if (state.liveTimerInterval) return;
  state.liveTimerInterval = setInterval(() => {
    if (state.runStartedAtBySession.size === 0) {
      stopLiveTimer();
      return;
    }
    const now = Date.now();
    const selectedId = state.selectedId;
    if (selectedId) {
      const startedAt = state.runStartedAtBySession.get(selectedId);
      if (startedAt) {
        el.snapRun.textContent = formatRuntime(now - startedAt);
      }
    }
    document.querySelectorAll("[data-run-timer]").forEach((tile) => {
      const sid = tile.dataset.runTimer;
      if (!sid) return;
      const startedAt = state.runStartedAtBySession.get(sid);
      if (startedAt) {
        tile.textContent = formatRuntime(now - startedAt);
      }
    });
  }, 200);
}

function stopLiveTimer() {
  if (state.liveTimerInterval) {
    clearInterval(state.liveTimerInterval);
    state.liveTimerInterval = null;
  }
}
