const picker = document.getElementById("sessionPicker");
const workspace = document.getElementById("sessionWorkspace");
const sessionGrid = document.getElementById("sessionGrid");
const sessionSearch = document.getElementById("sessionSearch");
const sessionFilters = document.getElementById("sessionFilters");
const sessionReorderStatus = document.getElementById("sessionReorderStatus");
const launchDialog = document.getElementById("launchDialog");
const launchForm = document.getElementById("launchForm");
const executionModes = document.getElementById("executionModes");
const launchReadiness = document.getElementById("launchReadiness");
const advancedSettings = document.getElementById("advancedSettings");
const threadGrid = document.getElementById("threadGrid");
const threadFilters = document.getElementById("threadFilters");
const composer = document.getElementById("commandComposer");
const composerInput = document.getElementById("composerInput");
const composerTarget = document.getElementById("composerTarget");
const composerHint = document.getElementById("composerHint");
const commandMenu = document.getElementById("commandMenu");
const refreshOverview = document.getElementById("refreshOverview");
const overviewCopy = document.getElementById("overviewCopy");
const toast = document.getElementById("prototypeToast");

let activeFilter = "all";
let activeThreadFilter = "all";
let selectedThread = null;
let toastTimer = null;
let sessionReorder = null;

function showPicker() {
  picker.hidden = false;
  workspace.hidden = true;
  selectedThread = null;
  document.title = "NAC UI exploration";
  if (window.location.hash) history.replaceState(null, "", window.location.pathname);
  requestAnimationFrame(() => sessionSearch.focus({ preventScroll: true }));
}

function showWorkspace() {
  picker.hidden = true;
  workspace.hidden = false;
  document.title = "ui-exploration · NAC";
  history.replaceState(null, "", `${window.location.pathname}#session/ui-exploration`);
  window.scrollTo({ top: 0, behavior: "auto" });
}

function openLaunchDialog() {
  if (typeof launchDialog.showModal === "function") launchDialog.showModal();
}

function closeLaunchDialog() {
  launchDialog.close();
}

function syncExecutionMode() {
  const mode = executionModes.querySelector('input[name="execution"]:checked')?.value || "local";
  const states = {
    local: [
      ["Workspace found", false],
      ["Model configured", false],
      ["CWD mounted", false],
    ],
    ssh: [
      ["SSH host required", true],
      ["Model configured", false],
      ["Remote CWD inherited", false],
    ],
    sandbox: [
      ["Workspace found", false],
      ["VM image ready", false],
      ["CWD mounted", false],
    ],
  };
  for (const [element, [label, pending]] of [...launchReadiness.children].map((element, index) => [element, states[mode][index]])) {
    element.lastChild.textContent = ` ${label}`;
    element.classList.toggle("pending", pending);
  }
  if (mode === "ssh") advancedSettings.open = true;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function applySessionFilters() {
  const query = sessionSearch.value.trim().toLowerCase();
  for (const card of sessionGrid.querySelectorAll(".session-card[data-state]")) {
    const matchesFilter = activeFilter === "all" || card.dataset.state === activeFilter;
    const searchable = `${card.dataset.search || ""} ${card.textContent}`.toLowerCase();
    card.hidden = !matchesFilter || (query && !searchable.includes(query));
  }
  sessionGrid.classList.toggle("is-filtering", Boolean(query) || activeFilter !== "all");
  syncSessionGroups();
}

function sessionName(card) {
  return card.querySelector(".session-title")?.textContent.trim() || card.dataset.sessionId;
}

function sessionCards(grid) {
  return [...grid.querySelectorAll(":scope > .session-card[data-session-id]")];
}

function updateSessionPositionLabels(grid) {
  const cards = sessionCards(grid);
  const pinned = grid.dataset.pinned === "true";
  const groupLabel = pinned ? "pinned sessions" : "sessions";
  cards.forEach((card, index) => {
    const handle = card.querySelector(".session-reorder-handle");
    if (handle) handle.setAttribute("aria-label", `Reorder ${sessionName(card)} in ${groupLabel}; position ${index + 1} of ${cards.length}`);
  });
}

function syncSessionGroups() {
  for (const group of sessionGrid.querySelectorAll(".session-group")) {
    const grid = group.querySelector(".session-grid");
    const cards = sessionCards(grid);
    const visibleCount = cards.filter((card) => !card.hidden).length;
    group.querySelector("[data-group-count]").textContent = String(cards.length);
    group.hidden = visibleCount === 0;
    updateSessionPositionLabels(grid);
  }
}

function announceSessionReorder(message) {
  sessionReorderStatus.textContent = "";
  requestAnimationFrame(() => {
    sessionReorderStatus.textContent = message;
  });
}

function toggleSessionPin(button) {
  if (sessionReorder) return;
  const card = button.closest(".session-card[data-session-id]");
  if (!card) return;
  const wasPinned = card.dataset.pinned === "true";
  const destination = sessionGrid.querySelector(`.session-grid[data-pinned="${!wasPinned}"]`);
  card.dataset.pinned = String(!wasPinned);
  destination.append(card);
  button.setAttribute("aria-pressed", String(!wasPinned));
  button.setAttribute("aria-label", `${wasPinned ? "Pin" : "Unpin"} ${sessionName(card)}`);
  applySessionFilters();
  const message = `${sessionName(card)} ${wasPinned ? "unpinned" : "pinned"}.`;
  announceSessionReorder(message);
  showToast(message);
}

function reorderCardsById(grid, ids) {
  const byId = new Map(sessionCards(grid).map((card) => [card.dataset.sessionId, card]));
  for (const id of ids) {
    const card = byId.get(id);
    if (card) grid.append(card);
  }
}

function startKeyboardSessionReorder(card, handle) {
  if (sessionGrid.classList.contains("is-filtering")) {
    announceSessionReorder("Clear the session filter before reordering.");
    showToast("Clear the filter to reorder sessions.");
    return;
  }
  if (sessionReorder) return;
  const grid = card.closest(".session-grid");
  const originalIds = sessionCards(grid).map((candidate) => candidate.dataset.sessionId);
  sessionReorder = { kind: "keyboard", card, grid, handle, originalIds };
  card.classList.add("is-reordering");
  grid.classList.add("is-reordering");
  document.body.classList.add("session-reordering");
  announceSessionReorder(`${sessionName(card)} ready to move. Use arrow keys, Home, or End, then Enter or Space to save.`);
}

function moveKeyboardSession(event) {
  const { card, grid } = sessionReorder;
  const cards = sessionCards(grid);
  const currentIndex = cards.indexOf(card);
  let nextIndex = currentIndex;
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex -= 1;
  else if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex += 1;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = cards.length - 1;
  else return false;
  nextIndex = Math.max(0, Math.min(cards.length - 1, nextIndex));
  if (nextIndex !== currentIndex) {
    const ids = cards.map((candidate) => candidate.dataset.sessionId);
    ids.splice(currentIndex, 1);
    ids.splice(nextIndex, 0, card.dataset.sessionId);
    reorderCardsById(grid, ids);
    updateSessionPositionLabels(grid);
    sessionReorder.handle.focus();
    announceSessionReorder(`${sessionName(card)}, position ${nextIndex + 1} of ${cards.length}.`);
  }
  return true;
}

function finishKeyboardSessionReorder(cancelled) {
  if (!sessionReorder || sessionReorder.kind !== "keyboard") return;
  const { card, grid, originalIds } = sessionReorder;
  if (cancelled) reorderCardsById(grid, originalIds);
  card.classList.remove("is-reordering");
  grid.classList.remove("is-reordering");
  document.body.classList.remove("session-reordering");
  sessionReorder = null;
  updateSessionPositionLabels(grid);
  const message = `${sessionName(card)} order ${cancelled ? "restored" : "saved"}.`;
  announceSessionReorder(message);
  showToast(message);
}

function startPointerSessionReorder(event, handle) {
  if (sessionGrid.classList.contains("is-filtering")) {
    announceSessionReorder("Clear the session filter before reordering.");
    showToast("Clear the filter to reorder sessions.");
    return;
  }
  if (sessionReorder || (event.pointerType === "mouse" && event.button !== 0)) return;
  const card = handle.closest(".session-card[data-session-id]");
  const grid = card?.closest(".session-grid");
  if (!card || !grid) return;
  const rect = card.getBoundingClientRect();
  sessionReorder = {
    kind: "pointer-pending",
    pointerId: event.pointerId,
    card,
    grid,
    handle,
    originalIds: sessionCards(grid).map((candidate) => candidate.dataset.sessionId),
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    rect,
    placeholder: null,
  };
  try { handle.setPointerCapture(event.pointerId); } catch (_) {}
}

function beginPointerSessionReorder() {
  const reorder = sessionReorder;
  if (!reorder || reorder.kind !== "pointer-pending") return;
  const placeholder = document.createElement("div");
  placeholder.className = "session-card-placeholder";
  placeholder.style.minHeight = `${Math.round(reorder.rect.height)}px`;
  placeholder.setAttribute("aria-hidden", "true");
  reorder.grid.insertBefore(placeholder, reorder.card);
  reorder.placeholder = placeholder;
  reorder.kind = "pointer";
  reorder.card.classList.add("is-reordering", "is-dragging");
  reorder.grid.classList.add("is-reordering");
  document.body.classList.add("session-reordering");
  Object.assign(reorder.card.style, {
    position: "fixed",
    left: `${reorder.rect.left}px`,
    top: `${reorder.rect.top}px`,
    width: `${reorder.rect.width}px`,
    height: `${reorder.rect.height}px`,
    margin: "0",
  });
  announceSessionReorder(`${sessionName(reorder.card)} dragging within ${reorder.grid.dataset.pinned === "true" ? "pinned sessions" : "sessions"}.`);
}

function positionPointerSessionReorder(event) {
  const reorder = sessionReorder;
  reorder.card.style.left = `${Math.round(event.clientX - reorder.offsetX)}px`;
  reorder.card.style.top = `${Math.round(event.clientY - reorder.offsetY)}px`;
  const gridRect = reorder.grid.getBoundingClientRect();
  if (event.clientX < gridRect.left || event.clientX > gridRect.right || event.clientY < gridRect.top || event.clientY > gridRect.bottom) return;
  const candidates = sessionCards(reorder.grid).filter((card) => card !== reorder.card);
  let before = null;
  for (const candidate of candidates) {
    const rect = candidate.getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2 || (event.clientY <= rect.bottom && event.clientX < rect.left + rect.width / 2)) {
      before = candidate;
      break;
    }
  }
  if (before) reorder.grid.insertBefore(reorder.placeholder, before);
  else reorder.grid.append(reorder.placeholder);
}

function finishPointerSessionReorder(cancelled) {
  const reorder = sessionReorder;
  if (!reorder || !reorder.kind.startsWith("pointer")) return;
  if (reorder.kind === "pointer-pending") {
    sessionReorder = null;
    try { reorder.handle.releasePointerCapture(reorder.pointerId); } catch (_) {}
    return;
  }
  reorder.grid.insertBefore(reorder.card, reorder.placeholder);
  reorder.placeholder.remove();
  for (const property of ["position", "left", "top", "width", "height", "margin"]) reorder.card.style.removeProperty(property);
  reorder.card.classList.remove("is-reordering", "is-dragging");
  reorder.grid.classList.remove("is-reordering");
  document.body.classList.remove("session-reordering");
  if (cancelled) reorderCardsById(reorder.grid, reorder.originalIds);
  sessionReorder = null;
  try { reorder.handle.releasePointerCapture(reorder.pointerId); } catch (_) {}
  updateSessionPositionLabels(reorder.grid);
  const message = `${sessionName(reorder.card)} order ${cancelled ? "restored" : "saved"}.`;
  announceSessionReorder(message);
  showToast(message);
}

function applyThreadFilters() {
  for (const card of threadGrid.querySelectorAll(".thread-card")) {
    card.hidden = activeThreadFilter !== "all" && card.dataset.status !== activeThreadFilter;
  }
  const selectedCard = selectedThread && threadGrid.querySelector(`[data-thread="${CSS.escape(selectedThread)}"]`);
  if (selectedCard?.hidden) resetComposerTarget();
}

function selectThread(card) {
  const threadName = card.dataset.thread;
  const wasSelected = selectedThread === threadName;
  selectedThread = wasSelected ? null : threadName;

  for (const candidate of threadGrid.querySelectorAll(".thread-card")) {
    const selected = candidate.dataset.thread === selectedThread;
    candidate.classList.toggle("selected", selected);
    candidate.setAttribute("aria-pressed", selected ? "true" : "false");
  }

  const targetName = composerTarget.querySelector("strong");
  if (selectedThread) {
    targetName.textContent = selectedThread;
    composerHint.textContent = "Instruction is queued after this thread's current action.";
    composerInput.placeholder = `Steer ${selectedThread} after its current action…`;
  } else {
    targetName.textContent = "Orchestrator";
    composerHint.textContent = "Steering is applied when active threads return.";
    composerInput.placeholder = "Steer the orchestrator…  / for commands";
  }
  composerInput.focus({ preventScroll: true });
}

function resetComposerTarget() {
  if (!selectedThread) return;
  selectedThread = null;
  for (const candidate of threadGrid.querySelectorAll(".thread-card")) {
    candidate.classList.remove("selected");
    candidate.setAttribute("aria-pressed", "false");
  }
  composerTarget.querySelector("strong").textContent = "Orchestrator";
  composerHint.textContent = "Steering is applied when active threads return.";
  composerInput.placeholder = "Steer the orchestrator…  / for commands";
}

function syncCommandMenu() {
  commandMenu.hidden = !composerInput.value.trimStart().startsWith("/");
}

function stageCommand(command) {
  composerInput.value = command;
  composerInput.focus();
  syncCommandMenu();
}

function runPrototypeCommand(command) {
  const messages = {
    "/settings": "Prototype: session settings would open here.",
    "/stop": "Prototype: the active orchestration would be stopped after confirmation.",
    "/transcript": "Prototype: the complete orchestrator transcript would open in a side panel.",
  };
  commandMenu.hidden = true;
  composerInput.value = "";
  showToast(messages[command] || `Prototype command: ${command}`);
}

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "show-picker") showPicker();
  if (action === "open-launch") openLaunchDialog();
  if (action === "close-launch") closeLaunchDialog();
  if (action === "toggle-pin") toggleSessionPin(event.target.closest(".session-pin-button"));

  const session = event.target.closest("[data-session-open]");
  if (session) showWorkspace();

  const thread = event.target.closest(".thread-card[data-thread]");
  if (thread) selectThread(thread);

  const commandButton = event.target.closest("[data-command]");
  if (commandButton) {
    const command = commandButton.dataset.command;
    if (commandButton.closest("#commandMenu")) runPrototypeCommand(command);
    else stageCommand(command);
  }
});

sessionFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  activeFilter = button.dataset.filter;
  for (const candidate of sessionFilters.querySelectorAll("button[data-filter]")) {
    const active = candidate === button;
    candidate.classList.toggle("active", active);
    candidate.setAttribute("aria-pressed", active ? "true" : "false");
  }
  applySessionFilters();
});

sessionSearch.addEventListener("input", applySessionFilters);
executionModes.addEventListener("change", syncExecutionMode);

sessionGrid.addEventListener("keydown", (event) => {
  const handle = event.target.closest(".session-reorder-handle");
  if (!handle) return;
  const card = handle.closest(".session-card[data-session-id]");
  if (!sessionReorder) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      startKeyboardSessionReorder(card, handle);
    }
    return;
  }
  if (sessionReorder.kind !== "keyboard" || sessionReorder.card !== card) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    finishKeyboardSessionReorder(false);
  } else if (event.key === "Escape") {
    event.preventDefault();
    finishKeyboardSessionReorder(true);
  } else if (moveKeyboardSession(event)) {
    event.preventDefault();
  }
});

sessionGrid.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest(".session-reorder-handle");
  if (handle) startPointerSessionReorder(event, handle);
});

sessionGrid.addEventListener("pointermove", (event) => {
  if (!sessionReorder || !sessionReorder.kind.startsWith("pointer") || sessionReorder.pointerId !== event.pointerId) return;
  if (sessionReorder.kind === "pointer-pending") {
    const distance = Math.hypot(event.clientX - sessionReorder.startX, event.clientY - sessionReorder.startY);
    if (distance < 5) return;
    beginPointerSessionReorder();
  }
  if (sessionReorder?.kind === "pointer") {
    event.preventDefault();
    positionPointerSessionReorder(event);
  }
});

sessionGrid.addEventListener("pointerup", (event) => {
  if (!sessionReorder || !sessionReorder.kind.startsWith("pointer") || sessionReorder.pointerId !== event.pointerId) return;
  const rect = sessionReorder.grid.getBoundingClientRect();
  const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  finishPointerSessionReorder(outside);
});

sessionGrid.addEventListener("pointercancel", (event) => {
  if (sessionReorder?.kind.startsWith("pointer") && sessionReorder.pointerId === event.pointerId) finishPointerSessionReorder(true);
});

threadFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-thread-filter]");
  if (!button) return;
  activeThreadFilter = button.dataset.threadFilter;
  for (const candidate of threadFilters.querySelectorAll("button[data-thread-filter]")) {
    const active = candidate === button;
    candidate.classList.toggle("active", active);
    candidate.setAttribute("aria-pressed", active ? "true" : "false");
  }
  applyThreadFilters();
});

threadGrid.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !selectedThread) return;
  event.preventDefault();
  resetComposerTarget();
});

composerTarget.addEventListener("click", resetComposerTarget);
composerInput.addEventListener("input", syncCommandMenu);
composerInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !commandMenu.hidden) {
    commandMenu.hidden = true;
    event.preventDefault();
  }
});

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const instruction = composerInput.value.trim();
  if (!instruction) return;
  if (instruction.startsWith("/") && Object.hasOwn({ "/settings": true, "/stop": true, "/transcript": true }, instruction)) {
    runPrototypeCommand(instruction);
    return;
  }
  const target = selectedThread || "the orchestrator";
  composerInput.value = "";
  commandMenu.hidden = true;
  showToast(`Instruction queued for ${target}.`);
});

refreshOverview.addEventListener("click", () => {
  refreshOverview.disabled = true;
  refreshOverview.setAttribute("aria-busy", "true");
  overviewCopy.textContent = "Refreshing the overview from current orchestrator and thread state…";
  window.setTimeout(() => {
    overviewCopy.textContent = "The fixed run context and tool-call ledger are established. Launch readiness is being refined; accessibility review remains blocked on two active threads.";
    refreshOverview.disabled = false;
    refreshOverview.removeAttribute("aria-busy");
    showToast("Generated overview refreshed with the configured model.");
  }, 700);
});

launchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  closeLaunchDialog();
  showToast("Prototype: session launch payload is ready for the existing NAC endpoint.");
});

launchDialog.addEventListener("click", (event) => {
  if (event.target === launchDialog) closeLaunchDialog();
});

for (const card of threadGrid.querySelectorAll(".thread-card")) {
  card.setAttribute("aria-pressed", "false");
}

syncSessionGroups();
if (window.location.hash.startsWith("#session/")) showWorkspace();
