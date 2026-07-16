const state = {
  store: null,
  sessions: [],
  snapshots: new Map(),
  events: new Map(),
  lastSequence: new Map(),
  replayBoundaries: new Map(),
  currentId: null,
  targetedThread: null,
  eventSource: null,
  submitting: false,
  sessionReorder: null,
  snapshotTimer: null,
  pollTimer: null,
  statsLoadedAt: 0,
  statusTimer: null,
  commandIndex: 0,
  overviewGenerationId: null,
  focusView: null,
  settingsFocus: null,
  workspaceDiffs: new Map(),
  messageWindows: new Map(),
  orchestratorPrependAnchor: null,
  orchestratorViewport: null,
  threadEventWindows: new Map(),
  focusRenderId: 0,
  threadCycles: new Map(),
  attentionSessions: new Set(),
  sessionRunActivity: new Map(),
};

const ACTION_LEDGER_LIMIT = 5;
const ORCHESTRATOR_MESSAGE_PAGE_LIMIT = 24;
const THREAD_EVENT_PAGE_LIMIT = 24;
const REORDER_DRAG_THRESHOLD_PX = 6;
const ORCHESTRATOR_STEERING_TARGET = "__orchestrator__";
let focusMarkdownRenderer = null;

const commands = [
  { name: "transcript", description: "open the orchestrator transcript" },
  { name: "workspace", description: "inspect changed files and diffs" },
  { name: "settings", description: "edit this session's model configuration" },
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
    "sessionPicker", "sessionWorkspace", "sessionLayout", "pickerSessionTotal", "pickerNavStatus",
    "newSessionBtn", "sessionGrid", "reorderLive", "backToSessions", "sessionTitle",
    "sessionLocation", "renameSession", "metricModel", "metricContext", "metricTokens",
    "metricChanges", "sessionNavStatus", "stopRun", "refreshSession", "generatedOverview",
    "orchestratorState", "orchestratorLedger", "expandOrchestrator",
    "focusPanel", "focusTitle", "focusState", "focusContent", "closeFocusPanel",
    "threadGrid", "commandComposer", "composerTarget", "composerTargetName", "clearTarget",
    "promptInput", "sendPrompt", "commandMenu", "drawerBackdrop", "utilityDrawer",
    "drawerTitle", "drawerContent", "closeDrawer", "launchDialog", "launchForm",
    "launchExecutionModes", "launchCwd", "launchSshField", "launchSshHost", "launchBackend",
    "launchEffort", "launchModel", "launchBaseUrl", "launchApiKeyEnv", "launchExtraHeaders",
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
  el.stopRun.addEventListener("click", stopActiveRun);
  el.refreshSession.addEventListener("click", generateOverview);
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
  el.drawerContent.addEventListener("submit", handleDrawerSubmit);
  el.launchExecutionModes.addEventListener("change", syncLaunchExecutionMode);
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
  try {
    state.store = await apiGet("/store");
    el.launchCwd.value = state.store.root_cwd || "";
  } catch (error) {
    showToast(error.message, true);
  }
  await loadSessions({ workspaceStats: true });
  syncRouteFromHash();
  state.pollTimer = window.setInterval(() => {
    if (document.hidden) return;
    const workspaceStats = Date.now() - state.statsLoadedAt > 30_000;
    loadSessions({ workspaceStats });
  }, 5_000);
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

async function loadSessions({ workspaceStats = false } = {}) {
  if (state.sessionReorder) return state.sessions;
  try {
    const previous = new Map(state.sessions.map((entry) => [entry.summary.session_id, entry]));
    const loaded = await apiGet(`/sessions${workspaceStats ? "?workspace_stats=true" : ""}`);
    if (workspaceStats) state.statsLoadedAt = Date.now();
    const sessions = loaded.map((entry) => {
      const old = previous.get(entry.summary.session_id);
      if (entry.workspace_diff == null && old?.workspace_diff != null) return { ...entry, workspace_diff: old.workspace_diff };
      return entry;
    });
    syncSessionRunIndicators(sessions);
    state.sessions = sessions;
    if (state.currentId && !sessionEntry(state.currentId)) showPicker();
    renderPicker();
    if (state.currentId) renderWorkspace();
    return state.sessions;
  } catch (error) {
    showToast(error.message, true);
    return [];
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

function noteSessionRunEvent(sessionId, type) {
  if (!sessionId) return;
  if (type === "run_started") {
    state.sessionRunActivity.set(sessionId, true);
    state.attentionSessions.delete(sessionId);
    return;
  }
  if (!["run_completed", "run_failed"].includes(type)) return;
  const wasActive = state.sessionRunActivity.get(sessionId) === true || Boolean(sessionEntry(sessionId)?.active_run);
  state.sessionRunActivity.set(sessionId, false);
  if (wasActive) state.attentionSessions.add(sessionId);
}

function clearSessionAttention(sessionId) {
  state.attentionSessions.delete(sessionId);
}

function renderPicker() {
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
}

function renderSessionGroup(title, entries) {
  return `<section class="session-group"><h2 class="group-heading">${escapeHtml(title)} <span>${entries.length}</span></h2><div class="session-grid">${entries.map(renderSessionCard).join("")}</div></section>`;
}

function renderSessionCard(entry, index = 0, entries = []) {
  const summary = entry.summary;
  const sessionId = summary.session_id;
  const status = sessionStatus(entry);
  const snapshot = state.snapshots.get(sessionId);
  const branch = snapshot?.workspace?.branch;
  const location = [branch, basename(summary.cwd)].filter(Boolean).join(" · ") || summary.cwd;
  const prompt = summary.last_user_prompt || "No prompt submitted";
  const diff = entry.workspace_diff;
  const changes = diff && !diff.error ? `+${diff.total_additions || 0} −${diff.total_deletions || 0}` : "no diff";
  return `
    <article class="session-card" data-session-id="${escapeAttr(sessionId)}" data-pinned="${summary.pinned}">
      <button class="session-select" type="button" data-action="open-session" data-session-id="${escapeAttr(sessionId)}">
        <span class="card-title-row"><i class="status-dot ${status}"></i><span class="card-title">${escapeHtml(displaySessionTitle(summary))}</span></span>
        <span class="card-location">${escapeHtml(location)}</span>
        <span class="card-prompt">${escapeHtml(prompt)}</span>
        <span class="card-metrics"><span>${escapeHtml(shortModel(summary.model))}</span><span>${summary.visible_message_count || 0} messages</span><span class="changes">${escapeHtml(changes)}</span></span>
      </button>
      <div class="card-controls">
        <button class="card-control" type="button" data-action="toggle-pin" data-session-id="${escapeAttr(sessionId)}" aria-label="${summary.pinned ? "Unpin" : "Pin"} ${escapeAttr(displaySessionTitle(summary))}" aria-pressed="${summary.pinned}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l-1 7 3 3v2H7v-2l3-3-1-7Z"></path><path d="M12 15v6"></path></svg>
        </button>
        <button class="card-control move-handle" type="button" data-action="move-session" data-session-id="${escapeAttr(sessionId)}" aria-label="Reorder ${escapeAttr(displaySessionTitle(summary))}; position ${index + 1} of ${entries.length || 1}" aria-describedby="reorderInstructions">
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
  return `${title}, position ${position + 1} of ${count} in ${pinned ? "pinned sessions" : "sessions"}.${suffix ? ` ${suffix}` : ""}`;
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
  announceReorder(`Reorder cancelled for ${displaySessionTitle(sessionEntry(reorder.sessionId)?.summary || { session_id: reorder.sessionId })}.`);
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
    const title = displaySessionTitle(sessionEntry(card.dataset.sessionId)?.summary || { session_id: card.dataset.sessionId });
    card.querySelector(".move-handle")?.setAttribute("aria-label", `Reorder ${title}; position ${index + 1} of ${cards.length}`);
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
    await loadSessions({ workspaceStats: false });
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

function openSession(sessionId, updateHash = true) {
  if (!sessionEntry(sessionId)) return;
  clearSessionAttention(sessionId);
  state.currentId = sessionId;
  state.targetedThread = null;
  state.focusView = null;
  state.settingsFocus = null;
  el.sessionPicker.hidden = true;
  el.sessionWorkspace.hidden = false;
  if (updateHash) history.pushState(null, "", `#session/${encodeURIComponent(sessionId)}`);
  renderWorkspace();
  loadSnapshot(sessionId, true);
  connectEventStream(sessionId);
}

function showPicker(updateHash = true) {
  state.currentId = null;
  state.targetedThread = null;
  state.focusView = null;
  state.settingsFocus = null;
  if (state.eventSource) state.eventSource.close();
  state.eventSource = null;
  closeDrawer();
  el.sessionWorkspace.hidden = true;
  el.sessionPicker.hidden = false;
  if (updateHash) history.pushState(null, "", window.location.pathname);
  renderPicker();
}

async function loadSnapshot(sessionId, announce = false) {
  if (!sessionId) return null;
  try {
    const snapshot = await apiGet(`/sessions/${encodeURIComponent(sessionId)}?message_limit=${ORCHESTRATOR_MESSAGE_PAGE_LIMIT}&thread_event_limit=${THREAD_EVENT_PAGE_LIMIT}`);
    mergeSnapshotMessageWindow(sessionId, snapshot);
    state.snapshots.set(sessionId, snapshot);
    if (state.currentId === sessionId) renderWorkspace();
    if (announce) showToast("Session refreshed");
    return snapshot;
  } catch (error) {
    showToast(error.message, true);
    return null;
  }
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
    ? { events: [], hasOlder: true, nextBeforeId: null, loading: true, afterSequence: state.replayBoundaries.get(sessionId) ?? state.lastSequence.get(sessionId) ?? 0 }
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
      afterSequence: windowState.afterSequence,
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

function connectEventStream(sessionId) {
  if (state.eventSource) state.eventSource.close();
  const after = state.lastSequence.get(sessionId);
  const query = after ? `?after_sequence_id=${encodeURIComponent(after)}&limit=512` : "?limit=512";
  const source = new EventSource(`/sessions/${encodeURIComponent(sessionId)}/events/stream${query}`);
  state.eventSource = source;
  source.addEventListener("replay_boundary", (event) => {
    if (state.eventSource !== source) return;
    let boundary;
    try { boundary = Number(JSON.parse(event.data)?.replay_boundary_sequence_id || 0); }
    catch (_) { return; }
    state.replayBoundaries.set(sessionId, boundary);
    const prefix = `${sessionId}:`;
    for (const [key, windowState] of state.threadEventWindows) {
      if (!key.startsWith(prefix)) continue;
      windowState.afterSequence = Math.max(Number(windowState.afterSequence || 0), boundary);
    }
  });
  source.addEventListener("session_event", (event) => {
    if (state.eventSource !== source) return;
    let envelope;
    try { envelope = JSON.parse(event.data); } catch (_) { return; }
    const sequence = Number(envelope.sequence_id || 0);
    if (sequence && sequence <= (state.lastSequence.get(sessionId) || 0)) return;
    if (sequence) state.lastSequence.set(sessionId, sequence);
    const list = state.events.get(sessionId) || [];
    list.push(envelope);
    if (list.length > 768) list.splice(0, list.length - 768);
    state.events.set(sessionId, list);
    noteSessionRunEvent(sessionId, envelope.event?.type);
    if (state.currentId === sessionId) renderWorkspace();
    if (eventNeedsSnapshot(envelope)) scheduleSnapshot(sessionId);
    if (["run_started", "run_completed", "run_failed"].includes(envelope.event?.type)) {
      renderPicker();
      loadSessions({ workspaceStats: false });
    }
  });
  source.addEventListener("replay_gap", () => loadSnapshot(sessionId, false));
  source.onerror = () => {
    if (state.eventSource === source && state.currentId === sessionId) {
      // EventSource reconnects automatically; the live state is represented by the tiles, not extra chrome.
    }
  };
}

function eventNeedsSnapshot(envelope) {
  const type = envelope.event?.type;
  if (["run_started", "run_completed", "run_failed", "snapshot_saved"].includes(type)) return true;
  const agent = agentEvent(envelope);
  return ["thread_started", "thread_finished", "thread_steering_queued", "thread_steering_delivered", "thread_steering_expired"].includes(agent?.type);
}

function scheduleSnapshot(sessionId) {
  window.clearTimeout(state.snapshotTimer);
  state.snapshotTimer = window.setTimeout(() => loadSnapshot(sessionId, false), 120);
}

function agentEvent(envelope) { return envelope?.event?.type === "agent" ? envelope.event.event : null; }

function renderWorkspace() {
  const entry = sessionEntry();
  const snapshot = currentSnapshot();
  if (!entry) return;
  const summary = entry.summary;
  const workspace = snapshot?.workspace;
  el.sessionTitle.textContent = displaySessionTitle(summary);
  el.sessionLocation.textContent = [workspace?.branch, summary.cwd].filter(Boolean).join(" · ");
  el.metricModel.textContent = shortModel(snapshot?.metadata?.model || summary.model);
  const usage = displayedTokenUsage(snapshot);
  const contextTokens = orchestratorContextTokens(usage);
  el.metricContext.textContent = formatNumber(contextTokens);
  el.metricContext.title = contextTokens ? `${contextTokens.toLocaleString()} tokens` : "";
  el.metricTokens.textContent = tokenUsageSummary(usage);
  el.metricTokens.title = tokenUsageTitle(usage);
  const diff = workspace && !workspace.error ? workspace : entry.workspace_diff;
  el.metricChanges.textContent = diff && !diff.error ? `+${diff.total_additions || 0} −${diff.total_deletions || 0}` : "—";
  const active = Boolean(snapshot?.active_run || entry.active_run);
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
  const snapshotRunId = snapshot?.active_run?.run_id;
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
  renderOrchestratorLedger(snapshot);
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

function renderOrchestratorLedger(snapshot) {
  const active = Boolean(snapshot?.active_run);
  el.orchestratorState.textContent = active ? "Active" : "Idle";
  el.orchestratorState.classList.toggle("is-active", active);
  el.orchestratorLedger.innerHTML = renderActionRows(
    buildOrchestratorActions(snapshot),
    "No orchestrator activity recorded",
  );
}

function buildOrchestratorActions(snapshot) {
  const actions = [];
  const calls = new Map();
  const observedSteering = new Set();
  const events = state.events.get(state.currentId) || [];
  for (const envelope of events) {
    const sessionEvent = envelope?.event;
    if (sessionEvent?.type === "run_started") {
      actions.push({ name: "run", result: "started", state: "live", detail: compactActionDetail(sessionEvent.prompt_preview) });
    }
    if (sessionEvent?.type === "run_completed") {
      actions.push({ name: "run", result: "complete", state: "done", detail: compactActionDetail(sessionEvent.response) });
    }
    if (sessionEvent?.type === "run_failed") {
      actions.push({ name: "run", result: "failed", state: "error", detail: compactActionDetail(sessionEvent.message) });
    }

    const event = agentEvent(envelope);
    if (!event || eventThreadName(event)) continue;
    if (event.type === "model_call_started") actions.push({ name: "model", result: `turn ${event.iteration}`, state: "live" });
    if (event.type === "tool_call_started") {
      const action = {
        name: event.name || "tool",
        result: "running",
        state: "live",
        callId: event.call_id,
        detail: formatToolArguments(event.args_detail, event.args_preview),
      };
      actions.push(action);
      calls.set(event.call_id, action);
    }
    if (event.type === "tool_call_finished") {
      const existing = calls.get(event.call_id);
      if (existing) {
        existing.result = event.is_error ? "failed" : "done";
        existing.state = event.is_error ? "error" : "done";
      } else {
        actions.push({
          name: event.name || "tool",
          result: event.is_error ? "failed" : "done",
          state: event.is_error ? "error" : "done",
          detail: compactActionDetail(event.content_preview),
        });
      }
    }
    if (event.type === "assistant_message") actions.push({ name: "response", result: "ready", state: "done", detail: compactActionDetail(event.content) });
    if (event.type === "error") actions.push({ name: "error", result: "failed", state: "error", detail: compactActionDetail(event.message) });
    if (event.type === "orchestrator_steering_queued") {
      observedSteering.add(event.steering_id);
      actions.push({ name: "steering", result: "queued", state: "live", detail: compactActionDetail(event.instruction_preview) });
    }
    if (event.type === "orchestrator_steering_delivered") {
      observedSteering.add(event.steering_id);
      actions.push({ name: "steering", result: "delivered", state: "done", detail: compactActionDetail(event.instruction_preview) });
    }
    if (event.type === "orchestrator_steering_expired") {
      observedSteering.add(event.steering_id);
      actions.push({ name: "steering", result: "expired", state: "error", detail: compactActionDetail(event.instruction_preview) });
    }
  }
  if (!events.length) {
    for (const record of snapshot?.thread_steering || []) {
      if (record.thread_name !== ORCHESTRATOR_STEERING_TARGET || observedSteering.has(record.id)) continue;
      actions.push({
        name: "steering",
        result: record.status,
        state: record.status === "queued" ? "live" : record.status === "expired" ? "error" : "done",
        detail: compactActionDetail(record.instruction),
      });
    }
  }
  if (actions.length) return actions.slice(-ACTION_LEDGER_LIMIT);
  return buildPersistedOrchestratorActions(snapshot?.messages || []);
}

function buildPersistedOrchestratorActions(messages) {
  const actions = [];
  const calls = new Map();
  for (const message of messages) {
    if (message.role === "assistant" && message.tool_calls?.length) {
      for (const call of message.tool_calls) {
        const action = {
          name: call.function?.name || "tool",
          result: "called",
          state: "done",
          detail: formatToolArguments(call.function?.arguments, ""),
        };
        actions.push(action);
        if (call.id) calls.set(call.id, action);
      }
    } else if (message.role === "tool") {
      const existing = calls.get(message.tool_call_id);
      if (existing) existing.result = "done";
    } else if (message.role === "assistant" && message.content) {
      actions.push({ name: "response", result: "sent", state: "done", detail: compactActionDetail(message.content) });
    }
  }
  return actions.slice(-ACTION_LEDGER_LIMIT);
}

function openFocusView(type, name = null) {
  const workspace = currentSnapshot()?.workspace;
  const path = type === "workspace" ? workspace?.changed_files?.[0]?.path || null : null;
  state.focusView = { type, name, path };
  if (type === "orchestrator") {
    state.orchestratorViewport = { sessionId: state.currentId, pinnedToBottom: true, scrollTop: 0 };
  }
  if (type === "settings") state.settingsFocus = { sessionId: state.currentId, status: "loading", config: null, error: null };
  if (type === "thread") {
    const thread = buildThreadModels().find((item) => item.name === name);
    state.targetedThread = thread && ["running", "queued"].includes(thread.state) ? name : null;
  } else state.targetedThread = null;
  renderThreads(currentSnapshot());
  renderFocusView(currentSnapshot());
  if (type === "settings") loadFocusSettings();
  if (type === "thread") loadThreadEventPage(name, { reset: true });
}

function closeFocusView() {
  const returnTarget = state.focusView?.type === "thread"
    ? el.threadGrid.querySelector(`[data-focus-thread="${cssEscape(state.focusView.name)}"]`)
    : state.focusView?.type === "orchestrator" ? el.expandOrchestrator : el.promptInput;
  state.focusView = null;
  state.orchestratorViewport = null;
  renderFocusView(currentSnapshot());
  returnTarget?.focus();
}

function renderFocusView(snapshot) {
  const view = state.focusView;
  const renderId = ++state.focusRenderId;
  el.sessionLayout.classList.toggle("is-focused", Boolean(view));
  el.focusPanel.classList.toggle("is-thread", view?.type === "thread");
  el.focusPanel.classList.toggle("is-orchestrator", view?.type === "orchestrator");
  el.focusPanel.classList.toggle("is-workspace", view?.type === "workspace");
  el.focusPanel.classList.toggle("is-settings", view?.type === "settings");
  el.focusPanel.hidden = !view;
  if (!view) {
    el.focusContent.innerHTML = "";
    return;
  }
  const priorThreadActivity = view.type === "thread" ? el.focusContent.querySelector(".focus-activity") : null;
  const previousThreadScroll = priorThreadActivity?.scrollTop || 0;
  const prependAnchor = view.type === "orchestrator" && state.orchestratorPrependAnchor?.sessionId === state.currentId
    ? state.orchestratorPrependAnchor
    : null;
  if (prependAnchor) state.orchestratorPrependAnchor = null;
  const priorEpisodeDetails = view.type === "thread" ? [...el.focusContent.querySelectorAll(".focus-episode")] : [];
  const openEpisodeIndices = new Set(priorEpisodeDetails.filter((episode) => episode.open).map((episode) => episode.dataset.episodeIndex));
  if (view.type === "orchestrator") {
    const active = Boolean(snapshot?.active_run);
    el.focusTitle.textContent = "Orchestrator";
    el.focusState.textContent = active ? "Active" : "Idle";
    el.focusState.classList.toggle("is-active", active);
    el.focusContent.innerHTML = renderOrchestratorConversation(snapshot);
  } else if (view.type === "thread") {
    const model = buildThreadModels(snapshot).find((thread) => thread.name === view.name);
    el.focusTitle.textContent = view.name || "Thread";
    el.focusState.textContent = model?.state || "finished";
    el.focusState.classList.toggle("is-active", model?.state === "running");
    el.focusContent.innerHTML = renderThreadFocus(view.name, model, snapshot);
    if (priorEpisodeDetails.length) {
      for (const episode of el.focusContent.querySelectorAll(".focus-episode")) {
        episode.open = openEpisodeIndices.has(episode.dataset.episodeIndex);
      }
    }
  } else if (view.type === "workspace") {
    const workspace = snapshot?.workspace;
    el.focusTitle.textContent = "Workspace";
    el.focusState.textContent = workspace?.branch || "Working tree";
    el.focusState.classList.remove("is-active");
    el.focusContent.innerHTML = renderWorkspaceFocus(workspace, view.path);
    if (view.path) loadFocusWorkspaceDiff(view.path);
  } else {
    el.focusTitle.textContent = "settings";
    el.focusState.textContent = "model configuration";
    el.focusState.classList.remove("is-active");
    el.focusContent.innerHTML = renderFocusSettings();
  }
  if (view.type === "orchestrator") {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (renderId !== state.focusRenderId || state.focusView?.type !== "orchestrator") return;
        const scroller = el.focusContent.querySelector(".focus-chat");
        if (!scroller) return;
        if (prependAnchor) {
          scroller.scrollTop = Math.max(0, scroller.scrollHeight - prependAnchor.scrollHeight + prependAnchor.scrollTop);
        } else {
          const viewport = state.orchestratorViewport?.sessionId === state.currentId
            ? state.orchestratorViewport
            : { pinnedToBottom: true, scrollTop: 0 };
          scroller.scrollTop = viewport.pinnedToBottom ? scroller.scrollHeight : viewport.scrollTop;
        }
      });
    });
  } else if (view.type === "thread") {
    requestAnimationFrame(() => {
      if (renderId !== state.focusRenderId || state.focusView?.type !== "thread") return;
      const scroller = el.focusContent.querySelector(".focus-activity");
      if (scroller) scroller.scrollTop = priorThreadActivity ? previousThreadScroll : 0;
    });
  }
}

async function loadFocusSettings() {
  const sessionId = state.currentId;
  if (!sessionId || state.focusView?.type !== "settings") return;
  try {
    const config = await apiGet(`/sessions/${encodeURIComponent(sessionId)}/config`);
    if (state.currentId !== sessionId) return;
    state.settingsFocus = { sessionId, status: "ready", config, error: null };
  } catch (error) {
    if (state.currentId !== sessionId) return;
    state.settingsFocus = { sessionId, status: "error", config: null, error: error.message };
  }
  if (state.focusView?.type === "settings") renderFocusView(currentSnapshot());
}

function renderFocusSettings() {
  const settings = state.settingsFocus;
  if (!settings || settings.sessionId !== state.currentId || settings.status === "loading") {
    return `<div class="focus-settings-layout"><div class="focus-empty">loading configuration…</div></div>`;
  }
  if (settings.status === "error") {
    return `<div class="focus-settings-layout"><div class="focus-empty">${escapeHtml(settings.error)}</div></div>`;
  }
  const config = settings.config;
  return `<div class="focus-settings-layout"><form id="settingsForm" class="settings-form focus-settings-form">
    <label class="field"><span>backend</span><select name="backend">${backendOptions(config.backend)}</select></label>
    <label class="field"><span>reasoning</span><select name="reasoning_effort">${effortOptions(config.reasoning_effort)}</select></label>
    <label class="field"><span>model</span><input name="model" value="${escapeAttr(config.model || "")}"></label>
    <label class="field"><span>base url</span><input name="base_url" value="${escapeAttr(config.base_url || "")}"></label>
    <label class="field"><span>api key environment variable</span><input name="api_key_env" value="${escapeAttr(config.api_key_env || "")}"></label>
    <label class="field"><span>extra headers</span><input name="extra_headers" value="${escapeAttr(JSON.stringify(config.extra_headers || {}))}"></label>
    <div class="settings-actions"><span id="settingsStatus" class="form-status"></span><button class="button button-primary" type="submit">save settings</button></div>
  </form></div>`;
}

function renderOrchestratorConversation(snapshot) {
  const messages = (snapshot?.messages || []).filter((message) => message.role !== "system");
  const transcript = messages.map(renderFocusMessage).join("");
  const messageWindow = state.messageWindows.get(state.currentId);
  const historyLoader = messageWindow?.hasOlder
    ? `<div class="focus-history-loader ${messageWindow.loading ? "is-loading" : ""}" data-history-loader role="status"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"></path></svg><span>${messageWindow.loading ? "loading earlier messages" : "scroll up for earlier messages"}</span></div>`
    : "";
  const liveActions = snapshot?.active_run ? buildOrchestratorActions(snapshot) : [];
  const live = `<section class="focus-live"><div class="focus-column-heading"><span>Live activity</span><strong>${snapshot?.active_run ? "active" : "idle"}</strong></div>${renderFocusActions(liveActions)}</section>`;
  return `<div class="focus-orchestrator-layout"><div class="focus-orchestrator-sidebar"><aside class="focus-worksets">${renderFocusWorksets(snapshot)}</aside>${live}</div><section class="focus-chat"><div class="focus-conversation">${historyLoader}${transcript || `<div class="focus-empty">The conversation starts here.</div>`}</div></section></div>`;
}

function renderFocusWorksets(snapshot) {
  const worksets = snapshot?.worksets?.items || [];
  const content = worksets.length ? worksets.map((workset) => {
    const items = workset.items || [];
    const done = items.filter((item) => isDoneStatus(item.status)).length;
    const percent = items.length ? Math.round(done / items.length * 100) : 0;
    return `<article class="focus-workset"><header><strong>${escapeHtml(workset.id)}</strong><span>${done}/${items.length}</span></header><p>${escapeHtml(workset.goal || workset.summary || "")}</p><div class="progress-track"><i style="width:${percent}%"></i></div><ol>${items.map((item) => `<li class="${isDoneStatus(item.status) ? "is-done" : ""}"><span>${isDoneStatus(item.status) ? "●" : "○"}</span><div><strong>${escapeHtml(item.title)}</strong><em>${escapeHtml(item.status || "pending")}</em></div></li>`).join("")}</ol></article>`;
  }).join("") : `<div class="focus-empty">No worksets defined.</div>`;
  return `<div class="focus-column-heading"><span>Worksets</span><strong>${worksets.length}</strong></div>${content}`;
}

function isDoneStatus(status) {
  return ["complete", "completed", "done", "verified"].includes(String(status || "").toLowerCase());
}

function renderWorkspaceFocus(workspace, selectedPath) {
  if (!workspace || workspace.error) return `<div class="focus-empty">${escapeHtml(workspace?.error || "Workspace data is unavailable.")}</div>`;
  const files = workspace.changed_files || [];
  const key = selectedPath ? `${state.currentId}:${selectedPath}` : null;
  const cached = key ? state.workspaceDiffs.get(key) : null;
  const detail = selectedPath
    ? renderWorkspaceFocusDiff(selectedPath, cached)
    : `<div class="focus-empty">${files.length ? "Select a changed file." : "Working tree clean."}</div>`;
  return `<div class="focus-workspace-layout"><aside class="focus-files"><div class="focus-column-heading"><span>${escapeHtml(workspace.branch || "detached")}</span><strong>${files.length}</strong></div><div class="focus-workspace-totals"><span>+${workspace.total_additions || 0}</span><span>−${workspace.total_deletions || 0}</span></div><div class="focus-file-list">${files.map((file) => `<button class="focus-file ${file.path === selectedPath ? "is-selected" : ""}" type="button" data-focus-workspace-file="${escapeAttr(file.path)}"><span>${escapeHtml(file.status || "M")}</span><strong>${escapeHtml(file.path)}</strong><em>+${file.additions ?? "—"} −${file.deletions ?? "—"}</em></button>`).join("")}</div></aside><section class="focus-diff"><div class="focus-column-heading"><span>${selectedPath ? escapeHtml(selectedPath) : "Diff"}</span></div>${detail}</section></div>`;
}

function renderWorkspaceFocusDiff(path, cached) {
  if (!cached || cached.status === "loading") return `<div class="focus-empty">Loading ${escapeHtml(path)}…</div>`;
  if (cached.status === "error") return `<div class="focus-empty">${escapeHtml(cached.message)}</div>`;
  const lines = [];
  for (const section of cached.diff.sections || []) for (const hunk of section.hunks || []) for (const line of hunk.lines || []) lines.push(line);
  return lines.length ? `<div class="diff-view focus-diff-view">${lines.map(renderDiffLine).join("")}</div>` : `<div class="focus-empty">No inline diff for this file.</div>`;
}

function renderDiffLine(line) {
  const kind = ["addition", "insert"].includes(line.kind) ? "add" : ["deletion", "delete"].includes(line.kind) ? "remove" : "";
  return `<div class="diff-line ${kind}"><span>${line.old_lineno ?? ""}</span><span>${line.new_lineno ?? ""}</span><code>${escapeHtml(line.content || "")}</code></div>`;
}

function handleFocusClick(event) {
  const file = event.target.closest("[data-focus-workspace-file]");
  if (!file || state.focusView?.type !== "workspace") return;
  state.focusView.path = file.dataset.focusWorkspaceFile;
  renderFocusView(currentSnapshot());
}

async function loadFocusWorkspaceDiff(path) {
  if (!state.currentId || state.focusView?.type !== "workspace" || state.focusView.path !== path) return;
  const key = `${state.currentId}:${path}`;
  if (state.workspaceDiffs.has(key)) return;
  state.workspaceDiffs.set(key, { status: "loading" });
  try {
    const diff = await apiGet(`/sessions/${encodeURIComponent(state.currentId)}/workspace/diff?path=${encodeURIComponent(path)}&stage=all&context=3`);
    state.workspaceDiffs.set(key, { status: "ready", diff });
  } catch (error) {
    state.workspaceDiffs.set(key, { status: "error", message: error.message });
  }
  if (state.focusView?.type === "workspace" && state.focusView.path === path) renderFocusView(currentSnapshot());
}

function renderFocusMessage(message) {
  const role = message.role || "message";
  const label = role === "user" ? "You" : role === "assistant" ? "Orchestrator" : "Tool result";
  const copy = message.content
    ? `<div class="focus-message-copy">${renderFocusMarkdown(message.content)}</div>`
    : "";
  const calls = (message.tool_calls || []).map((call) => {
    const name = call.function?.name || "tool";
    return `<div class="focus-tool-call"><div><span>Tool call</span><strong>${escapeHtml(name)}</strong></div><pre>${escapeHtml(formatFocusArguments(call.function?.arguments))}</pre></div>`;
  }).join("");
  if (!copy && !calls && role !== "tool") return "";
  const body = copy || calls
    ? `${copy}${calls}`
    : `<div class="focus-message-copy">${renderFocusMarkdown(messageText(message) || "[empty]")}</div>`;
  return `<article class="focus-message" data-role="${escapeAttr(role)}"><span class="focus-message-role">${label}</span><div class="focus-message-body">${body}</div></article>`;
}

function renderThreadFocus(name, model, snapshot) {
  const key = threadEventWindowKey(state.currentId, name);
  const windowState = state.threadEventWindows.get(key);
  const actions = threadFocusActions(name, snapshot, windowState);
  if (!actions.some((action) => action.name === "dispatch") && model?.record?.latest_action) {
    actions.push({ name: "dispatch", result: model.state === "running" ? "active" : "recorded", state: model.state === "running" ? "live" : "done", detail: model.record.latest_action });
  }
  const historyLoader = windowState?.hasOlder
    ? `<div class="focus-event-loader ${windowState.loading ? "is-loading" : ""}" data-event-loader role="status"><span>${windowState.loading ? "loading earlier events" : "scroll down for earlier events"}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m-6-6 6 6 6-6"></path></svg></div>`
    : "";
  const episodes = snapshot?.thread_episodes?.[name] || [];
  const episodeHtml = renderThreadEpisodes(episodes);
  return `<div class="focus-thread-layout"><section class="focus-activity"><h3>Activity · latest first</h3>${renderFocusActions(actions)}${historyLoader}</section><section class="focus-episodes"><h3>Episodes</h3>${episodeHtml}</section></div>`;
}

function threadFocusActions(name, snapshot, windowState) {
  const persisted = windowState
    ? windowState.events.map((item) => item.event)
    : [...(snapshot?.thread_events?.[name] || [])].reverse();
  const live = (state.events.get(state.currentId) || [])
    .filter((envelope) => Number(envelope.sequence_id || 0) > Number(windowState?.afterSequence || Number.MAX_SAFE_INTEGER))
    .map((envelope) => agentEvent(envelope))
    .filter((event) => eventThreadName(event) === name)
    .reverse();
  const seen = new Set();
  return [...live, ...persisted]
    .filter((event) => {
      const signature = JSON.stringify(event);
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .map((event) => threadEventAction(event, snapshot?.thread_episodes?.[name]?.at(-1)))
    .filter(Boolean);
}

function threadEventAction(event, latestEpisode) {
  if (!event || event.type === "model_call_started" || event.type === "run_started" || event.type === "run_finished") return null;
  if (event.type === "thread_started") return { name: "dispatch", result: "started", state: "live", detail: compactActionDetail(event.action) };
  if (event.type === "tool_call_started") return { name: event.name || "tool", result: "running", state: "live", detail: formatToolArguments(event.args_detail, event.args_preview) };
  if (event.type === "tool_call_finished") return { name: event.name || "tool", result: event.is_error ? "failed" : "done", state: event.is_error ? "error" : "done", detail: compactActionDetail(event.content_preview) };
  if (event.type === "assistant_message") return { name: "response", result: "returned", state: "done", detail: compactActionDetail(event.content) };
  if (event.type === "error") return { name: "error", result: "failed", state: "error", detail: compactActionDetail(event.message) };
  if (event.type === "thread_steering_queued") return { name: "steering", result: "queued", state: "live", detail: compactActionDetail(event.instruction_preview) };
  if (event.type === "thread_steering_delivered") return { name: "steering", result: "delivered", state: "done", detail: compactActionDetail(event.instruction_preview) };
  if (event.type === "thread_steering_expired") return { name: "steering", result: "expired", state: "error", detail: compactActionDetail(event.instruction_preview) };
  if (event.type === "thread_finished") {
    const succeeded = event.exit_code === 0 && !event.timed_out;
    return {
      name: "thread",
      result: event.timed_out ? "timed out" : succeeded ? "returned" : `exit ${event.exit_code}`,
      state: succeeded ? "done" : "error",
      detail: compactActionDetail(event.timeout_reason || latestEpisode?.content || ""),
    };
  }
  return null;
}

function renderThreadEpisodes(episodes) {
  if (!episodes.length) return `<div class="focus-empty">No retained episodes yet.</div>`;
  return episodes.map((episode, index) => {
    const prompt = episode.action || "No prompt retained.";
    const response = episode.content || "No retained response.";
    const isLatest = index === episodes.length - 1;
    return `<details class="focus-episode" data-episode-index="${index}"${isLatest ? " open" : ""}>
      <summary><span>Episode ${index + 1}</span><strong>${escapeHtml(prompt)}</strong><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"></path></svg></summary>
      <div class="focus-episode-body">
        <section class="focus-episode-prompt"><span>Prompt</span><p>${escapeHtml(prompt)}</p></section>
        <section class="focus-episode-response"><span>Response</span><div class="focus-episode-copy">${renderFocusMarkdown(response)}</div></section>
      </div>
    </details>`;
  }).join("");
}

function renderFocusActions(actions) {
  if (!actions.length) return `<div class="focus-empty">Awaiting activity.</div>`;
  return `<ol class="focus-action-list">${actions.map((action) => {
    const marker = action.state === "live" ? "›" : action.state === "error" ? "×" : action.state === "done" ? "✓" : "·";
    return `<li class="focus-action ${action.state === "live" ? "is-live" : action.state === "error" ? "is-error" : ""}"><span class="action-mark">${marker}</span><strong>${escapeHtml(action.name)}</strong><em>${escapeHtml(action.result)}</em>${action.detail ? `<p>${escapeHtml(action.detail)}</p>` : ""}</li>`;
  }).join("")}</ol>`;
}

function formatFocusArguments(value) {
  const raw = String(value || "").trim();
  if (!raw) return "No arguments";
  try { return JSON.stringify(JSON.parse(raw), null, 2); }
  catch (_) { return raw; }
}

function renderFocusMarkdown(value) {
  if (typeof window.markdownit !== "function" || !window.DOMPurify) return escapeHtml(value);
  focusMarkdownRenderer ||= window.markdownit({ html: false, linkify: true, typographer: false });
  return window.DOMPurify.sanitize(focusMarkdownRenderer.render(String(value || "")), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["img", "style", "script", "iframe", "object", "embed", "form", "input", "button"],
    FORBID_ATTR: ["style", "id", "name"],
  });
}

function buildThreadModels(snapshot = currentSnapshot()) {
  const names = new Set([
    ...(snapshot?.threads || []).map((thread) => thread.name),
    ...Object.keys(snapshot?.thread_episodes || {}),
    ...Object.keys(snapshot?.thread_events || {}),
    ...(snapshot?.active_threads || []),
    ...(snapshot?.thread_steering || [])
      .filter((record) => record.thread_name !== ORCHESTRATOR_STEERING_TARGET)
      .map((record) => record.thread_name),
  ]);
  const liveEvents = state.events.get(state.currentId) || [];
  for (const envelope of liveEvents) {
    const event = agentEvent(envelope);
    const name = eventThreadName(event);
    if (name) names.add(name);
  }
  const active = new Set(snapshot?.active_threads || []);
  const models = [...names].map((name) => {
    const currentEvents = liveEvents.filter((envelope) => eventThreadName(agentEvent(envelope)) === name);
    const persistedEvents = (snapshot?.thread_events?.[name] || []).map((event, index) => ({
      sequence_id: index + 1,
      event: { type: "agent", event },
    }));
    const threadEvents = currentEvents.length ? currentEvents : persistedEvents;
    const lastStarted = lastSequenceOfType(threadEvents, "thread_started");
    const lastFinished = lastSequenceOfType(threadEvents, "thread_finished");
    let threadState = "finished";
    if (lastFinished > 0 && lastFinished >= lastStarted) threadState = "finished";
    else if (active.has(name)) threadState = lastStarted > lastFinished ? "running" : "queued";
    const record = (snapshot?.threads || []).find((thread) => thread.name === name);
    const actions = buildThreadActions(name, threadEvents, snapshot);
    return {
      name,
      state: threadState,
      record,
      actions: actions.length ? actions : buildRetainedThreadActions(name, record, snapshot),
    };
  });
  const currentCycle = currentCycleThreadNames(snapshot);
  return models.map((thread) => ({
    ...thread,
    compact: thread.state === "finished" && !currentCycle.has(thread.name),
  })).sort((a, b) => {
    if (a.compact !== b.compact) return a.compact ? 1 : -1;
    const rank = { running: 0, queued: 1, finished: 2 };
    if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
    return String(b.record?.updated_at || "").localeCompare(String(a.record?.updated_at || "")) || a.name.localeCompare(b.name);
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
  let latestUserIndex = -1;
  let userCount = 0;
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role !== "user") continue;
    latestUserIndex = index;
    userCount += 1;
  }

  const submitted = snapshot?.active_run?.submitted_user_message;
  let marker = "none";
  let dispatchStart = messages.length;
  const names = new Set(snapshot?.active_threads || []);
  if (submitted?.content) {
    const baseline = Number(submitted.baseline_user_message_count);
    const ordinal = Number.isFinite(baseline) ? baseline + 1 : Math.max(userCount, 1);
    marker = `${ordinal}:${submitted.content}`;
    const submittedIndex = messages.findLastIndex((message) => message?.role === "user" && message.content === submitted.content);
    dispatchStart = submittedIndex >= 0 ? submittedIndex + 1 : messages.length;
  } else if (serverCycle?.marker) {
    for (const name of serverCycle.thread_names || []) names.add(name);
    return { marker: serverCycle.marker, names };
  } else if (latestUserIndex >= 0) {
    marker = `${userCount}:${messages[latestUserIndex].content || ""}`;
    dispatchStart = latestUserIndex + 1;
  }

  for (const message of messages.slice(dispatchStart)) {
    if (message?.role !== "assistant") continue;
    for (const call of message.tool_calls || []) {
      if (call.function?.name !== "thread") continue;
      try {
        const name = JSON.parse(call.function.arguments || "{}").name;
        if (typeof name === "string" && name.trim()) names.add(name);
      } catch (_) {
        // Malformed historical tool arguments should not hide active work.
      }
    }
  }
  return { marker, names };
}

function eventThreadName(event) {
  if (!event) return null;
  if (event.thread_name) return event.thread_name;
  if (["thread_started", "thread_log", "thread_finished", "thread_steering_queued", "thread_steering_delivered", "thread_steering_expired"].includes(event.type)) return event.name || null;
  return null;
}

function lastSequenceOfType(events, type) {
  let sequence = 0;
  for (const envelope of events) if (agentEvent(envelope)?.type === type) sequence = Math.max(sequence, Number(envelope.sequence_id || 0));
  return sequence;
}

function buildThreadActions(name, events, snapshot) {
  const actions = [];
  const calls = new Map();
  const observedSteering = new Set();
  const episodes = snapshot?.thread_episodes?.[name] || [];
  const latestEpisode = episodes.at(-1);
  for (const envelope of events) {
    const event = agentEvent(envelope);
    if (!event) continue;
    if (event.type === "thread_started") actions.push({ name: "dispatch", result: "started", state: "live", detail: compactActionDetail(event.action) });
    if (event.type === "tool_call_started") {
      const action = {
        name: event.name || "tool",
        result: "running",
        state: "live",
        callId: event.call_id,
        detail: formatToolArguments(event.args_detail, event.args_preview),
      };
      actions.push(action);
      calls.set(event.call_id, action);
    }
    if (event.type === "tool_call_finished") {
      const existing = calls.get(event.call_id);
      if (existing) {
        existing.result = event.is_error ? "failed" : "done";
        existing.state = event.is_error ? "error" : "done";
      } else actions.push({ name: event.name || "tool", result: event.is_error ? "failed" : "done", state: event.is_error ? "error" : "done", detail: compactActionDetail(event.content_preview) });
    }
    if (event.type === "thread_steering_queued") {
      observedSteering.add(event.steering_id);
      actions.push({ name: "steering", result: "queued", state: "live", detail: compactActionDetail(event.instruction_preview) });
    }
    if (event.type === "thread_steering_delivered") {
      observedSteering.add(event.steering_id);
      actions.push({ name: "steering", result: "delivered", state: "done", detail: compactActionDetail(event.instruction_preview) });
    }
    if (event.type === "thread_steering_expired") {
      observedSteering.add(event.steering_id);
      actions.push({ name: "steering", result: "expired", state: "error", detail: compactActionDetail(event.instruction_preview) });
    }
    if (event.type === "assistant_message") actions.push({ name: "response", result: "returned", state: "done", detail: compactActionDetail(event.content) });
    if (event.type === "error") actions.push({ name: "error", result: "failed", state: "error", detail: compactActionDetail(event.message) });
    if (event.type === "thread_finished") {
      const succeeded = event.exit_code === 0 && !event.timed_out;
      actions.push({
        name: "thread",
        result: event.timed_out ? "timed out" : succeeded ? "returned" : `exit ${event.exit_code}`,
        state: succeeded ? "done" : "error",
        detail: compactActionDetail(event.timeout_reason || latestEpisode?.content || ""),
      });
    }
  }
  if (!events.length) {
    for (const record of snapshot?.thread_steering || []) {
      if (record.thread_name !== name || observedSteering.has(record.id)) continue;
      actions.push({
        name: "steering",
        result: record.status,
        state: record.status === "queued" ? "live" : record.status === "expired" ? "error" : "done",
        detail: compactActionDetail(record.instruction),
      });
    }
  }
  return actions;
}

function buildRetainedThreadActions(name, record, snapshot) {
  const actions = [];
  if (record?.latest_action) {
    actions.push({ name: "dispatch", result: "recorded", state: "done", detail: compactActionDetail(record.latest_action) });
  }
  const episodes = snapshot?.thread_episodes?.[name] || [];
  for (const episode of episodes.slice(-3)) {
    actions.push({ name: "response", result: "retained", state: "done", detail: compactActionDetail(episode.content) });
  }
  const latestEpisode = episodes.at(-1);
  if (latestEpisode) actions.push({ name: "thread", result: "returned", state: "done", detail: compactActionDetail(latestEpisode.content) });
  return actions;
}

function renderThreads(snapshot) {
  const models = buildThreadModels(snapshot);
  if (state.targetedThread && !models.some((thread) => thread.name === state.targetedThread && ["running", "queued"].includes(thread.state))) state.targetedThread = null;
  const current = models.filter((thread) => !thread.compact);
  const earlier = models.filter((thread) => thread.compact);
  const currentGrid = current.length ? `<div class="thread-current-grid">${current.map(renderThreadTile).join("")}</div>` : "";
  const earlierGrid = earlier.length ? `<div class="thread-earlier-grid ${current.length ? "" : "is-only"}">${earlier.map(renderThreadTile).join("")}</div>` : "";
  el.threadGrid.innerHTML = models.length ? currentGrid + earlierGrid : `<p class="thread-board-empty">Threads appear here when work is dispatched.</p>`;
  renderComposerTarget();
}

function renderThreadTile(thread) {
  const selected = state.targetedThread === thread.name;
  const available = ["running", "queued"].includes(thread.state);
  const label = available ? `Target ${thread.name} for steering` : `Open ${thread.name} fullscreen`;
  const ledger = thread.compact ? "" : `<ol class="action-ledger">${renderActionRows(thread.actions, "Awaiting first action")}</ol>`;
  const visibleState = thread.compact ? "" : escapeHtml(thread.state);
  return `<article class="thread-tile ${thread.compact ? "is-compact" : ""} ${selected ? "is-selected" : ""}" data-state="${thread.state}"><header class="thread-tile-head"><button class="thread-select" type="button" data-thread-name="${escapeAttr(thread.name)}" data-thread-state="${thread.state}" aria-pressed="${selected}" aria-label="${escapeAttr(label)}"><span class="thread-name">${escapeHtml(thread.name)}</span><span class="thread-state" aria-label="${escapeAttr(thread.state)}">${visibleState}</span></button><button class="expand-button thread-expand" type="button" data-focus-thread="${escapeAttr(thread.name)}" aria-label="Open ${escapeAttr(thread.name)} fullscreen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"></path></svg></button></header>${ledger}</article>`;
}

function renderActionRows(actions, emptyLabel) {
  const visible = actions.slice(-ACTION_LEDGER_LIMIT);
  const placeholders = Array.from({ length: ACTION_LEDGER_LIMIT - visible.length }, (_, index) => {
    const label = !visible.length && index === ACTION_LEDGER_LIMIT - 1 ? emptyLabel : "";
    return `<li class="action-row is-placeholder" aria-hidden="true">${label ? `<span class="action-detail">${escapeHtml(label)}</span>` : ""}</li>`;
  });
  const rows = visible.map((action) => {
    const rowClass = action.state === "live" ? "is-live" : action.state === "error" ? "is-error" : "";
    const marker = action.state === "live" ? "›" : action.state === "error" ? "×" : action.state === "done" ? "✓" : "·";
    const detail = action.detail ? `<span class="action-detail">${escapeHtml(action.detail)}</span>` : "";
    return `<li class="action-row ${rowClass} ${detail ? "has-detail" : ""}"><span class="action-mark">${marker}</span><span class="action-name">${escapeHtml(action.name)}</span><span class="action-result">${escapeHtml(action.result)}</span>${detail}</li>`;
  });
  return placeholders.concat(rows).join("");
}

function formatToolArguments(argsDetail, argsPreview) {
  const raw = String(argsDetail || argsPreview || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return compactActionDetail(raw);
    const priority = ["cmd", "path", "name", "action", "query", "prompt", "workdir"];
    const rank = (key) => {
      const index = priority.indexOf(key);
      return index === -1 ? priority.length : index;
    };
    const entries = Object.entries(parsed).sort(([a], [b]) => rank(a) - rank(b));
    return compactActionDetail(entries.map(([key, value]) => `${key}: ${formatArgumentValue(value)}`).join(" · "));
  } catch (_) {
    return compactActionDetail(raw);
  }
}

function formatArgumentValue(value) {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
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

function renderComposerTarget() {
  const targeted = Boolean(state.targetedThread);
  const orchestratorActive = Boolean(currentSnapshot()?.active_run);
  el.composerTarget.hidden = !targeted;
  el.composerTargetName.textContent = state.targetedThread || "";
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
  const input = el.promptInput.value.trim();
  if (!input || state.submitting || !state.currentId) return;
  if (input.startsWith("/")) {
    const [name, ...rest] = input.slice(1).split(/\s+/);
    if (commands.some((command) => command.name === name)) {
      el.promptInput.value = rest.join(" ");
      resizeComposer();
      runCommand(name);
      return;
    }
  }
  state.submitting = true;
  el.sendPrompt.disabled = true;
  if (!state.targetedThread && state.focusView?.type === "orchestrator") {
    state.orchestratorViewport = { sessionId: state.currentId, pinnedToBottom: true, scrollTop: 0 };
  }
  try {
    if (state.targetedThread) {
      const target = state.targetedThread;
      await apiPost(`/sessions/${encodeURIComponent(state.currentId)}/threads/${encodeURIComponent(target)}/steering`, { instruction: input });
      el.promptInput.value = "";
      showToast(`Steering queued for ${target}`);
      scheduleSnapshot(state.currentId);
    } else if (currentSnapshot()?.active_run) {
      let steered = true;
      try {
        await apiPost(`/sessions/${encodeURIComponent(state.currentId)}/steering`, { instruction: input });
      } catch (error) {
        const runEnded = error.status === 409 && /no active run|finishing/i.test(error.message);
        if (!runEnded) throw error;
        await apiPost(`/sessions/${encodeURIComponent(state.currentId)}/runs`, { prompt: input });
        steered = false;
      }
      el.promptInput.value = "";
      showToast(steered ? "Steering queued for orchestrator" : "Run started");
      scheduleSnapshot(state.currentId);
      if (!steered) {
        noteSessionRunEvent(state.currentId, "run_started");
        loadSessions({ workspaceStats: false });
      }
    } else {
      await apiPost(`/sessions/${encodeURIComponent(state.currentId)}/runs`, { prompt: input });
      noteSessionRunEvent(state.currentId, "run_started");
      el.promptInput.value = "";
      showToast("Run started");
      scheduleSnapshot(state.currentId);
      loadSessions({ workspaceStats: false });
    }
  } catch (error) { showToast(error.message, true); }
  finally {
    state.submitting = false;
    el.sendPrompt.disabled = false;
    resizeComposer();
    el.promptInput.focus();
  }
}

function handleComposerInput() {
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

function renderCommandMenu() {
  const matches = matchingCommands();
  if (!matches.length) {
    el.commandMenu.hidden = true;
    return;
  }
  state.commandIndex = Math.min(state.commandIndex, matches.length - 1);
  el.commandMenu.hidden = false;
  el.commandMenu.innerHTML = matches.map((command, index) => `<button class="command-option ${index === state.commandIndex ? "is-active" : ""}" type="button" data-command-option="${command.name}"><code>/${command.name}</code><span>${escapeHtml(command.description)}</span></button>`).join("");
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
    el.commandMenu.hidden = true;
    return;
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (matches.length && !el.commandMenu.hidden) runCommand(matches[state.commandIndex].name);
    else el.commandComposer.requestSubmit();
  }
}

function runCommand(name) {
  el.commandMenu.hidden = true;
  el.promptInput.value = "";
  resizeComposer();
  if (name === "transcript") openFocusView("orchestrator");
  else if (name === "workspace") openFocusView("workspace");
  else if (name === "settings") openFocusView("settings");
  else if (name === "help") showHelpDrawer();
  else if (name === "stop") stopActiveRun();
  else if (name === "rename") renameCurrentSession();
  else if (name === "delete") deleteCurrentSession();
  else if (name === "clear") clearThreadTarget();
}

function openDrawer(title, html, view = "detail") {
  el.drawerTitle.textContent = title;
  el.drawerContent.innerHTML = html;
  el.utilityDrawer.dataset.view = view;
  el.drawerBackdrop.hidden = false;
  el.utilityDrawer.hidden = false;
  requestAnimationFrame(() => el.closeDrawer.focus());
}

function closeDrawer() {
  el.drawerBackdrop.hidden = true;
  el.utilityDrawer.hidden = true;
  el.drawerContent.innerHTML = "";
}

function showHelpDrawer() {
  openDrawer("commands", `<div class="command-reference">${commands.map((command) => `<div><code>/${command.name}</code><span>${escapeHtml(command.description)}</span></div>`).join("")}</div>`, "compact");
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
  const form = new FormData(event.target);
  const status = document.getElementById("settingsStatus");
  try {
    const headersText = String(form.get("extra_headers") || "{}").trim() || "{}";
    const headers = JSON.parse(headersText);
    if (!headers || Array.isArray(headers) || typeof headers !== "object") throw new Error("Extra headers must be a JSON object");
    status.textContent = "Saving…";
    const updated = await apiPatch(`/sessions/${encodeURIComponent(state.currentId)}/config`, {
      backend: String(form.get("backend") || "").trim(),
      reasoning_effort: String(form.get("reasoning_effort") || "").trim() || null,
      model: String(form.get("model") || "").trim(),
      base_url: String(form.get("base_url") || "").trim(),
      api_key_env: String(form.get("api_key_env") || "").trim() || null,
      extra_headers: headers,
    });
    if (state.settingsFocus?.sessionId === state.currentId && updated) state.settingsFocus.config = updated;
    status.textContent = "saved";
    await loadSnapshot(state.currentId, false);
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("is-error");
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
  openDrawer("rename session", `<form id="renameForm" class="settings-form"><label class="field span-two"><span>session title</span><input name="title" maxlength="120" autocomplete="off" value="${escapeAttr(entry.summary.title || "")}" placeholder="${escapeAttr(shortId(entry.summary.session_id))}"></label><div class="settings-actions"><span class="form-status" data-rename-status></span><button class="button button-primary" type="submit">save title</button></div></form>`, "compact");
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
  openDrawer("delete session", `<form id="deleteSessionForm" class="settings-form"><div class="span-two"><p class="workset-goal">Delete <strong>${escapeHtml(displaySessionTitle(entry.summary))}</strong> and its transcript, worksets, retained episodes, and steering history. This cannot be undone.</p></div><div class="settings-actions"><span class="form-status" data-delete-status></span><button class="button button-danger" type="submit">delete permanently</button></div></form>`, "compact");
}

async function confirmSessionDeletion(formElement) {
  const status = formElement.querySelector("[data-delete-status]");
  status.textContent = "Deleting…";
  try {
    await apiDelete(`/sessions/${encodeURIComponent(state.currentId)}`);
    closeDrawer();
    showPicker();
    await loadSessions({ workspaceStats: true });
    showToast("Session deleted");
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("is-error");
  }
}

function openLaunchDialog() {
  el.launchStatus.textContent = "";
  el.launchStatus.classList.remove("is-error");
  if (!el.launchCwd.value && state.store?.root_cwd) el.launchCwd.value = state.store.root_cwd;
  el.launchDialog.showModal();
  requestAnimationFrame(() => el.launchCwd.focus());
}

function syncLaunchExecutionMode() {
  const mode = new FormData(el.launchForm).get("execution_mode") || "local";
  el.launchSshField.hidden = mode !== "ssh";
  el.sandboxFields.hidden = mode !== "sandbox";
  el.launchSshHost.required = mode === "ssh";
}

async function createSession(event) {
  event.preventDefault();
  const form = new FormData(el.launchForm);
  const mode = form.get("execution_mode") || "local";
  const body = {};
  const cwd = String(form.get("cwd") || "").trim();
  if (cwd) body.cwd = cwd;
  if (mode === "ssh") body.ssh_host = String(form.get("ssh_host") || "").trim();
  for (const [key, element] of [["backend", el.launchBackend], ["reasoning_effort", el.launchEffort], ["model", el.launchModel], ["base_url", el.launchBaseUrl], ["api_key_env", el.launchApiKeyEnv]]) {
    const value = element.value.trim();
    if (value) body[key] = value;
  }
  const headerText = el.launchExtraHeaders.value.trim();
  try {
    if (headerText) {
      const headers = JSON.parse(headerText);
      if (!headers || Array.isArray(headers) || typeof headers !== "object") throw new Error("Extra headers must be a JSON object");
      body.extra_headers = headers;
    }
  } catch (error) {
    setLaunchStatus(error.message, true);
    return;
  }
  body.sandbox = {
    enabled: mode === "sandbox",
    no_mount_cwd: el.sandboxNoMount.checked,
    image: el.sandboxImage.value.trim() || null,
    gpus: el.sandboxGpu.value.split(",").map((value) => value.trim()).filter(Boolean),
    workdir: el.sandboxWorkdir.value.trim() || null,
    shm_size: el.sandboxShm.value.trim() || null,
    mounts: el.sandboxMounts.value.split(",").map((value) => value.trim()).filter(Boolean),
    mounts_ro: [],
  };
  setLaunchStatus("Creating…");
  const submit = el.launchForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const snapshot = await apiPost("/sessions", body);
    const sessionId = snapshot.metadata.session_id;
    state.snapshots.set(sessionId, snapshot);
    const initialPrompt = el.initialPrompt.value.trim();
    el.launchDialog.close();
    el.launchForm.reset();
    if (state.store?.root_cwd) el.launchCwd.value = state.store.root_cwd;
    syncLaunchExecutionMode();
    await loadSessions({ workspaceStats: true });
    openSession(sessionId);
    if (initialPrompt) {
      el.promptInput.value = initialPrompt;
      el.commandComposer.requestSubmit();
    }
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
  if (event.key === "Escape" && state.focusView) closeFocusView();
  else if (event.key === "Escape" && !el.utilityDrawer.hidden) closeDrawer();
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

function relativeTime(value) {
  const normalized = String(value || "").includes("T") ? String(value) : `${String(value || "").replace(" ", "T")}Z`;
  const timestamp = new Date(normalized).getTime();
  if (!Number.isFinite(timestamp)) return "Generated";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function messageText(message) {
  if (message.content) return String(message.content);
  if (message.reasoning_text) return String(message.reasoning_text);
  if (message.tool_calls?.length) return message.tool_calls.map((call) => call.function?.name || "tool").join(", ");
  return "";
}

function backendOptions(selected) {
  const values = ["openai-responses", "chatgpt-codex-responses", "anthropic-messages", "deepseek-chat", "fireworks-chat", "together-chat", "arcee-auth", "arcee-api"];
  return values.map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`).join("");
}

function effortOptions(selected) {
  return ["", "low", "medium", "high", "xhigh"].map((value) => `<option value="${value}" ${value === (selected || "") ? "selected" : ""}>${value || "default"}</option>`).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function escapeAttr(value) { return escapeHtml(value); }
function cssEscape(value) { return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&"); }
