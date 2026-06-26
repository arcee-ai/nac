//! Pipeline orchestrator — the core async loop that drives the nac-queue.
//!
//! [`run_pipeline`] is the main entry point, spawned as a tokio task by the
//! `/launch` API handler. It runs the planner → impl → verify → merge loop
//! until the goal is met, the pipeline fails, or the user stops it.

use std::path::Path;

use anyhow::{Context, Result};
use tokio::task::JoinSet;
use tracing::{error, info, warn};

use crate::git;
use crate::nac_client::{NacWebClient, SandboxConfig, SessionEvent, SseStream};
use crate::state::PipelineStateHandle;
use crate::types::{PipelineStatus, PlannerResult};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Main entry point for the pipeline orchestration loop.
///
/// Spawned as a tokio task by the `/launch` handler. Runs the planner →
/// impl → verify → merge loop until the goal is met, the pipeline fails,
/// or the user stops it.
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

    for iteration in 0..max_iterations {
        // -- Check for stop signal --
        if state.get_snapshot().await.status == PipelineStatus::Stopping {
            info!("pipeline stopping at iteration {iteration}");
            cleanup_resources(&cwd);
            return Ok(());
        }

        // -- Run planner --
        info!("iteration {iteration}: running planner");
        let planner_result = match run_planner(&client, &state, &goal, &cwd).await {
            Ok(result) => result,
            Err(e) => {
                let msg = format!("{e:#}");
                error!("planner failed: {msg}");
                state.set_planner_failed(msg.clone()).await;
                state.fail_pipeline(msg).await;
                cleanup_resources(&cwd);
                return Err(e);
            }
        };

        match planner_result {
            PlannerResult::Complete { summary } => {
                info!("planner declared goal complete: {summary}");
                state.complete_pipeline(summary).await;
                cleanup_resources(&cwd);
                return Ok(());
            }
            PlannerResult::Incomplete { tasks } => {
                info!("planner produced {} implementation tasks", tasks.len());
                state.add_tasks(tasks).await;
            }
        }

        // -- Dispatch implementation tasks --
        info!("iteration {iteration}: dispatching implementation tasks");
        if let Err(e) =
            dispatch_impl_tasks(&client, &state, &goal, &cwd, concurrent_agents).await
        {
            let msg = format!("{e:#}");
            error!("implementation phase failed: {msg}");
            state.fail_pipeline(msg).await;
            cleanup_resources(&cwd);
            return Err(e);
        }

        if state.get_snapshot().await.status == PipelineStatus::Stopping {
            info!("pipeline stopping after implementation phase");
            cleanup_resources(&cwd);
            return Ok(());
        }

        // -- Dispatch verification tasks --
        info!("iteration {iteration}: dispatching verification tasks");
        if let Err(e) = dispatch_verify_tasks(&client, &state, &goal).await {
            let msg = format!("{e:#}");
            error!("verification phase failed: {msg}");
            state.fail_pipeline(msg).await;
            cleanup_resources(&cwd);
            return Err(e);
        }

        if state.get_snapshot().await.status == PipelineStatus::Stopping {
            info!("pipeline stopping after verification phase");
            cleanup_resources(&cwd);
            return Ok(());
        }

        // -- Dispatch merge tasks --
        info!("iteration {iteration}: dispatching merge tasks");
        if let Err(e) = dispatch_merge_tasks(&client, &state, &goal, &cwd).await {
            let msg = format!("{e:#}");
            error!("merge phase failed: {msg}");
            state.fail_pipeline(msg).await;
            cleanup_resources(&cwd);
            return Err(e);
        }

        info!("iteration {iteration} complete, looping back to planner");
    }

    // Exceeded max iterations
    let msg = format!("pipeline exceeded max_iterations ({max_iterations})");
    error!("{msg}");
    state.fail_pipeline(msg.clone()).await;
    cleanup_resources(&cwd);
    Err(anyhow::anyhow!(msg))
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
// Implementation phase (concurrent, up to `concurrent_agents`)
// ---------------------------------------------------------------------------

/// Dispatch all queued implementation tasks concurrently (up to
/// `concurrent_agents` at a time). Each task gets its own git worktree
/// and nac-web session with a smolvm sandbox.
async fn dispatch_impl_tasks(
    client: &NacWebClient,
    state: &PipelineStateHandle,
    goal: &str,
    cwd: &str,
    concurrent_agents: usize,
) -> Result<()> {
    /// Return type for spawned watcher tasks: (task_id, result).
    type WatchResult = (String, Result<SessionEvent>);

    let mut join_set: JoinSet<WatchResult> = JoinSet::new();

    loop {
        // Check for stop signal.
        if state.get_snapshot().await.status == PipelineStatus::Stopping {
            join_set.abort_all();
            return Ok(());
        }

        // Fill up to concurrent_agents.
        while state.active_impl_count().await < concurrent_agents
            && state.has_impl_tasks().await
        {
            let task = match state.pop_next_impl_task().await {
                Some(t) => t,
                None => break,
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
                            continue;
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
                    continue;
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
                continue;
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
                (task_id, result)
            });
        }

        // If no spawned tasks and no queued tasks, we're done.
        if join_set.is_empty() {
            break;
        }

        // Wait for at least one task to complete.
        match join_set.join_next().await {
            Some(Ok((task_id, Ok(event)))) => match event {
                SessionEvent::RunCompleted { response, .. } => {
                    info!("impl task {} completed", task_id);
                    state.complete_task(&task_id, &response).await;
                }
                SessionEvent::RunFailed { message } => {
                    warn!("impl task {} failed: {message}", task_id);
                    state.fail_task(&task_id, &message).await;
                }
                _ => unreachable!(),
            },
            Some(Ok((task_id, Err(e)))) => {
                let msg = format!("watcher error: {e}");
                warn!("impl task {}: {msg}", task_id);
                state.fail_task(&task_id, &msg).await;
            }
            Some(Err(e)) => {
                warn!("impl task join error: {e}");
            }
            None => break,
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Verification phase (concurrent — each task has its own worktree)
// ---------------------------------------------------------------------------

/// Dispatch all queued verification tasks concurrently. Each task reuses
/// the worktree from the implementation phase. The nac session is created
/// on the same worktree with a smolvm sandbox.
async fn dispatch_verify_tasks(
    client: &NacWebClient,
    state: &PipelineStateHandle,
    goal: &str,
) -> Result<()> {
    type WatchResult = (String, Result<SessionEvent>);

    let mut join_set: JoinSet<WatchResult> = JoinSet::new();

    loop {
        // Check for stop signal.
        if state.get_snapshot().await.status == PipelineStatus::Stopping {
            join_set.abort_all();
            return Ok(());
        }

        // Dispatch all queued verify tasks concurrently.
        while state.has_verify_tasks().await {
            let task = match state.pop_next_verify_task().await {
                Some(t) => t,
                None => break,
            };

            // Use existing worktree from impl phase.
            let worktree_str = match &task.worktree_path {
                Some(wt) => wt.clone(),
                None => {
                    let msg = "verify task has no worktree_path";
                    error!("task {}: {msg}", task.id);
                    state.fail_task(&task.id, msg).await;
                    continue;
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
                    continue;
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
                continue;
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
                (task_id, result)
            });
        }

        if join_set.is_empty() {
            break;
        }

        match join_set.join_next().await {
            Some(Ok((task_id, Ok(event)))) => match event {
                SessionEvent::RunCompleted { response, .. } => {
                    info!("verify task {} completed", task_id);
                    state.complete_task(&task_id, &response).await;
                }
                SessionEvent::RunFailed { message } => {
                    warn!("verify task {} failed: {message}", task_id);
                    state.fail_task(&task_id, &message).await;
                }
                _ => unreachable!(),
            },
            Some(Ok((task_id, Err(e)))) => {
                let msg = format!("watcher error: {e}");
                warn!("verify task {}: {msg}", task_id);
                state.fail_task(&task_id, &msg).await;
            }
            Some(Err(e)) => {
                warn!("verify task join error: {e}");
            }
            None => break,
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Merge phase (serialized — one at a time)
// ---------------------------------------------------------------------------

/// Dispatch merge tasks one at a time. Each merge session runs on the
/// main repo (not a worktree). On success, the worktree is cleaned up.
async fn dispatch_merge_tasks(
    client: &NacWebClient,
    state: &PipelineStateHandle,
    goal: &str,
    cwd: &str,
) -> Result<()> {
    while state.can_start_merge().await {
        // Check for stop signal.
        if state.get_snapshot().await.status == PipelineStatus::Stopping {
            return Ok(());
        }

        let task = match state.pop_next_merge_task().await {
            Some(t) => t,
            None => break,
        };

        // Create nac session on main repo (no sandbox — needs git access).
        let session_id = match client.create_session(cwd, None).await {
            Ok(id) => id,
            Err(e) => {
                let msg = format!("session creation failed: {e}");
                error!("merge task {}: {msg}", task.id);
                state.set_merge_failed(&task.id, &msg).await;
                continue;
            }
        };

        state
            .set_merge_started(task.id.clone(), session_id.clone())
            .await;
        info!(
            "dispatched merge task {} to session {}",
            task.id, session_id
        );

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
            continue;
        }

        // Watch for completion (blocking — one merge at a time).
        let watch_result = watch_session_to_completion(client, &session_id).await;

        // Clean up session.
        if let Err(e) = client.delete_session(&session_id).await {
            warn!("failed to delete merge session {session_id}: {e}");
        }

        match watch_result {
            Ok(SessionEvent::RunCompleted { response, .. }) => {
                info!("merge task {} completed", task.id);
                state.set_merge_completed(&task.id).await;

                // Clean up worktree.
                if let Some(wt) = &task.worktree_path {
                    if let Err(e) =
                        git::remove_worktree(Path::new(cwd), Path::new(wt), &branch_name)
                    {
                        warn!(
                            "failed to clean up worktree for task {}: {e}",
                            task.id
                        );
                    }
                }

                state.complete_task(&task.id, &response).await;
            }
            Ok(SessionEvent::RunFailed { message }) => {
                warn!("merge task {} failed: {message}", task.id);
                state.set_merge_failed(&task.id, &message).await;
            }
            Err(e) => {
                let msg = format!("watcher error: {e}");
                warn!("merge task {}: {msg}", task.id);
                state.set_merge_failed(&task.id, &msg).await;
            }
            _ => unreachable!(),
        }
    }

    Ok(())
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

The tasks should be concrete, actionable implementation tasks. Each task should be small enough for a single agent to complete in one session. Do not include verification or merge tasks — only implementation tasks.

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
    fn test_build_planner_prompt() {
        let prompt = build_planner_prompt("build a web app");
        assert!(prompt.contains("build a web app"));
        assert!(prompt.contains(r#""status": "complete""#));
        assert!(prompt.contains(r#""status": "incomplete""#));
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
    }
}