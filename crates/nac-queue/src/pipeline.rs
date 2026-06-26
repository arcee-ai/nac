//! Pipeline orchestrator — the core async loop that drives the nac-queue.
//!
//! [`run_pipeline`] is the main entry point, spawned as a tokio task by the
//! `/launch` API handler. It runs the planner → impl → verify → merge loop
//! until the goal is met, the pipeline fails, or the user stops it.
//!
//! The dispatch layer uses a **unified pipelined scheduler** (`dispatch_all_tasks`)
//! that runs all three queues concurrently with cap-based scheduling, so tasks
//! flow from impl → verify → merge as soon as each individual task finishes
//! rather than waiting for an entire phase to complete.

use std::path::Path;

use anyhow::{Context, Result};
use tokio::task::{JoinHandle, JoinSet};
use tracing::{error, info, warn};

use crate::git;
use crate::nac_client::{NacWebClient, SandboxConfig, SessionEvent, SseStream};
use crate::state::PipelineStateHandle;
use crate::types::{PipelineStatus, PlannerResult, QueueType};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Main entry point for the pipeline orchestration loop.
///
/// Spawned as a tokio task by the `/launch` handler. Runs the planner →
/// impl → verify → merge loop until the goal is met, the pipeline fails,
/// or the user stops it.
///
/// The planner re-runs concurrently inside `dispatch_all_tasks` whenever a
/// merge completes, so the outer loop only fires when all tasks have drained
/// without the goal being met.
pub async fn run_pipeline(state: PipelineStateHandle, nac_web_url: String) -> Result<()> {
    let snapshot = state.get_snapshot().await;
    let goal = snapshot.goal.clone();
    let cwd = snapshot.cwd.clone();
    let concurrent_agents = snapshot.concurrent_agents;
    let max_iterations = snapshot.max_iterations;

    let client = NacWebClient::new(&nac_web_url);

    info!(
        "pipeline started: goal={goal:?}, cwd={cwd:?}, \
         concurrent_agents={concurrent_agents}, max_iterations={max_iterations}"
    );

    loop {
        // -- Check for stop signal --
        if state.get_snapshot().await.status == PipelineStatus::Stopping {
            info!("pipeline stopping");
            cleanup_resources(&cwd);
            return Ok(());
        }

        // -- Run planner --
        info!("running planner");
        match run_planner_and_process(&client, &state, &goal, &cwd, max_iterations).await {
            Ok(true) => {
                // Goal met — complete_pipeline already called inside.
                cleanup_resources(&cwd);
                return Ok(());
            }
            Ok(false) => {
                // Tasks added — proceed to dispatch.
            }
            Err(e) => {
                let msg = format!("{e:#}");
                error!("planner failed: {msg}");
                cleanup_resources(&cwd);
                return Err(e);
            }
        }

        // -- Dispatch all tasks (impl → verify → merge, pipelined) --
        // dispatch_all_tasks re-runs the planner concurrently on each merge.
        info!("dispatching all tasks");
        if let Err(e) =
            dispatch_all_tasks(&client, &state, &goal, &cwd, concurrent_agents, max_iterations)
                .await
        {
            let msg = format!("{e:#}");
            error!("dispatch phase failed: {msg}");
            cleanup_resources(&cwd);
            return Err(e);
        }

        // -- Check status after dispatch --
        let status = state.get_snapshot().await.status;
        if status == PipelineStatus::Completed {
            info!("pipeline completed");
            cleanup_resources(&cwd);
            return Ok(());
        }
        if status == PipelineStatus::Failed {
            info!("pipeline failed");
            cleanup_resources(&cwd);
            return Ok(());
        }
        if status == PipelineStatus::Stopping {
            info!("pipeline stopping after dispatch phase");
            cleanup_resources(&cwd);
            return Ok(());
        }

        // All tasks drained but goal not met — loop back to planner.
        // max_iterations is checked inside run_planner_and_process.
        info!("all tasks drained, looping back to planner");
    }
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/// Run the planner agent: create a session, submit the planner prompt,
/// watch for completion, parse the JSON result, and clean up the session.
async fn run_planner(
    client: &NacWebClient,
    state: &PipelineStateHandle,
    goal: &str,
    cwd: &str,
) -> Result<PlannerResult> {
    // Create planner session on main repo (no sandbox — planner just reads).
    let session_id = client
        .create_session(cwd, None)
        .await
        .context("failed to create planner session")?;

    state.set_planner_session(session_id.clone()).await;
    info!("planner session created: {session_id}");

    // Submit planner prompt.
    let prompt = build_planner_prompt(goal);
    if let Err(e) = client.submit_prompt(&session_id, &prompt).await {
        let msg = format!("failed to submit planner prompt: {e}");
        if let Err(e) = client.delete_session(&session_id).await {
            warn!("failed to delete planner session {session_id}: {e}");
        }
        return Err(anyhow::anyhow!(msg));
    }

    // Watch for completion.
    let watch_result = watch_session_to_completion(client, &session_id).await;

    // Clean up session regardless of outcome.
    if let Err(e) = client.delete_session(&session_id).await {
        warn!("failed to delete planner session {session_id}: {e}");
    }

    let event = watch_result?;
    match event {
        SessionEvent::RunCompleted { response, .. } => {
            info!("planner run completed, parsing result");
            let json =
                extract_json(&response).context("failed to extract JSON from planner response")?;
            let planner_result: PlannerResult = serde_json::from_value(json)
                .context("failed to parse planner result as PlannerResult")?;
            state.set_planner_result(planner_result.clone()).await;
            Ok(planner_result)
        }
        SessionEvent::RunFailed { message } => {
            Err(anyhow::anyhow!("planner run failed: {message}"))
        }
        _ => unreachable!("watch_session_to_completion only returns RunCompleted or RunFailed"),
    }
}

// ---------------------------------------------------------------------------
// Planner runner + result processor
// ---------------------------------------------------------------------------

/// Run the planner agent and process its result in one step.
///
/// This is the reusable planner entry point used both by `run_pipeline` (for
/// the initial run) and by `dispatch_all_tasks` (for concurrent re-runs after
/// each merge completes).
///
/// Returns `Ok(true)` when the planner declares the goal complete (calls
/// `state.complete_pipeline`), `Ok(false)` when the planner produces new
/// tasks (calls `state.add_tasks`), or `Err(...)` on failure (calls
/// `state.fail_pipeline`).
///
/// The `max_iterations` limit is enforced here: if `planner_iteration` has
/// already reached `max_iterations`, the pipeline is failed and an error is
/// returned without running the planner.
async fn run_planner_and_process(
    client: &NacWebClient,
    state: &PipelineStateHandle,
    goal: &str,
    cwd: &str,
    max_iterations: u32,
) -> Result<bool> {
    // -- Check max iterations --
    let snapshot = state.get_snapshot().await;
    if snapshot.planner_iteration >= max_iterations {
        let msg = format!("pipeline exceeded max_iterations ({max_iterations})");
        error!("{msg}");
        state.set_planner_failed(msg.clone()).await;
        state.fail_pipeline(msg.clone()).await;
        return Err(anyhow::anyhow!(msg));
    }

    // -- Check for stop signal --
    if snapshot.status == PipelineStatus::Stopping {
        return Err(anyhow::anyhow!("pipeline stopping"));
    }

    // -- Run the planner agent --
    let planner_result = match run_planner(client, state, goal, cwd).await {
        Ok(result) => result,
        Err(e) => {
            let msg = format!("{e:#}");
            error!("planner failed: {msg}");
            state.set_planner_failed(msg.clone()).await;
            state.fail_pipeline(msg).await;
            return Err(e);
        }
    };

    // -- Process the result --
    match planner_result {
        PlannerResult::Complete { summary } => {
            info!("planner declared goal complete: {summary}");
            state.complete_pipeline(summary).await;
            Ok(true)
        }
        PlannerResult::Incomplete { tasks } => {
            info!("planner produced {} implementation tasks", tasks.len());
            state.add_tasks(tasks).await;
            Ok(false)
        }
    }
}

// ---------------------------------------------------------------------------
// Unified pipelined scheduler
// ---------------------------------------------------------------------------

/// Return type for spawned watcher tasks: (task_id, queue_type, result).
type WatchResult = (String, QueueType, Result<SessionEvent>);

/// Calculate per-queue concurrency caps from the total agent budget `n`.
///
/// The merge cap is always 1 (serialized). The remaining budget is split
/// as evenly as possible between impl and verify, with impl getting the
/// extra slot when the remainder is 1, and verify getting it when the
/// remainder is 2.
///
/// Examples: N=1 → (1,0,1), N=2 → (1,1,1), N=3 → (1,1,1),
/// N=4 → (2,1,1), N=5 → (2,2,1), N=6 → (2,2,1).
fn calculate_caps(n: usize) -> (usize, usize, usize) {
    let base = n / 3;
    let rem = n % 3;
    let impl_cap = base + (if rem > 0 { 1 } else { 0 });
    let verify_cap = base + (if rem > 1 { 1 } else { 0 });
    let merge_cap = 1; // always serialized
    (impl_cap, verify_cap, merge_cap)
}

/// Dispatch all queued tasks across impl, verify, and merge queues
/// concurrently using a cap-based scheduling system.
///
/// Tasks flow through the pipeline as soon as each individual task finishes:
/// an impl task that completes immediately becomes available for verification,
/// without waiting for other impl tasks to finish.
///
/// When a merge task completes successfully, the planner is spawned
/// concurrently (via `tokio::spawn`) to re-evaluate the goal. The dispatch
/// loop uses `tokio::select!` to wait for either a task watcher completing
/// or the planner finishing. If the planner declares the goal complete, all
/// running tasks are aborted and the function returns.
///
/// The function returns when all three queues are drained (no queued tasks
/// and no running tasks) and no planner is in flight.
async fn dispatch_all_tasks(
    client: &NacWebClient,
    state: &PipelineStateHandle,
    goal: &str,
    cwd: &str,
    concurrent_agents: usize,
    max_iterations: u32,
) -> Result<()> {
    let (impl_cap, verify_cap, _merge_cap) = calculate_caps(concurrent_agents);
    let mut join_set: JoinSet<WatchResult> = JoinSet::new();

    // Local running counters (not derived from state) for scheduling decisions.
    let mut impl_running = 0usize;
    let mut verify_running = 0usize;
    let mut merge_running = 0usize;

    // Optional concurrent planner task. Spawned after each successful merge
    // to re-evaluate the goal. When None, the planner branch in select! is
    // disabled (the async block returns pending()).
    let mut planner_handle: Option<JoinHandle<Result<bool>>> = None;

    info!(
        "dispatch_all_tasks: caps = impl:{impl_cap}, verify:{verify_cap}, \
         merge:1, total:{concurrent_agents}"
    );

    loop {
        // -- Check for stop signal --
        if state.get_snapshot().await.status == PipelineStatus::Stopping {
            info!(
                "dispatch_all_tasks: stopping, aborting {} running tasks",
                join_set.len()
            );
            join_set.abort_all();
            return Ok(());
        }

        // -- Dispatch phase: fill slots up to concurrent_agents --
        loop {
            let total_running = impl_running + verify_running + merge_running;
            if total_running >= concurrent_agents {
                break;
            }

            let mut dispatched = false;

            // Priority 1: impl with cap
            if state.has_impl_tasks().await
                && impl_running < impl_cap
                && try_dispatch_impl(client, state, goal, cwd, &mut join_set).await
            {
                impl_running += 1;
                dispatched = true;
            }

            // Priority 2: verify with cap
            if !dispatched
                && state.has_verify_tasks().await
                && verify_running < verify_cap
                && try_dispatch_verify(client, state, goal, &mut join_set).await
            {
                verify_running += 1;
                dispatched = true;
            }

            // Priority 3: merge (hardcoded cap of 1 — never give extra slots)
            if !dispatched
                && state.has_merge_tasks().await
                && merge_running == 0
                && try_dispatch_merge(client, state, goal, cwd, &mut join_set).await
            {
                merge_running += 1;
                dispatched = true;
            }

            // Slot flowing fallback: if we couldn't dispatch with per-queue
            // caps, try without caps (merge still excluded — always capped at
            // 1) so idle slots can be used by whichever queue has work.
            if !dispatched
                && state.has_impl_tasks().await
                && try_dispatch_impl(client, state, goal, cwd, &mut join_set).await
            {
                impl_running += 1;
                dispatched = true;
            }
            if !dispatched
                && state.has_verify_tasks().await
                && try_dispatch_verify(client, state, goal, &mut join_set).await
            {
                verify_running += 1;
                dispatched = true;
            }

            if !dispatched {
                break;
            }
        }

        // -- Wait phase --
        if join_set.is_empty() && planner_handle.is_none() {
            // No running tasks, no planner, nothing to dispatch — all done.
            break;
        }

        // Wait for either a task watcher to complete or the planner to finish.
        // The async block for the planner branch returns pending() when
        // planner_handle is None, effectively disabling that branch.
        tokio::select! {
            biased;

            // Planner branch — prioritized so we can stop ASAP if goal is met.
            res = async {
                if let Some(handle) = planner_handle.as_mut() {
                    handle.await
                } else {
                    // Type must match JoinHandle<Result<bool>>::Output
                    std::future::pending::<
                        std::result::Result<Result<bool>, tokio::task::JoinError>,
                    >()
                    .await
                }
            } => {
                planner_handle = None;
                match res {
                    Ok(Ok(true)) => {
                        info!("planner declared goal complete during dispatch");
                        join_set.abort_all();
                        return Ok(());
                    }
                    Ok(Ok(false)) => {
                        info!("planner added tasks during dispatch, continuing");
                        // New tasks are in the impl queue — next dispatch
                        // phase will pick them up.
                    }
                    Ok(Err(e)) => {
                        let msg = format!("{e:#}");
                        error!("planner failed during dispatch: {msg}");
                        join_set.abort_all();
                        return Err(e);
                    }
                    Err(e) => {
                        let msg = format!("planner task join error: {e}");
                        error!("{msg}");
                        state.fail_pipeline(msg.clone()).await;
                        join_set.abort_all();
                        return Err(anyhow::anyhow!(msg));
                    }
                }
            }

            // Task watcher branch.
            result = join_set.join_next(), if !join_set.is_empty() => {
                match result {
                    Some(Ok((task_id, queue_type, result))) => {
                        let merge_completed = process_completion(
                            &task_id,
                            queue_type,
                            result,
                            state,
                            cwd,
                            &mut impl_running,
                            &mut verify_running,
                            &mut merge_running,
                        )
                        .await;

                        // After a successful merge, re-run the planner
                        // concurrently to check if the goal is met.
                        if merge_completed && planner_handle.is_none() {
                            info!(
                                "merge completed, spawning planner to \
                                 re-evaluate goal"
                            );
                            let client_clone = client.clone();
                            let state_clone = state.clone();
                            let goal_clone = goal.to_string();
                            let cwd_clone = cwd.to_string();
                            planner_handle = Some(tokio::spawn(async move {
                                run_planner_and_process(
                                    &client_clone,
                                    &state_clone,
                                    &goal_clone,
                                    &cwd_clone,
                                    max_iterations,
                                )
                                .await
                            }));
                        }
                    }
                    Some(Err(e)) => {
                        warn!("task join error: {e}");
                    }
                    None => {
                        // join_next returned None — shouldn't happen since
                        // we guard with !join_set.is_empty(), but handle it.
                    }
                }
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Completion processing
// ---------------------------------------------------------------------------

/// Process a completed watcher task: update state, clean up resources, and
/// decrement the appropriate running counter.
///
/// Returns `true` if a merge task completed successfully (RunCompleted),
/// signaling the caller that the planner should be re-spawned to re-evaluate
/// the goal. Returns `false` for all other outcomes.
#[allow(clippy::too_many_arguments)]
async fn process_completion(
    task_id: &str,
    queue_type: QueueType,
    result: Result<SessionEvent>,
    state: &PipelineStateHandle,
    cwd: &str,
    impl_running: &mut usize,
    verify_running: &mut usize,
    merge_running: &mut usize,
) -> bool {
    match queue_type {
        QueueType::Implementation => {
            *impl_running = impl_running.saturating_sub(1);
            match result {
                Ok(SessionEvent::RunCompleted { response, .. }) => {
                    info!("impl task {task_id} completed");
                    state.complete_task(task_id, &response).await;
                }
                Ok(SessionEvent::RunFailed { message }) => {
                    warn!("impl task {task_id} failed: {message}");
                    state.fail_task(task_id, &message).await;
                }
                Ok(_) => unreachable!(),
                Err(e) => {
                    let msg = format!("watcher error: {e}");
                    warn!("impl task {task_id}: {msg}");
                    state.fail_task(task_id, &msg).await;
                }
            }
            false
        }
        QueueType::Verification => {
            *verify_running = verify_running.saturating_sub(1);
            match result {
                Ok(SessionEvent::RunCompleted { response, .. }) => {
                    info!("verify task {task_id} completed");
                    state.complete_task(task_id, &response).await;
                }
                Ok(SessionEvent::RunFailed { message }) => {
                    warn!("verify task {task_id} failed: {message}");
                    state.fail_task(task_id, &message).await;
                }
                Ok(_) => unreachable!(),
                Err(e) => {
                    let msg = format!("watcher error: {e}");
                    warn!("verify task {task_id}: {msg}");
                    state.fail_task(task_id, &msg).await;
                }
            }
            false
        }
        QueueType::Merge => {
            *merge_running = merge_running.saturating_sub(1);
            match result {
                Ok(SessionEvent::RunCompleted { response, .. }) => {
                    info!("merge task {task_id} completed");
                    state.set_merge_completed(task_id).await;

                    // Clean up the worktree associated with this task.
                    let snapshot = state.get_snapshot().await;
                    if let Some(task) = snapshot.all_tasks.get(task_id) {
                        if let (Some(wt), Some(br)) =
                            (&task.worktree_path, &task.branch_name)
                        {
                            if let Err(e) =
                                git::remove_worktree(Path::new(cwd), Path::new(wt), br)
                            {
                                warn!(
                                    "failed to clean up worktree for task {task_id}: {e}"
                                );
                            }
                        }
                    }

                    state.complete_task(task_id, &response).await;
                    true // merge completed successfully — trigger planner re-run
                }
                Ok(SessionEvent::RunFailed { message }) => {
                    warn!("merge task {task_id} failed: {message}");
                    state.set_merge_failed(task_id, &message).await;
                    false
                }
                Ok(_) => unreachable!(),
                Err(e) => {
                    let msg = format!("watcher error: {e}");
                    warn!("merge task {task_id}: {msg}");
                    state.set_merge_failed(task_id, &msg).await;
                    false
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Per-queue dispatch helpers
// ---------------------------------------------------------------------------

/// Try to dispatch a single implementation task.
///
/// Pops the next queued impl task, creates a git worktree (or reuses the
/// existing one for verify-retries), creates a nac session with a smolvm
/// sandbox, submits the impl prompt, and spawns a watcher into the JoinSet.
///
/// Returns `true` if a task was dispatched, `false` if no task was available
/// or dispatch failed (the task is marked as failed in that case).
async fn try_dispatch_impl(
    client: &NacWebClient,
    state: &PipelineStateHandle,
    goal: &str,
    cwd: &str,
    join_set: &mut JoinSet<WatchResult>,
) -> bool {
    let task = match state.pop_next_impl_task().await {
        Some(t) => t,
        None => return false,
    };

    // Create worktree if not already set (retry from verify keeps worktree).
    let (worktree_path, branch_name) =
        if let (Some(wt), Some(br)) = (&task.worktree_path, &task.branch_name) {
            (std::path::PathBuf::from(wt), br.clone())
        } else {
            let branch = git::make_branch_name(&task.id);
            match git::create_worktree(Path::new(cwd), &branch) {
                Ok(path) => (path, branch),
                Err(e) => {
                    let msg = format!("worktree creation failed: {e}");
                    error!("task {}: {msg}", task.id);
                    state.fail_task(&task.id, &msg).await;
                    return false;
                }
            }
        };

    let worktree_str = worktree_path.to_string_lossy().to_string();

    // Create nac session with smolvm sandbox.
    let sandbox = SandboxConfig {
        enabled: true,
        backend: Some("smolvm".to_string()),
        workdir: Some(worktree_str.clone()),
        mounts: vec![],
        mounts_ro: vec![],
    };

    let session_id = match client.create_session(&worktree_str, Some(sandbox)).await {
        Ok(id) => id,
        Err(e) => {
            let msg = format!("session creation failed: {e}");
            error!("task {}: {msg}", task.id);
            state.fail_task(&task.id, &msg).await;
            return false;
        }
    };

    // Update task metadata and emit TaskStarted.
    state
        .set_task_started(&task.id, &session_id, Some(&worktree_str), Some(&branch_name))
        .await;

    // Submit implementation prompt.
    let prompt = build_impl_prompt(
        goal,
        &task.title,
        &task.description,
        task.retry_count,
        task.failure_notes.as_deref(),
        &branch_name,
    );

    if let Err(e) = client.submit_prompt(&session_id, &prompt).await {
        let msg = format!("prompt submission failed: {e}");
        error!("task {}: {msg}", task.id);
        state.fail_task(&task.id, &msg).await;
        if let Err(e) = client.delete_session(&session_id).await {
            warn!("failed to delete session {session_id}: {e}");
        }
        return false;
    }

    info!(
        "dispatched impl task {} to session {} (worktree: {})",
        task.id, session_id, worktree_str
    );

    // Spawn watcher task.
    let client_clone = client.clone();
    let task_id = task.id.clone();
    join_set.spawn(async move {
        let result = watch_session_to_completion(&client_clone, &session_id).await;
        // Clean up session regardless of outcome.
        if let Err(e) = client_clone.delete_session(&session_id).await {
            warn!("failed to delete session {session_id}: {e}");
        }
        (task_id, QueueType::Implementation, result)
    });

    true
}

/// Try to dispatch a single verification task.
///
/// Pops the next queued verify task, reuses the existing worktree from the
/// implementation phase, creates a nac session with a smolvm sandbox,
/// submits the verify prompt, and spawns a watcher into the JoinSet.
///
/// Returns `true` if a task was dispatched, `false` if no task was available
/// or dispatch failed (the task is marked as failed in that case).
async fn try_dispatch_verify(
    client: &NacWebClient,
    state: &PipelineStateHandle,
    goal: &str,
    join_set: &mut JoinSet<WatchResult>,
) -> bool {
    let task = match state.pop_next_verify_task().await {
        Some(t) => t,
        None => return false,
    };

    // Use existing worktree from impl phase.
    let worktree_str = match &task.worktree_path {
        Some(wt) => wt.clone(),
        None => {
            let msg = "verify task has no worktree_path";
            error!("task {}: {msg}", task.id);
            state.fail_task(&task.id, msg).await;
            return false;
        }
    };

    // Create nac session on the same worktree with sandbox.
    let sandbox = SandboxConfig {
        enabled: true,
        backend: Some("smolvm".to_string()),
        workdir: Some(worktree_str.clone()),
        mounts: vec![],
        mounts_ro: vec![],
    };

    let session_id = match client.create_session(&worktree_str, Some(sandbox)).await {
        Ok(id) => id,
        Err(e) => {
            let msg = format!("session creation failed: {e}");
            error!("verify task {}: {msg}", task.id);
            state.fail_task(&task.id, &msg).await;
            return false;
        }
    };

    state.set_task_started(&task.id, &session_id, None, None).await;

    // Submit verification prompt.
    let prompt = build_verify_prompt(goal, &task.title, &task.description);
    if let Err(e) = client.submit_prompt(&session_id, &prompt).await {
        let msg = format!("prompt submission failed: {e}");
        error!("verify task {}: {msg}", task.id);
        state.fail_task(&task.id, &msg).await;
        if let Err(e) = client.delete_session(&session_id).await {
            warn!("failed to delete session {session_id}: {e}");
        }
        return false;
    }

    info!(
        "dispatched verify task {} to session {}",
        task.id, session_id
    );

    let client_clone = client.clone();
    let task_id = task.id.clone();
    join_set.spawn(async move {
        let result = watch_session_to_completion(&client_clone, &session_id).await;
        if let Err(e) = client_clone.delete_session(&session_id).await {
            warn!("failed to delete session {session_id}: {e}");
        }
        (task_id, QueueType::Verification, result)
    });

    true
}

/// Try to dispatch a single merge task.
///
/// Pops the next queued merge task, creates a nac session on the main repo
/// (no sandbox), submits the merge prompt, and spawns a watcher into the
/// JoinSet. Worktree cleanup happens when the merge completes (in
/// `process_completion`).
///
/// Returns `true` if a task was dispatched, `false` if no task was available
/// or dispatch failed (the task is marked as failed in that case).
async fn try_dispatch_merge(
    client: &NacWebClient,
    state: &PipelineStateHandle,
    goal: &str,
    cwd: &str,
    join_set: &mut JoinSet<WatchResult>,
) -> bool {
    let task = match state.pop_next_merge_task().await {
        Some(t) => t,
        None => return false,
    };

    // Create nac session on main repo (no sandbox — needs git access).
    let session_id = match client.create_session(cwd, None).await {
        Ok(id) => id,
        Err(e) => {
            let msg = format!("session creation failed: {e}");
            error!("merge task {}: {msg}", task.id);
            state.set_merge_failed(&task.id, &msg).await;
            return false;
        }
    };

    state
        .set_merge_started(task.id.clone(), session_id.clone())
        .await;

    // Submit merge prompt.
    let branch_name = task.branch_name.clone().unwrap_or_default();
    let prompt = build_merge_prompt(goal, &task.title, &task.description, &branch_name);
    if let Err(e) = client.submit_prompt(&session_id, &prompt).await {
        let msg = format!("prompt submission failed: {e}");
        error!("merge task {}: {msg}", task.id);
        state.set_merge_failed(&task.id, &msg).await;
        if let Err(e) = client.delete_session(&session_id).await {
            warn!("failed to delete session {session_id}: {e}");
        }
        return false;
    }

    info!(
        "dispatched merge task {} to session {}",
        task.id, session_id
    );

    let client_clone = client.clone();
    let task_id = task.id.clone();
    join_set.spawn(async move {
        let result = watch_session_to_completion(&client_clone, &session_id).await;
        if let Err(e) = client_clone.delete_session(&session_id).await {
            warn!("failed to delete session {session_id}: {e}");
        }
        (task_id, QueueType::Merge, result)
    });

    true
}

// ---------------------------------------------------------------------------
// SSE watching helper
// ---------------------------------------------------------------------------

/// Watch a session's SSE stream until a `RunCompleted` or `RunFailed` event
/// arrives.
///
/// Opens the SSE stream, iterates over events, and returns the first
/// `RunCompleted` or `RunFailed` `SessionEvent`. Other event types
/// (`RunStarted`, `Agent`, `SnapshotSaved`, `replay_gap`, `lagged`) are
/// ignored.
async fn watch_session_to_completion(
    client: &NacWebClient,
    session_id: &str,
) -> Result<SessionEvent> {
    let response = client
        .stream_events(session_id, None)
        .await
        .with_context(|| format!("failed to open SSE stream for session {session_id}"))?;

    let mut sse = SseStream::from_response(response);

    loop {
        match sse.next_event().await? {
            Some(event) => {
                if event.event == "session_event" {
                    let envelope = event
                        .parse_envelope()
                        .with_context(|| format!("failed to parse SSE envelope for {session_id}"))?;
                    match envelope.event {
                        SessionEvent::RunCompleted { .. } => return Ok(envelope.event),
                        SessionEvent::RunFailed { .. } => return Ok(envelope.event),
                        _ => continue,
                    }
                }
                // Non-session_event SSE events (replay_gap, lagged, comments) — ignore.
            }
            None => {
                return Err(anyhow::anyhow!(
                    "SSE stream for session {session_id} closed without RunCompleted or RunFailed"
                ));
            }
        }
    }
}

// ---------------------------------------------------------------------------
// JSON extraction helper
// ---------------------------------------------------------------------------

/// Extract a JSON object from a text response that may contain surrounding
/// text or markdown code fences.
///
/// Tries a direct parse first, then falls back to finding the first `{` and
/// last `}` in the text.
fn extract_json(text: &str) -> Result<serde_json::Value> {
    let trimmed = text.trim();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Ok(v);
    }

    let start = trimmed
        .find('{')
        .ok_or_else(|| anyhow::anyhow!("no JSON object found in planner response"))?;
    let end = trimmed
        .rfind('}')
        .ok_or_else(|| anyhow::anyhow!("no closing brace found in planner response"))?;

    let json_str = &trimmed[start..=end];
    serde_json::from_str(json_str)
        .with_context(|| format!("failed to parse extracted JSON: {json_str}"))
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

fn build_planner_prompt(goal: &str) -> String {
    format!(
        r#"You are a planning agent for an autonomous coding pipeline. Your job is to assess whether a goal has been met in this repository and, if not, break the remaining work into implementation tasks.

## Goal
{goal}

## Your instructions
1. Explore the repository thoroughly. Read key files, check tests, understand the current state.
2. Judge whether the goal has been FULLY met. Be very critical and thorough — only declare success if the goal is genuinely complete.
3. If the goal is met, respond with EXACTLY this JSON:
{{"status": "complete", "summary": "Brief explanation of why the goal is met"}}

4. If the goal is NOT met, respond with EXACTLY this JSON:
{{"status": "incomplete", "tasks": [{{"title": "Short task title", "description": "Detailed description of what needs to be done"}}]}}

The tasks should be concrete, actionable implementation tasks. Each task should be small enough for a single agent to complete in one session. Do not include verification or merge tasks — only implementation tasks. All tasks you output will be worked on in parallel by multiple agents, so each task should be self-contained and not depend on other tasks in this batch.

Respond with ONLY the JSON. No markdown, no explanation, no code blocks. Just the raw JSON."#
    )
}

fn build_impl_prompt(
    goal: &str,
    title: &str,
    description: &str,
    retry_count: u32,
    failure_notes: Option<&str>,
    branch_name: &str,
) -> String {
    let failure_section = if retry_count > 0 {
        if let Some(notes) = failure_notes {
            format!(
                "\n## Previous Attempt Feedback\nThis is retry #{retry_count}. The previous attempt failed verification with this feedback:\n{notes}\n"
            )
        } else {
            format!(
                "\n## Previous Attempt Feedback\nThis is retry #{retry_count}. The previous attempt failed verification.\n"
            )
        }
    } else {
        String::new()
    };

    format!(
        r#"You are an implementation agent working on a specific task in a git worktree.

## Goal Context
{goal}

## Your Task
Title: {title}
Description: {description}
{failure_section}
## Your instructions
1. Explore the repository to understand the codebase.
2. Implement the task described above.
3. Make sure your changes are complete and the code compiles/tests pass if applicable.
4. Commit your changes with a clear commit message.

Work in the current directory — it is a git worktree on branch {branch_name}. Your changes will be reviewed and merged after verification."#
    )
}

fn build_verify_prompt(goal: &str, title: &str, description: &str) -> String {
    format!(
        r#"You are a verification agent. Your job is to verify that a task was implemented correctly and fix any bugs you find.

## Goal Context
{goal}

## Task Being Verified
Title: {title}
Description: {description}

## Your instructions
1. Review the changes made in this worktree (git diff, git log).
2. Verify the implementation is correct — check logic, run tests, look for edge cases.
3. If you find bugs or issues, FIX THEM directly in this worktree.
4. If everything is correct, commit any fixes and respond with a summary of what you verified.
5. If you cannot fix a critical issue, describe the problem clearly in your response.

You are working in the same worktree where the implementation was done. All changes here will be merged to main after verification."#
    )
}

fn build_merge_prompt(goal: &str, title: &str, description: &str, branch_name: &str) -> String {
    format!(
        r#"You are a merge agent. Your job is to merge a feature branch into main.

## Goal Context
{goal}

## Task Being Merged
Title: {title}
Description: {description}

## Branch to merge
{branch_name}

## Your instructions
This is a local git merge operation. All work is happening on the local filesystem — there are no remote repositories involved.
1. Merge branch {branch_name} into the current branch (main).
2. If there are merge conflicts, resolve them carefully. Understand both sides of the conflict and choose the correct resolution.
3. Make sure the merged code compiles and tests pass.
4. Commit the merge.

Use git commands to perform the merge. The current directory is the main repository on the main branch."#
    )
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/// Clean up all pipeline-managed worktrees.
fn cleanup_resources(cwd: &str) {
    info!("cleaning up pipeline resources");
    if let Err(e) = git::cleanup_all_worktrees(Path::new(cwd)) {
        warn!("cleanup: failed to remove worktrees: {e}");
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_json_direct() {
        let json = extract_json(r#"{"status": "complete", "summary": "done"}"#).unwrap();
        assert_eq!(json["status"], "complete");
        assert_eq!(json["summary"], "done");
    }

    #[test]
    fn test_extract_json_with_surrounding_text() {
        let json =
            extract_json(r#"Here is the result: {"status": "incomplete", "tasks": []} That's it."#)
                .unwrap();
        assert_eq!(json["status"], "incomplete");
        assert!(json["tasks"].is_array());
    }

    #[test]
    fn test_extract_json_with_code_block() {
        let json = extract_json(
            r#"```json
{"status": "complete", "summary": "all good"}
```"#,
        )
        .unwrap();
        assert_eq!(json["status"], "complete");
    }

    #[test]
    fn test_extract_json_no_json() {
        let result = extract_json("no json here");
        assert!(result.is_err());
    }

    #[test]
    fn test_calculate_caps() {
        assert_eq!(calculate_caps(0), (0, 0, 1));
        assert_eq!(calculate_caps(1), (1, 0, 1));
        assert_eq!(calculate_caps(2), (1, 1, 1));
        assert_eq!(calculate_caps(3), (1, 1, 1));
        assert_eq!(calculate_caps(4), (2, 1, 1));
        assert_eq!(calculate_caps(5), (2, 2, 1));
        assert_eq!(calculate_caps(6), (2, 2, 1));
        assert_eq!(calculate_caps(7), (3, 2, 1));
        assert_eq!(calculate_caps(9), (3, 3, 1));
    }

    #[test]
    fn test_build_planner_prompt() {
        let prompt = build_planner_prompt("build a web app");
        assert!(prompt.contains("build a web app"));
        assert!(prompt.contains(r#""status": "complete""#));
        assert!(prompt.contains(r#""status": "incomplete""#));
        assert!(prompt.contains("worked on in parallel"));
        assert!(prompt.contains("self-contained"));
    }

    #[test]
    fn test_build_impl_prompt_no_retry() {
        let prompt = build_impl_prompt("goal", "title", "desc", 0, None, "branch-1");
        assert!(prompt.contains("title"));
        assert!(prompt.contains("desc"));
        assert!(prompt.contains("branch-1"));
        assert!(!prompt.contains("retry"));
    }

    #[test]
    fn test_build_impl_prompt_with_retry() {
        let prompt = build_impl_prompt("goal", "title", "desc", 2, Some("tests failed"), "branch-1");
        assert!(prompt.contains("retry #2"));
        assert!(prompt.contains("tests failed"));
    }

    #[test]
    fn test_build_verify_prompt() {
        let prompt = build_verify_prompt("goal", "title", "desc");
        assert!(prompt.contains("verification agent"));
        assert!(prompt.contains("title"));
    }

    #[test]
    fn test_build_merge_prompt() {
        let prompt = build_merge_prompt("goal", "title", "desc", "feature-branch");
        assert!(prompt.contains("merge agent"));
        assert!(prompt.contains("feature-branch"));
        assert!(prompt.contains("local git merge"));
        assert!(prompt.contains("no remote repositories"));
    }
}