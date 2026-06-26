/* ═══════════════════════════════════════════════════════════════════════
   nac-queue — dashboard SPA (vanilla JS, no frameworks)
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  // ─── DOM refs ────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const launchModal   = $("launchModal");
  const launchForm    = $("launchForm");
  const cwdInput      = $("cwdInput");
  const agentsInput   = $("agentsInput");
  const goalInput     = $("goalInput");
  const launchBtn     = $("launchBtn");
  const launchError   = $("launchError");
  const dashboard     = $("dashboard");
  const dashGoal      = $("dashGoal");
  const statusBadge   = $("statusBadge");
  const iterationBadge= $("iterationBadge");
  const stopBtn       = $("stopBtn");
  const plannerBanner = $("plannerBanner");
  const implList      = $("implList");
  const verifyList    = $("verifyList");
  const mergeList     = $("mergeList");
  const implCount     = $("implCount");
  const verifyCount   = $("verifyCount");
  const mergeCount    = $("mergeCount");

  // ─── State ───────────────────────────────────────────────────────────
  let currentState = null;
  let eventSource = null;
  let pollTimer = null;
  let reconnectTimer = null;

  // ─── Utility functions ───────────────────────────────────────────────

  function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function truncate(text, length) {
    if (!text) return "";
    return text.length > length ? text.slice(0, length) + "…" : text;
  }

  function formatTime(isoString) {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return "";
    }
  }

  function createBadge(text, colorClass) {
    const span = document.createElement("span");
    span.className = "task-status-badge " + colorClass;
    span.textContent = text;
    return span;
  }

  // ─── Launch modal ────────────────────────────────────────────────────

  function validateLaunchForm() {
    const cwd = cwdInput.value.trim();
    const goal = goalInput.value.trim();
    const agents = parseInt(agentsInput.value, 10);
    const valid = cwd && goal && agents >= 1 && agents <= 10;
    launchBtn.disabled = !valid;
  }

  cwdInput.addEventListener("input", validateLaunchForm);
  goalInput.addEventListener("input", validateLaunchForm);
  agentsInput.addEventListener("input", validateLaunchForm);

  launchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    launchError.textContent = "";

    const body = {
      cwd: cwdInput.value.trim(),
      concurrent_agents: parseInt(agentsInput.value, 10),
      goal: goalInput.value.trim(),
    };

    try {
      const resp = await fetch("/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        launchError.textContent = data.error || "Launch failed (HTTP " + resp.status + ")";
        return;
      }

      // Success — switch to dashboard
      hideModal();
      showDashboard();
      startEventStream();
      startPolling();
      // Fetch initial state immediately
      fetchState();
    } catch (err) {
      launchError.textContent = "Network error: " + err.message;
    }
  });

  function hideModal() {
    launchModal.classList.add("hidden");
  }

  function showModal() {
    launchModal.classList.remove("hidden");
  }

  function showDashboard() {
    dashboard.classList.remove("hidden");
  }

  // ─── Stop flow ───────────────────────────────────────────────────────

  stopBtn.addEventListener("click", async () => {
    stopBtn.disabled = true;
    stopBtn.textContent = "Stopping…";
    try {
      await fetch("/stop", { method: "POST" });
    } catch (err) {
      console.error("stop failed:", err);
    }
  });

  // ─── State fetching ──────────────────────────────────────────────────

  async function fetchState() {
    try {
      const resp = await fetch("/state");
      if (!resp.ok) return;
      const state = await resp.json();
      currentState = state;
      renderState(state);
    } catch (err) {
      console.error("fetchState error:", err);
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(fetchState, 2000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // ─── SSE event stream ────────────────────────────────────────────────

  function startEventStream() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    eventSource = new EventSource("/events");

    eventSource.addEventListener("state_event", (e) => {
      try {
        const evt = JSON.parse(e.data);
        handleStateEvent(evt);
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    });

    eventSource.addEventListener("lagged", (e) => {
      console.warn("SSE lagged — missed events:", e.data);
      // Full refresh to recover
      fetchState();
    });

    eventSource.onerror = () => {
      console.warn("SSE connection lost, reconnecting in 3s…");
      eventSource.close();
      eventSource = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        startEventStream();
      }, 3000);
    };
  }

  function handleStateEvent(evt) {
    if (!evt || !evt.type) return;

    switch (evt.type) {
      case "pipeline_started":
        // Fresh start — fetch full state
        fetchState();
        break;

      case "planner_started":
        showPlannerIndicator(true);
        fetchState();
        break;

      case "planner_completed":
      case "planner_failed":
        showPlannerIndicator(false);
        fetchState();
        break;

      case "pipeline_completed":
      case "pipeline_failed":
      case "pipeline_stopped":
        fetchState();
        break;

      // For all task-level events, just refresh state — the full re-render
      // is cheap and guarantees consistency.
      case "task_added":
      case "task_started":
      case "task_completed":
      case "task_failed":
      case "task_moved":
      case "merge_started":
      case "merge_completed":
      case "merge_failed":
        fetchState();
        break;

      default:
        fetchState();
        break;
    }
  }

  // ─── Rendering ───────────────────────────────────────────────────────

  function renderState(state) {
    if (!state) return;

    // Goal
    dashGoal.textContent = state.goal || "";
    dashGoal.title = state.goal || "";

    // Status badge
    updateStatusBadge(state.status);

    // Iteration
    const iter = state.planner_iteration || 0;
    const maxIter = state.max_iterations || 10;
    iterationBadge.textContent = "Iteration: " + iter + "/" + maxIter;

    // Stop button visibility
    const isRunning = ["planning", "running", "stopping"].includes(state.status);
    if (isRunning && state.status !== "stopping") {
      stopBtn.classList.remove("hidden");
      stopBtn.disabled = false;
      stopBtn.textContent = "Stop";
    } else {
      stopBtn.classList.add("hidden");
    }

    // Planner indicator
    showPlannerIndicator(state.status === "planning");

    // Queue counts
    const implTasks = state.impl_queue || [];
    const verifyTasks = state.verify_queue || [];
    const mergeTasks = state.merge_queue || [];
    implCount.textContent = implTasks.length;
    verifyCount.textContent = verifyTasks.length;
    mergeCount.textContent = mergeTasks.length;

    // Render queues
    renderQueue(implList, implTasks, "implementation");
    renderQueue(verifyList, verifyTasks, "verification");
    renderQueue(mergeList, mergeTasks, "merge");
  }

  function renderQueue(listEl, tasks, queueType) {
    listEl.innerHTML = "";

    if (!tasks || tasks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No tasks";
      listEl.appendChild(empty);
      return;
    }

    for (const task of tasks) {
      listEl.appendChild(renderTaskCard(task));
    }
  }

  function renderTaskCard(task) {
    const card = document.createElement("div");
    card.className = "task-card";
    card.dataset.taskId = task.id;

    // Head: title + status badge
    const head = document.createElement("div");
    head.className = "task-card-head";

    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = task.title;
    head.appendChild(title);

    const statusText = (task.status || "queued").replace(/_/g, " ");
    const badge = createBadge(statusText, task.status || "queued");
    head.appendChild(badge);
    card.appendChild(head);

    // Description (truncated, expandable)
    if (task.description) {
      const desc = document.createElement("div");
      desc.className = "task-desc";
      desc.textContent = task.description;
      card.appendChild(desc);
    }

    // Meta items: session ID, branch name, retry count
    const meta = document.createElement("div");
    meta.className = "task-meta";

    if (task.nac_session_id) {
      const sid = document.createElement("span");
      sid.className = "task-meta-item";
      sid.textContent = "session: " + truncate(task.nac_session_id, 16);
      sid.title = task.nac_session_id;
      meta.appendChild(sid);
    }

    if (task.branch_name) {
      const br = document.createElement("span");
      br.className = "task-meta-item";
      br.textContent = "branch: " + task.branch_name;
      meta.appendChild(br);
    }

    if (task.retry_count && task.retry_count > 0) {
      const retry = document.createElement("span");
      retry.className = "retry-badge";
      retry.textContent = "Retry " + task.retry_count;
      meta.appendChild(retry);
    }

    if (meta.children.length > 0) {
      card.appendChild(meta);
    }

    // Failure notes
    if (task.failure_notes) {
      const fn = document.createElement("div");
      fn.className = "task-failure";
      fn.textContent = "Previous failure: " + task.failure_notes;
      card.appendChild(fn);
    }

    if (task.failure_reason) {
      const fr = document.createElement("div");
      fr.className = "task-failure";
      fr.textContent = "Failed: " + task.failure_reason;
      card.appendChild(fr);
    }

    // Result / summary
    if (task.result) {
      const res = document.createElement("div");
      res.className = "task-result";
      res.textContent = task.result;
      card.appendChild(res);
    }

    // Click to expand/collapse
    card.addEventListener("click", () => {
      card.classList.toggle("expanded");
    });

    return card;
  }

  function updateStatusBadge(status) {
    statusBadge.className = "status-badge " + (status || "idle");
    statusBadge.textContent = (status || "idle").replace(/_/g, " ");
  }

  function showPlannerIndicator(show) {
    if (show) {
      plannerBanner.classList.remove("hidden");
    } else {
      plannerBanner.classList.add("hidden");
    }
  }

  // ─── Initialization ──────────────────────────────────────────────────

  async function init() {
    // Check if pipeline is already running
    try {
      const resp = await fetch("/state");
      if (resp.ok) {
        const state = await resp.json();
        currentState = state;

        if (state.status && state.status !== "idle") {
          // Pipeline is running — show dashboard directly
          hideModal();
          showDashboard();
          renderState(state);
          startEventStream();
          startPolling();
          return;
        }
      }
    } catch (err) {
      console.error("init fetchState error:", err);
    }

    // Show launch modal
    showModal();
    validateLaunchForm();
  }

  // Clean up on page unload
  window.addEventListener("beforeunload", () => {
    if (eventSource) eventSource.close();
    stopPolling();
    if (reconnectTimer) clearTimeout(reconnectTimer);
  });

  // Start
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();