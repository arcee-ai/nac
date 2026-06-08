const state = {
  store: null,
  sessions: [],
  snapshots: new Map(),
  selectedId: null,
  eventsBySession: new Map(),
  activeThreadsBySession: new Map(),
  pendingMessagesBySession: new Map(),
  eventSource: null,
  lastSequence: new Map(),
  activeTab: "chat",
  mobileDetailOpen: false,
  scrollChatToBottom: false,
};

const el = {};

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
    "launchCwd",
    "launchBackend",
    "launchEffort",
    "launchModel",
    "launchBaseUrl",
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
  el.promptForm.addEventListener("submit", submitPrompt);
  el.promptInput.addEventListener("keydown", handlePromptKeydown);
  el.cancelRun.addEventListener("click", cancelActiveRun);
  el.mobileBack.addEventListener("click", showMobileSessions);
  el.closeLaunch.addEventListener("click", hideLaunchOverlay);
  el.launchOverlay.addEventListener("click", (event) => {
    if (event.target === el.launchOverlay) hideLaunchOverlay();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !el.launchOverlay.hidden) hideLaunchOverlay();
  });

  el.tabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tab]");
    if (!button) return;
    state.activeTab = button.dataset.tab;
    renderTabs();
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
    state.sessions = sortSessionsByCreation(await apiGet("/sessions"));
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

async function loadSnapshot(sessionId, openStream = false) {
  if (!sessionId) return null;
  try {
    const previousMessageCount = effectiveMessageCount(sessionId);
    const snapshot = await apiGet(`/sessions/${encodeURIComponent(sessionId)}`);
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
}

async function createSession(event) {
  event.preventDefault();
  setLaunchStatus("launching", false);
  const initialPrompt = el.initialPrompt.value.trim();
  const body = {
    cwd: nullable(el.launchCwd.value),
    model: nullable(el.launchModel.value),
    base_url: nullable(el.launchBaseUrl.value),
    backend: nullable(el.launchBackend.value),
    reasoning_effort: nullable(el.launchEffort.value),
    sandbox: {
      enabled: el.sandboxEnabled.checked,
      no_mount_cwd: el.sandboxNoMount.checked,
      image: nullable(el.sandboxImage.value),
      gpus: csv(el.sandboxGpu.value),
      workdir: nullable(el.sandboxWorkdir.value),
      shm_size: nullable(el.sandboxShm.value),
      mounts: csv(el.sandboxMounts.value),
      mounts_ro: [],
    },
  };

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
      requestChatScrollToBottom();
      renderAll();
      try {
        await apiPost(`/sessions/${encodeURIComponent(sessionId)}/runs`, { prompt: initialPrompt });
        el.initialPrompt.value = "";
        setLaunchStatus(`running ${shortId(sessionId)}`, false);
      } catch (error) {
        removePendingMessage(sessionId, pendingMessage.id);
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
  const prompt = el.promptInput.value.trim();
  const sessionId = state.selectedId;
  if (!sessionId || !prompt) return;

  const pendingMessage = queuePendingUserMessage(sessionId, prompt);
  el.promptInput.value = "";
  requestChatScrollToBottom();
  renderAll();

  try {
    const result = await apiPost(`/sessions/${encodeURIComponent(sessionId)}/runs`, { prompt });
    pushLocalEvent("submit", `${result.display_prompt} -> ${shortId(result.run_id)}`, sessionId);
    await loadSessions();
    await loadSnapshot(sessionId, false);
    renderAll();
  } catch (error) {
    removePendingMessage(sessionId, pendingMessage.id);
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
    if (shouldRefreshSnapshot(envelope)) {
      loadSnapshot(sessionId, false);
    }
    if (isTerminalSessionEvent(envelope)) {
      loadSessions();
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

function isTerminalSessionEvent(envelope) {
  const type = envelope.event?.type;
  return type === "run_completed" || type === "run_failed" || type === "snapshot_saved";
}

function shouldRefreshSnapshot(envelope) {
  if (isTerminalSessionEvent(envelope)) return true;
  const event = agentEvent(envelope);
  return event?.type === "thread_started" || event?.type === "thread_finished";
}

function renderAll() {
  renderMetrics();
  renderSessions();
  renderInspector();
  renderMobileMode();
}

function renderMobileMode() {
  document.body.classList.toggle("detail-open", Boolean(state.mobileDetailOpen && state.selectedId));
}

function renderMetrics() {
  const active = state.sessions.filter((entry) => entry.active_run).length;
  const sandbox = state.sessions.filter((entry) => entry.summary.sandboxed).length;
  const changed = state.sessions.filter((entry) => changedCount(entry.summary.session_id) > 0).length;
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
        <small>cwd, sandbox, model, prompt</small>
      </span>
    </button>`;
}

function renderSessionCard(entry) {
  const summary = entry.summary;
  const sessionId = summary.session_id;
  const snapshot = state.snapshots.get(sessionId);
  const workspace = snapshot?.workspace;
  const workspaceError = workspace?.error || "";
  const changes = workspace?.changed_files?.length || 0;
  const runState = entry.active_run ? "active" : "idle";
  const tone = entry.active_run ? "" : summary.sandboxed ? "warn" : "";
  const errorish = workspaceError && !workspaceError.includes("sandbox-only") ? "errorish" : "";
  const pendingCount = pendingMessages(sessionId).length;
  const promptPreview = latestPendingUserPrompt(sessionId) || summary.last_user_prompt || "no prompt yet";
  return `
    <article class="session-card ${tone} ${errorish} ${sessionId === state.selectedId ? "selected" : ""}" data-session-id="${escapeAttr(sessionId)}">
      <div class="session-card-head">
        <div>
          <h2>${escapeHtml(shortId(sessionId))}</h2>
          <div class="cwd">${escapeHtml(summary.cwd)}</div>
        </div>
        <span class="status-dot ${entry.active_run ? "active" : summary.sandboxed ? "sandbox" : "idle"}"></span>
      </div>
      <div class="badge-row">
        <span class="badge ${entry.active_run ? "active" : ""}">${runState}</span>
        <span class="badge">${escapeHtml(summary.backend)}</span>
        ${summary.sandboxed ? `<span class="badge sandbox">sandbox</span>` : ""}
      </div>
      <div class="telemetry-grid">
        <div><span>msgs</span><strong>${summary.visible_message_count + pendingCount}</strong></div>
        <div><span>files</span><strong>${changes}</strong></div>
        <div><span>updated</span><strong>${relativeTime(summary.updated_at)}</strong></div>
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
    return;
  }

  const metadata = snapshot.metadata;
  el.inspectorTitle.textContent = shortId(metadata.session_id);
  el.inspectorMeta.textContent = metadata.cwd;
  el.snapModel.textContent = metadata.model;
  el.snapBackend.textContent = metadata.backend;
  el.snapMessages.textContent = effectiveMessageCount(metadata.session_id, snapshot);
  el.snapRun.textContent = snapshot.active_run ? "active" : "idle";
  el.cancelRun.disabled = !snapshot.active_run;
  renderTranscript(metadata.session_id, snapshot.messages);
  renderThreads(snapshot);
  renderWorksets(snapshot);
  renderWorkspace(snapshot);
  renderEvents();
  renderTabs();
}

function renderTranscript(sessionId, messages) {
  const transcriptMessages = [
    ...(messages || []),
    ...pendingMessages(sessionId),
  ];
  if (transcriptMessages.length === 0) {
    el.transcript.innerHTML = `<div class="empty-state">No messages yet.</div>`;
    return;
  }

  el.transcript.innerHTML = transcriptMessages.slice(-80).map((message, index) => {
    const role = message.role || "unknown";
    const body = messageText(message);
    const pending = message.pending ? "pending" : "";
    const marker = message.pending ? "pending" : `#${index + 1}`;
    return `
      <div class="message-row ${pending}">
        <div class="message-meta"><span class="message-role ${escapeAttr(role)}">${escapeHtml(role)}</span><span>${marker}</span></div>
        <div class="message-body ${body ? "" : "muted"}">${escapeHtml(body || "[empty]")}</div>
      </div>`;
  }).join("");
  if (state.scrollChatToBottom) {
    state.scrollChatToBottom = false;
    requestAnimationFrame(() => {
      el.transcript.scrollTop = el.transcript.scrollHeight;
    });
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
    const status = liveThread?.status === "active" ? "active" : thread ? "stored" : liveThread?.status || "pending";
    const episodes = snapshot.thread_episodes?.[name] || [];
    const latest = episodes.at(-1);
    const action = liveThread?.action || thread?.latest_action || "no action";
    const source = liveThread?.source_threads?.length
      ? `sources ${liveThread.source_threads.join(", ")}`
      : latest
        ? relativeTime(latest.created_at)
        : liveThread?.last_log || "waiting for worker output";
    return `
      <div class="dense-item thread-row ${status === "active" ? "thread-active" : ""}">
        <div class="dense-title">
          <span><span class="status-dot ${status === "active" ? "active" : "idle"}"></span>${escapeHtml(name)}</span>
          <span>${escapeHtml(status)}${thread ? ` / ${thread.episode_count} eps` : ""}</span>
        </div>
        <div class="dense-meta"><span>${escapeHtml(action)}</span><span>${escapeHtml(source)}</span></div>
        <div class="dense-body">${escapeHtml(truncate(latest?.content || "", 320))}</div>
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

  el.worksetsView.innerHTML = worksets.map((workset) => `
    <div class="dense-item">
      <div class="dense-title"><span>${escapeHtml(workset.id)}</span><span>${escapeHtml(workset.status)}</span></div>
      <div class="dense-meta"><span>${workset.items.length} items</span><span>${relativeTime(workset.updated_at)}</span></div>
      <div class="dense-body">${escapeHtml(workset.summary || workset.goal)}</div>
      ${workset.items.slice(0, 6).map((item, index) => `
        <div class="meter-row">
          <span>${index + 1}. ${escapeHtml(truncate(item.role, 9))}</span>
          <div class="meter"><span style="--w:${Math.max(12, Math.min(100, item.acceptance.length))}%"></span></div>
          <span>${escapeHtml(truncate(item.scope, 8))}</span>
        </div>`).join("")}
    </div>
  `).join("");
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
}

function filteredSessions() {
  return state.sessions;
}

function changedCount(sessionId) {
  return state.snapshots.get(sessionId)?.workspace?.changed_files?.length || 0;
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
      if (messageText(userMessages[index]) === pendingMessage.content) {
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
      last_log: truncate(event.line || "", 96),
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

function formatToolCalls(toolCalls) {
  if (!toolCalls || toolCalls.length === 0) return "";
  return toolCalls.map((call) => `${call.function?.name || "tool"} ${call.id}`).join("\n");
}

function messageText(message) {
  return message.content || message.reasoning_text || formatToolCalls(message.tool_calls) || "";
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

function relativeTime(value) {
  if (!value) return "--";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return String(value).slice(0, 10);
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function truncate(value, limit) {
  const text = String(value || "");
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
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

function makeLocalId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
