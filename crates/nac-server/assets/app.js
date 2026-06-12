const state = {
  store: null,
  sessions: [],
  snapshots: new Map(),
  selectedId: null,
  eventsBySession: new Map(),
  activeThreadsBySession: new Map(),
  pendingMessagesBySession: new Map(),
  attentionSessions: new Set(),
  activeRunsBySession: new Map(),
  terminalRunsBySession: new Map(),
  submittingRunsBySession: new Set(),
  submittingRunTimersBySession: new Map(),
  eventSource: null,
  lastSequence: new Map(),
  activeTab: "chat",
  mobileDetailOpen: false,
  scrollChatToBottom: false,
  waitingLife: null,
};

const el = {};

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
    "rootCwd",
    "selectedId",
    "eventCount",
    "matrixSubtitle",
    "sessionGrid",
    "inspectorTitle",
    "inspectorMeta",
    "cancelRun",
    "mobileBack",
    "tabs",
    "snapModel",
    "snapBackend",
    "snapMessages",
    "snapRun",
    "transcript",
    "promptForm",
    "promptInput",
    "eventLog",
    "threadsView",
    "worksetsView",
    "workspaceView",
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
  el.mobileBack.addEventListener("click", showMobileSessions);
  el.closeLaunch.addEventListener("click", hideLaunchOverlay);
  el.launchOverlay.addEventListener("click", (event) => {
    if (event.target === el.launchOverlay) hideLaunchOverlay();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!el.launchOverlay.hidden) hideLaunchOverlay();
  });

  el.tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tab]");
    if (!button) return;
    state.activeTab = button.dataset.tab;
    renderInspector();
  });
}

async function boot() {
  try {
    state.store = await apiGet("/store");
    el.storePath.textContent = basename(state.store.store_path);
    el.rootCwd.textContent = state.store.root_cwd;
    el.launchCwd.value = state.store.root_cwd;
  } catch (error) {
    setLaunchStatus(error.message, true);
  }

  renderLaunchHostFields();
  await loadSessions();
  setInterval(loadSessions, 5000);
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

async function readJson(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(payload.error || `${response.status} ${response.statusText}`);
  }
  return payload;
}

async function loadSessions() {
  try {
    const sessions = sortSessionsByCreation(await apiGet("/sessions?workspace_stats=true"));
    sanitizeSessionListActiveRuns(sessions);
    updateSessionActivity(sessions);
    state.sessions = sessions;
    if (!state.selectedId && state.sessions.length > 0) {
      state.selectedId = state.sessions[0].summary.session_id;
      renderAll();
      loadSnapshot(state.selectedId, true);
    }
    renderAll();
  } catch (error) {
    setLaunchStatus(error.message, true);
  }
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
  try {
    const previousMessageCount = effectiveMessageCount(sessionId);
    const snapshot = await apiGet(`/sessions/${encodeURIComponent(sessionId)}`);
    sanitizeSnapshotActiveRun(sessionId, snapshot);
    if (activeRunCountsForSession(sessionId, snapshot.active_run)) {
      clearRunSubmitting(sessionId);
      state.activeRunsBySession.set(sessionId, true);
    }
    state.snapshots.set(sessionId, snapshot);
    reconcilePendingMessages(sessionId, snapshot);
    syncActiveThreadsFromSnapshot(sessionId, snapshot);
    if (state.selectedId === sessionId && effectiveMessageCount(sessionId, snapshot) > previousMessageCount) {
      requestChatScrollToBottom();
    }
    if (openStream) openEventStream(sessionId);
    if (state.selectedId === sessionId) renderAll();
    return snapshot;
  } catch (error) {
    pushLocalEvent("snapshot_error", error.message, sessionId);
    if (state.selectedId === sessionId) renderAll();
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
  el.selectedId.textContent = shortId(sessionId);
  renderAll();
  openEventStream(sessionId);
  loadSnapshot(sessionId, false);
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

function showMobileSessions() {
  state.mobileDetailOpen = false;
  renderMobileMode();
  syncPromptBusy(state.selectedId);
}

async function createSession(event) {
  event.preventDefault();
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
    await loadSessions();
    hideLaunchOverlay();
    selectSession(sessionId);
    setLaunchStatus(`launched ${shortId(sessionId)}`, false);
    if (initialPrompt) {
      const pendingMessage = queuePendingUserMessage(sessionId, initialPrompt);
      state.activeRunsBySession.set(sessionId, true);
      markRunSubmitting(sessionId);
      clearSessionAttention(sessionId);
      requestChatScrollToBottom();
      renderAll();
      try {
        await apiPost(`/sessions/${encodeURIComponent(sessionId)}/runs`, { prompt: initialPrompt });
        scheduleRunSubmittingGrace(sessionId);
        el.initialPrompt.value = "";
        setLaunchStatus(`running ${shortId(sessionId)}`, false);
      } catch (error) {
        removePendingMessage(sessionId, pendingMessage.id);
        clearRunSubmitting(sessionId);
        state.activeRunsBySession.set(sessionId, false);
        renderAll();
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

  state.activeRunsBySession.set(sessionId, true);
  markRunSubmitting(sessionId);
  clearSessionAttention(sessionId);
  const pendingMessage = queuePendingUserMessage(sessionId, prompt);
  el.promptInput.value = "";
  requestChatScrollToBottom();
  renderAll();

  try {
    const result = await apiPost(`/sessions/${encodeURIComponent(sessionId)}/runs`, { prompt });
    scheduleRunSubmittingGrace(sessionId);
    pushLocalEvent("submit", `${result.display_prompt} -> ${shortId(result.run_id)}`, sessionId);
    await loadSessions();
    await loadSnapshot(sessionId, false);
    renderAll();
  } catch (error) {
    removePendingMessage(sessionId, pendingMessage.id);
    clearRunSubmitting(sessionId);
    state.activeRunsBySession.set(sessionId, false);
    stopWaitingLife();
    pushLocalEvent("submit_error", error.message, sessionId);
    renderAll();
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
    await loadSessions();
    await loadSnapshot(sessionId, false);
  } catch (error) {
    pushLocalEvent("cancel_error", error.message, sessionId);
  }
  renderEvents();
}

function openEventStream(sessionId) {
  if (!sessionId) return;
  if (state.eventSource) state.eventSource.close();
  const last = state.lastSequence.get(sessionId);
  const params = last ? `?after_sequence_id=${last}&limit=256` : "?limit=256";
  const source = new EventSource(`/sessions/${encodeURIComponent(sessionId)}/events/stream${params}`);
  state.eventSource = source;

  source.addEventListener("session_event", (event) => {
    if (state.eventSource !== source) return;
    const envelope = JSON.parse(event.data);
    state.lastSequence.set(sessionId, envelope.sequence_id);
    pushEnvelopeForSession(sessionId, envelope);
    const runStarted = isRunStartedSessionEvent(envelope);
    const terminalRun = isTerminalSessionEvent(envelope);
    if (runStarted) {
      handleRunStarted(sessionId, envelope);
      loadSessions();
    }
    if (terminalRun) {
      handleTerminalRun(sessionId, envelope);
      loadSessions();
    }
    if (shouldRefreshSnapshot(envelope)) {
      loadSnapshot(sessionId, false);
    }
    renderAll();
  });

  source.addEventListener("replay_gap", (event) => {
    if (state.eventSource !== source) return;
    pushLocalEvent("replay_gap", event.data, sessionId);
    renderEvents();
  });

  source.addEventListener("lagged", (event) => {
    if (state.eventSource !== source) return;
    pushLocalEvent("lagged", event.data, sessionId);
    renderEvents();
  });

  source.onerror = () => {
    if (state.eventSource !== source) return;
    pushLocalEvent("stream", "connection interrupted", sessionId);
    renderEvents();
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
  return {
    run_id: runIdFromEnvelope(envelope),
    prompt_preview: envelope.event?.prompt_preview || "",
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
  if (state.selectedId === sessionId) {
    renderAll();
  } else {
    renderMetrics();
    renderSessions();
  }
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
  clearRunSubmitting(sessionId);
  clearSessionAttention(sessionId);
  const snapshot = state.snapshots.get(sessionId);
  if (snapshot) snapshot.active_run = activeRun;
  const entry = sessionEntryById(sessionId);
  if (entry) entry.active_run = activeRun;
  if (state.selectedId === sessionId) requestChatScrollToBottom();
}

function handleTerminalRun(sessionId, envelope) {
  const wasActive = sessionHasActiveRun(sessionId);
  const runId = terminalRunIdForSession(sessionId, envelope);
  state.terminalRunsBySession.set(sessionId, {
    runId,
    sequenceId: envelope.sequence_id || 0,
  });
  state.activeRunsBySession.set(sessionId, false);
  clearRunSubmitting(sessionId);
  clearCachedActiveRun(sessionId, runId);
  if (wasActive) state.attentionSessions.add(sessionId);
  if (state.selectedId === sessionId) stopWaitingLife();
}

function renderAll() {
  renderMetrics();
  renderSessions();
  renderMobileMode();
  renderInspector();
}

function renderMobileMode() {
  document.body.classList.toggle("detail-open", Boolean(state.mobileDetailOpen && state.selectedId));
  if (!chatPanelIsVisible(state.selectedId)) stopWaitingLife();
}

function renderMetrics() {
  const active = state.sessions.filter((entry) => activeRunCountsForSession(entry.summary.session_id, entry.active_run)).length;
  const sandbox = state.sessions.filter((entry) => entry.summary.sandboxed).length;
  const selectedEvents = getSessionEvents(state.selectedId);
  el.matrixSubtitle.textContent = `${state.sessions.length} tracked sessions / ${active} active / ${sandbox} sandboxed / creation ordered`;
  el.eventCount.textContent = selectedEvents.length;
  el.selectedId.textContent = state.selectedId ? shortId(state.selectedId) : "none";
}

function renderSessions() {
  const items = filteredSessions();
  const sessionCards = items.length === 0
    ? `<div class="empty-state matrix-empty">No sessions yet.</div>`
    : items.map((entry) => renderSessionCard(entry)).join("");
  el.sessionGrid.innerHTML = renderNewSessionCard() + sessionCards;
  el.sessionGrid.querySelector("[data-action='new-session']")?.addEventListener("click", showLaunchOverlay);
  el.sessionGrid.querySelectorAll("[data-session-id]").forEach((card) => {
    card.addEventListener("click", () => selectSession(card.dataset.sessionId));
  });
}

function renderNewSessionCard() {
  return `
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
    </button>`;
}

function renderSessionCard(entry) {
  const summary = entry.summary;
  const sessionId = summary.session_id;
  const snapshot = state.snapshots.get(sessionId);
  const workspaceError = snapshot?.workspace?.error || "";
  const diffStats = workspaceDiffStats(snapshot, entry.workspace_diff);
  const cardActive = activeRunCountsForSession(sessionId, entry.active_run);
  const tone = cardActive ? "" : summary.sandboxed ? "warn" : "";
  const errorish = workspaceError && !workspaceError.includes("remote/sandbox-only") ? "errorish" : "";
  const pendingCount = pendingMessages(sessionId).length;
  const promptPreview = latestPendingUserPrompt(sessionId) || displayPromptFromMessageText(summary.last_user_prompt) || "no prompt yet";
  return `
    <article class="session-card ${tone} ${errorish} ${sessionId === state.selectedId ? "selected" : ""}" data-session-id="${escapeAttr(sessionId)}">
      <div class="session-card-head">
        <div>
          <h2>${escapeHtml(shortId(sessionId))}</h2>
          <div class="cwd">${escapeHtml(summary.cwd)}</div>
        </div>
        <span class="status-dot ${sessionStatusClass(entry)}"></span>
      </div>
      <div class="badge-row">
        <span class="badge">${escapeHtml(summary.backend)}</span>
        ${summary.ssh_host ? `<span class="badge host">${escapeHtml(summary.ssh_host)}</span>` : ""}
        ${summary.sandboxed ? `<span class="badge sandbox">sandbox</span>` : ""}
      </div>
      <div class="telemetry-grid">
        <div><span>msgs</span><strong>${summary.visible_message_count + pendingCount}</strong></div>
        <div><span>add</span><strong>${escapeHtml(diffStats.additions)}</strong></div>
        <div><span>del</span><strong>${escapeHtml(diffStats.deletions)}</strong></div>
      </div>
      <div class="last-prompt">${escapeHtml(promptPreview)}</div>
    </article>`;
}

function renderInspector() {
  const sessionId = state.selectedId;
  const snapshot = sessionId ? state.snapshots.get(sessionId) : null;
  if (!sessionId || !snapshot) {
    el.inspectorTitle.textContent = sessionId ? shortId(sessionId) : "No session selected";
    el.inspectorMeta.textContent = sessionId ? "Loading snapshot." : "Launch or select a session.";
    el.snapModel.textContent = "--";
    el.snapBackend.textContent = "--";
    el.snapMessages.textContent = "0";
    el.snapRun.textContent = "idle";
    el.cancelRun.disabled = true;
    el.transcript.innerHTML = `<div class="empty-state">No selected session.</div>`;
    el.threadsView.innerHTML = "";
    el.worksetsView.innerHTML = "";
    el.workspaceView.innerHTML = "";
    renderTabs();
    syncPromptBusy(sessionId, snapshot);
    return;
  }

  const metadata = snapshot.metadata;
  const runActive = sessionHasActiveRun(metadata.session_id, snapshot);
  el.inspectorTitle.textContent = shortId(metadata.session_id);
  el.inspectorMeta.textContent = metadata.cwd;
  el.snapModel.textContent = metadata.model;
  el.snapBackend.textContent = metadata.backend;
  el.snapMessages.textContent = effectiveMessageCount(metadata.session_id, snapshot);
  el.snapRun.textContent = runActive ? "active" : "idle";
  el.cancelRun.disabled = !runActive;
  renderTabs();
  renderTranscript(metadata.session_id, snapshot.messages);
  syncPromptBusy(metadata.session_id, snapshot);
  renderThreads(snapshot);
  renderWorksets(snapshot);
  renderWorkspace(snapshot);
  renderEvents();
}

function renderTranscript(sessionId, messages) {
  const transcriptMessages = [
    ...(messages || []),
    ...pendingMessages(sessionId),
  ];
  if (transcriptMessages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No messages yet.";
    el.transcript.replaceChildren(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  transcriptMessages.slice(-80).forEach((message, index) => {
    const role = message.role || "unknown";
    const body = messageDisplayText(message);
    const row = document.createElement("div");
    row.className = "message-row";
    if (message.pending) row.classList.add("pending");

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const roleElement = document.createElement("span");
    roleElement.className = "message-role";
    const roleClass = safeClassToken(role);
    if (roleClass) roleElement.classList.add(roleClass);
    roleElement.textContent = role;

    const markerElement = document.createElement("span");
    markerElement.textContent = message.pending ? "pending" : `#${index + 1}`;

    meta.append(roleElement, markerElement);

    const bodyElement = document.createElement("div");
    bodyElement.className = "message-body markdown";
    if (!body) bodyElement.classList.add("muted");
    bodyElement.append(renderMarkdownFragment(body || "[empty]"));

    row.append(meta, bodyElement);
    fragment.append(row);
  });

  el.transcript.replaceChildren(fragment);
  if (state.scrollChatToBottom) {
    state.scrollChatToBottom = false;
    requestAnimationFrame(() => {
      el.transcript.scrollTop = el.transcript.scrollHeight;
    });
  }
}

const SUBMITTING_RUN_GRACE_MS = 15000;
const WAITING_LIFE_TICK_MS = 75;
const WAITING_LIFE_MAX_CATCHUP_STEPS = 2;
const WAITING_LIFE_SIZE_CHECK_MS = 500;
const WAITING_LIFE_SQUARE_SCALE = 0.29;
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
  return !mobileMode || Boolean(state.mobileDetailOpen);
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
  const resized = ensureWaitingLifeSize(life);
  if (resized || created) drawLifeField(life);
  if (resized || created) scheduleWaitingLifePostLayoutDraw(life);
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
    cssWidth: 0,
    cssHeight: 0,
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
  const shouldCheckSize = !life.field
    || life.sizeDirty
    || now - lastSizeCheck >= WAITING_LIFE_SIZE_CHECK_MS;
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
  const dpr = Math.max(1, Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1));
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
  const cols = clampInt(Math.floor(cssWidth / 6), 24, 96);
  const rows = clampInt(Math.floor(cssHeight / 6), 10, 44);

  if (life.pixelWidth === pixelWidth
    && life.pixelHeight === pixelHeight
    && life.cols === cols
    && life.rows === rows
    && life.field) {
    life.sizeDirty = false;
    return false;
  }

  life.canvas.width = pixelWidth;
  life.canvas.height = pixelHeight;
  life.pixelWidth = pixelWidth;
  life.pixelHeight = pixelHeight;
  life.cssWidth = cssWidth;
  life.cssHeight = cssHeight;
  life.dpr = dpr;
  life.cols = cols;
  life.rows = rows;
  life.field = createLifeField(cols, rows, `${life.seedKey}|${cols}x${rows}`);
  life.accumulator = 0;
  life.sizeDirty = false;
  return true;
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
  const cellSize = Math.max(1, Math.min(life.pixelWidth / field.cols, life.pixelHeight / field.rows));
  const squareSize = Math.max(0.5, cellSize * WAITING_LIFE_SQUARE_SCALE);
  const inset = (cellSize - squareSize) / 2;
  const offsetX = (life.pixelWidth - cellSize * field.cols) / 2;
  const offsetY = (life.pixelHeight - cellSize * field.rows) / 2;

  context.save();
  context.clearRect(0, 0, life.pixelWidth, life.pixelHeight);
  context.shadowBlur = 0;
  context.shadowColor = "transparent";
  context.globalCompositeOperation = "source-over";
  context.imageSmoothingEnabled = false;

  drawLifeSquares(context, field, offsetX, offsetY, cellSize, squareSize, inset, "dead", "rgba(255, 255, 255, 0.10)");
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

function renderEvents() {
  const events = getSessionEvents(state.selectedId);
  if (events.length === 0) {
    el.eventLog.innerHTML = `<div class="empty-state">No events captured.</div>`;
    return;
  }

  el.eventLog.innerHTML = events.slice(0, 160).map((envelope) => `
    <div class="event-item">
      <div class="event-meta">
        <span class="event-kind">${escapeHtml(eventKind(envelope))}</span>
        <span>${envelope.sequence_id ? `#${envelope.sequence_id}` : "local"}</span>
      </div>
      <div class="event-body">${escapeHtml(eventDetail(envelope))}</div>
    </div>
  `).join("");
}

function renderThreads(snapshot) {
  const sessionId = snapshot.metadata.session_id;
  const persisted = new Map((snapshot.threads || []).map((thread) => [thread.name, thread]));
  const live = state.activeThreadsBySession.get(sessionId) || new Map();
  const names = [
    ...Array.from(live.keys()),
    ...(snapshot.threads || []).map((thread) => thread.name),
  ].filter((name, index, all) => all.indexOf(name) === index);

  if (names.length === 0) {
    el.threadsView.innerHTML = `<div class="empty-state">No worker threads.</div>`;
    return;
  }

  el.threadsView.innerHTML = names.map((name) => {
    const thread = persisted.get(name);
    const liveThread = live.get(name);
    const status = liveThread?.status === "active" ? "active" : liveThread?.status || (thread ? "stored" : "pending");
    const episodes = snapshot.thread_episodes?.[name] || [];
    const action = liveThread?.action || thread?.latest_action || "no action";
    const episodeCount = thread?.episode_count ?? episodes.length;
    return `
      <div class="dense-item thread-row ${status === "active" ? "thread-active" : ""}">
        <div class="dense-title">
          <span><span class="status-dot ${status === "active" ? "active" : "idle"}"></span>${escapeHtml(name)}</span>
          <span>${escapeHtml(status)} / ${episodeCount} eps</span>
        </div>
        <div class="dense-meta"><span>${escapeHtml(action)}</span><span>${episodes.length} retained</span></div>
        ${renderDetailRows([
          ["session", thread?.session_id || sessionId],
          ["created", thread?.created_at],
          ["updated", thread?.updated_at],
          ["latest action", thread?.latest_action],
          ["live action", liveThread?.action],
          ["sources", liveThread?.source_threads],
          ["started seq", liveThread?.started_sequence_id ?? liveThread?.started_sequence],
          ["finished seq", liveThread?.finished_sequence_id ?? liveThread?.finished_sequence],
          ["exit code", liveThread?.exit_code],
          ["timed out", liveThread?.timed_out],
          ["last log", liveThread?.last_log],
        ])}
        <div class="dense-section-title">retained episodes</div>
        ${episodes.length === 0
          ? `<div class="dense-body muted">No retained episodes.</div>`
          : `<div class="dense-sublist">${episodes.map(renderThreadEpisode).join("")}</div>`}
      </div>`;
  }).join("");
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

function renderWorkspace(snapshot) {
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
  const header = `
    <div class="dense-item">
      <div class="dense-title"><span>${escapeHtml(workspace.repo_label || "workspace")}</span><span>${escapeHtml(workspace.branch || "detached")}</span></div>
      <div class="dense-meta"><span>${files.length} files</span><span>+${workspace.total_additions} -${workspace.total_deletions}</span></div>
    </div>`;
  const rows = files.length === 0 ? `<div class="empty-state">Working tree clean.</div>` : files.slice(0, 80).map((file) => `
    <div class="dense-item">
      <div class="dense-title"><span>${escapeHtml(file.path)}</span><span>${escapeHtml(file.status)}</span></div>
      <div class="dense-meta"><span>+${file.additions ?? 0}</span><span>-${file.deletions ?? 0}</span></div>
    </div>
  `).join("");
  el.workspaceView.innerHTML = header + rows;
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

function pendingMessages(sessionId) {
  if (!sessionId) return [];
  return state.pendingMessagesBySession.get(sessionId) || [];
}

function latestPendingUserPrompt(sessionId) {
  const pending = pendingMessages(sessionId);
  return pending.at(-1)?.content || null;
}

function queuePendingUserMessage(sessionId, content) {
  const message = {
    id: makeLocalId(),
    role: "user",
    content,
    pending: true,
    baselineUserCount: userMessageCount(state.snapshots.get(sessionId)),
  };
  state.pendingMessagesBySession.set(sessionId, [...pendingMessages(sessionId), message]);
  return message;
}

function removePendingMessage(sessionId, messageId) {
  const remaining = pendingMessages(sessionId).filter((message) => message.id !== messageId);
  if (remaining.length === 0) {
    state.pendingMessagesBySession.delete(sessionId);
  } else {
    state.pendingMessagesBySession.set(sessionId, remaining);
  }
}

function reconcilePendingMessages(sessionId, snapshot) {
  const pending = pendingMessages(sessionId);
  if (pending.length === 0) return;
  const userMessages = (snapshot.messages || []).filter((message) => message.role === "user");
  const matchedIndexes = new Set();
  const remaining = pending.filter((pendingMessage) => {
    for (let index = pendingMessage.baselineUserCount; index < userMessages.length; index += 1) {
      if (matchedIndexes.has(index)) continue;
      if (messageDisplayText(userMessages[index]) === messageDisplayText(pendingMessage)) {
        matchedIndexes.add(index);
        return false;
      }
    }
    return true;
  });
  if (remaining.length === 0) {
    state.pendingMessagesBySession.delete(sessionId);
  } else {
    state.pendingMessagesBySession.set(sessionId, remaining);
  }
}

function userMessageCount(snapshot) {
  return (snapshot?.messages || []).filter((message) => message.role === "user").length;
}

function effectiveMessageCount(sessionId, snapshot = state.snapshots.get(sessionId)) {
  return (snapshot?.messages?.length || 0) + pendingMessages(sessionId).length;
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
  renderMetrics();
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
    return inner.message || inner.line || inner.content || inner.name || inner.prompt_preview || JSON.stringify(inner);
  }
  return event.response || event.message || event.prompt_preview || event.session_id || JSON.stringify(event);
}

function updateSessionActivity(sessions) {
  const seen = new Set();
  for (const entry of sessions) {
    const sessionId = entry.summary.session_id;
    const remoteActive = activeRunCountsForSession(sessionId, entry.active_run);
    if (remoteActive) clearRunSubmitting(sessionId);
    const isSubmitting = state.submittingRunsBySession.has(sessionId);
    const isActive = remoteActive || isSubmitting;
    const wasActive = state.activeRunsBySession.get(sessionId) === true;
    if (isActive) {
      clearSessionAttention(sessionId);
    } else if (wasActive) {
      state.attentionSessions.add(sessionId);
    }
    state.activeRunsBySession.set(sessionId, isActive);
    seen.add(sessionId);
  }

  for (const sessionId of state.activeRunsBySession.keys()) {
    if (!seen.has(sessionId)) {
      state.activeRunsBySession.delete(sessionId);
      state.terminalRunsBySession.delete(sessionId);
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
  return toolCalls.map((call) => `${call.function?.name || "tool"} ${call.id}`).join("\n");
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

function sortSessionsByCreation(sessions) {
  return sessions.slice().sort((left, right) => {
    const leftTime = Date.parse(left.summary.created_at) || 0;
    const rightTime = Date.parse(right.summary.created_at) || 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return right.summary.session_id.localeCompare(left.summary.session_id);
  });
}

function setLaunchStatus(message, error) {
  el.launchStatus.textContent = message || "";
  el.launchStatus.classList.toggle("error", Boolean(error));
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

function basename(path) {
  if (!path) return "--";
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || path;
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

function makeLocalId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
