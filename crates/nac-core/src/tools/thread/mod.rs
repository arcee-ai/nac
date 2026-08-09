use std::collections::HashSet;
use std::time::Duration;

use serde_json::Value;

use crate::events::{AgentEvent, SessionRunId};
use crate::model::ModelClient;
use crate::skills::SkillRegistry;
use crate::store;
use crate::tools::{
    ThreadCompletion, ThreadDispatchKey, ToolResult, ToolRuntime, require_str, require_string_array,
};
use crate::types::ToolDefinition;

mod worker;
#[cfg(test)]
pub(crate) use worker::worker_model_arguments_for_test;
use worker::{WorkerInvocation, run_worker};

pub const DEFAULT_THREAD_TIMEOUT_SECS: u64 = 60 * 60;
pub const MIN_THREAD_TIMEOUT_SECS: u64 = 30 * 60;

pub fn dispatch_definition(skills: Option<&SkillRegistry>) -> ToolDefinition {
    use serde_json::json;

    let mut parameters = json!({
        "type": "object",
        "properties": {
            "name": { "type": "string", "description": "Thread name. Creates if new, reuses if existing." },
            "action": { "type": "string", "description": "Task for the worker." },
            "threads": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Other thread names whose latest retained episodes should be loaded."
            },
            "timeout": { "type": "integer", "description": "Timeout in seconds for this dispatch (default 3600, minimum 1800)." }
        },
        "required": ["name", "action"]
    });

    if let Some(registry) = skills {
        let catalog = registry.catalog_entries();
        if !catalog.is_empty() {
            let names: Vec<String> = catalog.iter().map(|entry| entry.name.clone()).collect();
            let mut description = String::from(
                "Worker skill names to preload before this dispatch. Pass skills when the task clearly matches them; workers cannot activate skills themselves. Compact catalog:",
            );
            for entry in &catalog {
                description.push_str(&format!("\n- {}: {}", entry.name, entry.description));
                if let Some(compatibility) = &entry.compatibility {
                    description.push_str(&format!(" (compatibility: {})", compatibility));
                }
            }

            parameters["properties"]["skills"] = json!({
                "type": "array",
                "items": { "type": "string", "enum": names },
                "uniqueItems": true,
                "description": description
            });
        }
    }

    def(
        "thread",
        "Dispatch a named worker thread. The worker reuses its own retained history and can pull the latest retained episode from other named threads. Default timeout is configured by nac; built-in default is 3600 seconds and minimum timeout is 1800 seconds.",
        parameters,
    )
}

pub fn threads_definition() -> ToolDefinition {
    use serde_json::json;
    def(
        "threads",
        "List active threads in the current orchestrator session.",
        json!({
            "type": "object",
            "properties": {}
        }),
    )
}

pub fn thread_read_definition() -> ToolDefinition {
    use serde_json::json;
    def(
        "thread_read",
        "Read the full retained episode history for one thread.",
        json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "Thread name." }
            },
            "required": ["name"]
        }),
    )
}

pub fn thread_wait_definition() -> ToolDefinition {
    use serde_json::json;
    def(
        "thread_wait",
        "Explicitly wait for eligible session background completions or user input. Results retain their originating run and dispatch identity.",
        json!({
            "type": "object",
            "properties": {
                "names": {
                    "type": "array",
                    "items": { "type": "string" },
                    "uniqueItems": true,
                    "description": "Optional thread-name compatibility selectors."
                },
                "dispatch_ids": {
                    "type": "array",
                    "items": { "type": "string" },
                    "uniqueItems": true,
                    "description": "Optional exact dispatch identities to wait for."
                },
                "timeout": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "Maximum wait in seconds. Defaults to the configured thread timeout."
                }
            }
        }),
    )
}

pub fn thread_cancel_definition() -> ToolDefinition {
    use serde_json::json;
    def(
        "thread_cancel",
        "Cancel one exact active dispatch. Identity is never inferred from a thread name.",
        json!({
            "type": "object",
            "properties": {
                "origin_run_id": { "type": "string" },
                "name": { "type": "string" },
                "dispatch_id": { "type": "string" },
                "originating_tool_call_id": { "type": "string" },
                "wait_ms": { "type": "integer", "minimum": 0, "maximum": 30000 }
            },
            "required": ["origin_run_id", "name", "dispatch_id", "originating_tool_call_id"]
        }),
    )
}

pub fn thread_delete_definition() -> ToolDefinition {
    use serde_json::json;
    def(
        "thread_delete",
        "Delete one thread and all its retained episodes.",
        json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "Thread name." }
            },
            "required": ["name"]
        }),
    )
}

#[derive(Debug, Clone)]
pub struct ParsedDispatchParams {
    pub thread_name: String,
    pub dispatch_id: String,
    pub action: String,
    pub source_threads: Vec<String>,
    pub scheduled_skills: Vec<String>,
    pub session_id: String,
    pub timeout_secs: u64,
}

/// Parse tool args into [`ParsedDispatchParams`].  Pure — no side effects.
pub fn parse_dispatch_args(
    args: &Value,
    runtime: &ToolRuntime,
) -> Result<ParsedDispatchParams, ToolResult> {
    let thread_name = require_str(args, "name")?;
    let action = require_str(args, "action")?;
    let source_threads = require_string_array(args, "threads")?;
    let scheduled_skills = resolve_scheduled_skills(args, runtime.skills.as_deref())?;
    let session_id = require_session(runtime)?.to_string();
    let timeout_secs = resolve_thread_timeout_secs(args, runtime.thread_timeout_secs);

    Ok(ParsedDispatchParams {
        thread_name,
        dispatch_id: uuid::Uuid::new_v4().to_string(),
        action,
        source_threads,
        scheduled_skills,
        session_id,
        timeout_secs,
    })
}

/// Execute a dispatch from already-parsed params.  Emits `ThreadStarted`,
/// calls `run_worker`, folds worker usage, and maps the `WorkerRun` to a
/// `ToolResult`. The caller registers the dispatch before this function;
/// completion closes that exact identity and expires unresolved steering.
pub async fn execute_parsed_dispatch(
    params: ParsedDispatchParams,
    dispatch_key: Option<&crate::tools::ThreadDispatchKey>,
    runtime: &ToolRuntime,
    client: &ModelClient,
) -> ToolResult {
    let ParsedDispatchParams {
        thread_name,
        dispatch_id,
        action,
        source_threads,
        scheduled_skills,
        session_id,
        timeout_secs,
    } = params;

    runtime.event_sink.emit(AgentEvent::ThreadStarted {
        name: thread_name.clone(),
        action: action.clone(),
        source_threads: source_threads.clone(),
        run_id: dispatch_key.map(|key| key.run_id.clone()),
        dispatch_id: dispatch_key.map(|key| key.dispatch_id.clone()),
        tool_call_id: dispatch_key.map(|key| key.tool_call_id.clone()),
        status: dispatch_key.map(|_| crate::events::ThreadDispatchStatus::Running),
    });

    let cancellation = dispatch_key
        .and_then(|key| runtime.active_threads.cancellation(key))
        .unwrap_or_default();
    let origin_run_id = dispatch_key
        .map(|key| key.run_id.clone())
        .or_else(|| runtime.event_sink.run_id().cloned())
        .unwrap_or_else(|| SessionRunId::from_string("foreground-compat".to_string()));
    let result = run_worker(
        runtime,
        client,
        WorkerInvocation {
            session_id: &session_id,
            thread_name: &thread_name,
            dispatch_id: &dispatch_id,
            action: &action,
            source_threads: &source_threads,
            scheduled_skills: &scheduled_skills,
            timeout_secs,
            cancellation: &cancellation,
            origin_run_id: Some(&origin_run_id),
            dispatch_key,
        },
    )
    .await;

    let (tool_result, exit_code, timed_out, timeout_reason, usage, status, process_owner) =
        match result {
            Err(error) => {
                runtime.event_sink.emit(AgentEvent::Error {
                    thread_name: Some(thread_name.clone()),
                    message: format!("Failed to spawn thread '{}': {}", thread_name, error),
                });
                (
                    ToolResult {
                        content: format!("Failed to spawn thread '{}': {}", thread_name, error),
                        is_error: true,
                    },
                    -1,
                    false,
                    None,
                    None,
                    crate::events::ThreadDispatchStatus::Failed,
                    None,
                )
            }
            Ok(run) if run.cancelled => (
                ToolResult {
                    content: format!("Thread '{}' was cancelled.", thread_name),
                    is_error: true,
                },
                run.exit_code,
                false,
                None,
                run.usage,
                crate::events::ThreadDispatchStatus::Cancelled,
                Some((run.child, run.process_group)),
            ),
            Ok(run) if run.timed_out => {
                let reason = run.timeout_reason.clone();
                (
                    ToolResult {
                        content: match &reason {
                            Some(reason) => format!(
                                "Thread '{}' timed out after {}s.\n{}",
                                thread_name, timeout_secs, reason
                            ),
                            None => {
                                format!(
                                    "Thread '{}' timed out after {}s",
                                    thread_name, timeout_secs
                                )
                            }
                        },
                        is_error: true,
                    },
                    run.exit_code,
                    true,
                    reason,
                    run.usage,
                    crate::events::ThreadDispatchStatus::Failed,
                    Some((run.child, run.process_group)),
                )
            }
            Ok(run) if run.exit_code != 0 => {
                let details = if !run.stderr.trim().is_empty() {
                    run.stderr.trim().to_string()
                } else if !run.stdout.trim().is_empty() {
                    run.stdout.trim().to_string()
                } else {
                    "no output".to_string()
                };
                (
                    ToolResult {
                        content: format!(
                            "Thread '{}' failed (exit {}):\n{}",
                            thread_name, run.exit_code, details
                        ),
                        is_error: true,
                    },
                    run.exit_code,
                    false,
                    None,
                    run.usage,
                    crate::events::ThreadDispatchStatus::Failed,
                    Some((run.child, run.process_group)),
                )
            }
            Ok(run) => (
                ToolResult {
                    content: run.stdout.trim().to_string(),
                    is_error: false,
                },
                run.exit_code,
                false,
                None,
                run.usage,
                crate::events::ThreadDispatchStatus::Completed,
                Some((run.child, run.process_group)),
            ),
        };

    let mut resolved_result = tool_result;
    let mut resolved_status = status;
    if let Some(key) = dispatch_key {
        #[cfg(test)]
        runtime.active_threads.run_before_finalize_hook(key);
        if let Some(finalized) = finalize_thread_dispatch(
            runtime,
            &session_id,
            key.clone(),
            &resolved_result,
            status,
            exit_code,
            timed_out,
            timeout_reason,
            usage,
        ) {
            resolved_status = finalized.status;
            resolved_result = ToolResult {
                content: finalized.completion.content,
                is_error: finalized.completion.is_error,
            };
        }
    } else {
        runtime.event_sink.emit(AgentEvent::ThreadFinished {
            name: thread_name,
            exit_code,
            timed_out,
            timeout_reason,
            usage,
            run_id: None,
            dispatch_id: None,
            tool_call_id: None,
            status: None,
        });
    }

    if let Some((mut child, mut process_group)) = process_owner {
        if resolved_status == crate::events::ThreadDispatchStatus::Cancelled {
            process_group.terminate(&mut child).await;
        }
        process_group.disarm();
    }
    resolved_result
}

pub async fn execute_dispatch(
    args: Value,
    runtime: &ToolRuntime,
    client: &ModelClient,
) -> ToolResult {
    let params = match parse_dispatch_args(&args, runtime) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let thread_name = params.thread_name.clone();
    let dispatch_id = params.dispatch_id.clone();
    if !mark_thread_active(runtime, &thread_name, &dispatch_id) {
        return ToolResult {
            content: format!(
                "Thread '{}' is already running; retry after the current dispatch completes.",
                thread_name
            ),
            is_error: true,
        };
    }
    let result = execute_parsed_dispatch(params, None, runtime, client).await;
    if let Some(session_id) = runtime.session_id.as_deref() {
        close_thread_dispatch(runtime, session_id, &thread_name, &dispatch_id);
    }
    result
}

pub async fn execute_threads(runtime: &ToolRuntime) -> ToolResult {
    let session_id = match require_session(runtime) {
        Ok(s) => s.to_string(),
        Err(e) => return e,
    };

    let store_path = runtime.store_path.clone();
    let sid = session_id.clone();
    let threads =
        match tokio::task::spawn_blocking(move || store::list_threads(&store_path, &sid)).await {
            Ok(Ok(threads)) => threads,
            Ok(Err(error)) => {
                return ToolResult {
                    content: format!("Error listing threads: {}", error),
                    is_error: true,
                };
            }
            Err(join_error) => {
                return ToolResult {
                    content: format!("Internal error listing threads: {}", join_error),
                    is_error: true,
                };
            }
        };

    if threads.is_empty() {
        return ToolResult {
            content: "No active threads in this session.".to_string(),
            is_error: false,
        };
    }

    let mut output = String::from("Active threads:");
    for thread in threads {
        output.push_str(&format!(
            "\n- {} | {} episodes | created {} | updated {}",
            thread.name, thread.episode_count, thread.created_at, thread.updated_at
        ));
        if let Some(action) = thread.latest_action.as_deref() {
            output.push_str(&format!(" | last action: {}", action));
        }
    }

    ToolResult {
        content: output,
        is_error: false,
    }
}

pub(crate) const RESPOND_LIVE_MARKER: &str = "_respond_live_run_id";
pub(crate) const RESPOND_LIVE_YIELD_QUEUED: &str = "respond_live_yield:new_user_pending";
pub(crate) const RESPOND_LIVE_YIELD_DISABLED: &str = "respond_live_yield:disabled";
const RESPOND_LIVE_POLL_INTERVAL: Duration = Duration::from_millis(500);

pub async fn execute_thread_wait(args: Value, runtime: &ToolRuntime) -> ToolResult {
    let names = match require_string_array(&args, "names") {
        Ok(names) => names,
        Err(error) => return error,
    };
    let dispatch_ids = match require_string_array(&args, "dispatch_ids") {
        Ok(ids) => ids,
        Err(error) => return error,
    };
    if names
        .iter()
        .chain(dispatch_ids.iter())
        .any(|value| value.trim().is_empty())
    {
        return ToolResult {
            content: "Error: thread_wait selectors must not be empty".to_string(),
            is_error: true,
        };
    }
    let requested_names = names.into_iter().collect::<HashSet<_>>();
    let requested_dispatches = dispatch_ids.into_iter().collect::<HashSet<_>>();
    let timeout_secs = match args.get("timeout") {
        None => runtime.thread_timeout_secs,
        Some(value) => match value.as_u64().filter(|value| *value > 0) {
            Some(value) => value,
            None => {
                return ToolResult {
                    content: "Error: 'timeout' must be a positive integer".to_string(),
                    is_error: true,
                };
            }
        },
    };
    let Some(run_id) = runtime.event_sink.run_id().cloned() else {
        return ToolResult {
            content: "Error: thread_wait requires an active run identity".to_string(),
            is_error: true,
        };
    };
    let automatic = match args.get(RESPOND_LIVE_MARKER) {
        None => false,
        Some(Value::String(marked_run_id)) if marked_run_id == run_id.as_str() => true,
        Some(_) => {
            return ToolResult {
                content: "Error: invalid automatic thread_wait run identity".to_string(),
                is_error: true,
            };
        }
    };
    let session_id = match require_session(runtime) {
        Ok(value) => value.to_string(),
        Err(error) => return error,
    };
    let Some(deadline) = tokio::time::Instant::now().checked_add(Duration::from_secs(timeout_secs))
    else {
        return ToolResult {
            content: "Error: 'timeout' is too large".to_string(),
            is_error: true,
        };
    };

    loop {
        // Capture before observing durable/registry state to prevent lost wakeups.
        let activity_epoch = runtime.active_threads.activity_epoch();

        // Ordinary queued input has priority over completion delivery. Keeping
        // this check durable also prevents a model from repeatedly waiting and
        // starving a queued successor after the first wakeup.
        let store_path = runtime.store_path.clone();
        let queued_session = session_id.clone();
        let queued_after = run_id.as_str().to_string();
        let ordinary_pending = tokio::task::spawn_blocking(move || {
            store::load_queued_run(&store_path, &queued_session)
                .map(|queued| queued.is_some_and(|queued| queued.after_run_id == queued_after))
        })
        .await;
        match ordinary_pending {
            Ok(Ok(true)) if automatic => return ToolResult {
                content: RESPOND_LIVE_YIELD_QUEUED.to_string(),
                is_error: false,
            },
            Ok(Ok(true)) => return ToolResult {
                content: "Yield requested: a new ordinary user message is queued. Finish this turn now so the queued run can start; background threads will continue.".to_string(),
                is_error: false,
            },
            Ok(Ok(false)) => {}
            Ok(Err(error)) => return ToolResult { content: format!("Error checking queued user input: {error}"), is_error: true },
            Err(error) => return ToolResult { content: format!("Internal error checking queued user input: {error}"), is_error: true },
        }

        // Automatic waits, unlike explicit model requests, are controlled by
        // the persisted preference. The registry check gives local toggles an
        // immediate wake; the durable read plus bounded polling observes a
        // toggle handled by another server process.
        if automatic {
            let locally_enabled = runtime.active_threads.live_thread_updates();
            let store_path = runtime.store_path.clone();
            let preference_session = session_id.clone();
            let persisted_enabled = tokio::task::spawn_blocking(move || {
                store::load_respond_live_preference(&store_path, &preference_session)
                    .map(|preference| preference.enabled)
            })
            .await;
            match persisted_enabled {
                Ok(Ok(true)) if locally_enabled => {}
                Ok(Ok(_)) => {
                    return ToolResult {
                        content: RESPOND_LIVE_YIELD_DISABLED.to_string(),
                        is_error: false,
                    };
                }
                Ok(Err(error)) => {
                    return ToolResult {
                        content: format!("Error checking Respond-live preference: {error}"),
                        is_error: true,
                    };
                }
                Err(error) => {
                    return ToolResult {
                        content: format!(
                            "Internal error checking Respond-live preference: {error}"
                        ),
                        is_error: true,
                    };
                }
            }
        }

        let store_path = runtime.store_path.clone();
        let guidance_session = session_id.clone();
        let guidance_run = run_id.as_str().to_string();
        let guidance_pending = tokio::task::spawn_blocking(move || {
            store::has_queued_thread_steering(
                &store_path,
                &guidance_session,
                store::ORCHESTRATOR_STEERING_TARGET,
                &guidance_run,
            )
        })
        .await;
        match guidance_pending {
            Ok(Ok(true)) => return ToolResult {
                content: "New user guidance is pending for this run. Respond to it now; background threads continue independently.".to_string(),
                is_error: false,
            },
            Ok(Ok(false)) => {}
            Ok(Err(error)) => return ToolResult { content: format!("Error checking orchestrator guidance: {error}"), is_error: true },
            Err(error) => return ToolResult { content: format!("Internal error checking orchestrator guidance: {error}"), is_error: true },
        }

        let completions = runtime
            .active_threads
            .take_completions(&requested_names, &requested_dispatches);
        if !completions.is_empty() {
            if automatic {
                // Recheck after the destructive registry operation. This
                // makes a queue commit racing completion delivery win without
                // losing the exactly-once completion.
                let store_path = runtime.store_path.clone();
                let queued_session = session_id.clone();
                let queued_after = run_id.as_str().to_string();
                let ordinary_pending = tokio::task::spawn_blocking(move || {
                    store::load_queued_run(&store_path, &queued_session).map(|queued| {
                        queued.is_some_and(|queued| queued.after_run_id == queued_after)
                    })
                })
                .await;
                match ordinary_pending {
                    Ok(Ok(true)) => {
                        runtime.active_threads.restore_completions(completions);
                        return ToolResult {
                            content: RESPOND_LIVE_YIELD_QUEUED.to_string(),
                            is_error: false,
                        };
                    }
                    Ok(Ok(false)) => {}
                    Ok(Err(error)) => {
                        runtime.active_threads.restore_completions(completions);
                        return ToolResult {
                            content: format!("Error rechecking queued user input: {error}"),
                            is_error: true,
                        };
                    }
                    Err(error) => {
                        runtime.active_threads.restore_completions(completions);
                        return ToolResult {
                            content: format!(
                                "Internal error rechecking queued user input: {error}"
                            ),
                            is_error: true,
                        };
                    }
                }
            }
            let mut output = String::from("Thread updates:");
            for completion in completions {
                output.push_str(&format!(
                    "\n\n## {} ({})\norigin_run_id: {}\ndispatch_id: {}\noriginating_tool_call_id: {}\n{}",
                    completion.key.thread_name,
                    if completion.is_error { "failed" } else { "completed" },
                    completion.key.run_id.as_str(), completion.key.dispatch_id,
                    completion.key.tool_call_id, completion.content.trim()));
            }
            let mut remaining = runtime
                .active_threads
                .active_selected(&requested_names, &requested_dispatches)
                .into_iter()
                .map(|dispatch| {
                    format!(
                        "{} [{}]",
                        dispatch.key.thread_name, dispatch.key.dispatch_id
                    )
                })
                .collect::<Vec<_>>();
            remaining.sort();
            if !remaining.is_empty() {
                output.push_str(&format!("\n\nStill running: {}", remaining.join(", ")));
            }
            return ToolResult {
                content: output,
                is_error: false,
            };
        }

        let mut active = runtime
            .active_threads
            .active_selected(&requested_names, &requested_dispatches)
            .into_iter()
            .map(|dispatch| dispatch.key.thread_name)
            .collect::<Vec<_>>();
        active.sort();
        if active.is_empty() {
            let content = if requested_names.is_empty() && requested_dispatches.is_empty() {
                "No eligible buffered completions or active background threads.".to_string()
            } else {
                "No eligible buffered completion or active dispatch matches the requested selectors.".to_string()
            };
            return ToolResult {
                content,
                is_error: false,
            };
        }

        let now = tokio::time::Instant::now();
        if now >= deadline {
            return ToolResult {
                content: format!(
                    "Wait timed out after {timeout_secs}s. Still running: {}",
                    active.join(", ")
                ),
                is_error: false,
            };
        }
        let remaining = deadline.saturating_duration_since(now);
        let wake_after = if automatic {
            remaining.min(RESPOND_LIVE_POLL_INTERVAL)
        } else {
            remaining
        };
        if tokio::time::timeout(
            wake_after,
            runtime
                .active_threads
                .wait_for_activity_since(activity_epoch),
        )
        .await
        .is_err()
            && !automatic
        {
            return ToolResult {
                content: format!(
                    "Wait timed out after {timeout_secs}s. Still running: {}",
                    active.join(", ")
                ),
                is_error: false,
            };
        }
    }
}

pub async fn execute_thread_read(args: Value, runtime: &ToolRuntime) -> ToolResult {
    let thread_name = match require_str(&args, "name") {
        Ok(s) => s,
        Err(e) => return e,
    };
    let session_id = match require_session(runtime) {
        Ok(s) => s.to_string(),
        Err(e) => return e,
    };

    let store_path = runtime.store_path.clone();
    let sid = session_id.clone();
    let tname = thread_name.clone();
    match tokio::task::spawn_blocking(move || store::thread_read(&store_path, &sid, &tname)).await {
        Ok(Ok(episodes)) => ToolResult {
            content: store::render_thread_document(&thread_name, &episodes),
            is_error: false,
        },
        Ok(Err(error)) => ToolResult {
            content: format!("Error reading thread '{}': {}", thread_name, error),
            is_error: true,
        },
        Err(join_error) => ToolResult {
            content: format!(
                "Internal error reading thread '{}': {}",
                thread_name, join_error
            ),
            is_error: true,
        },
    }
}

pub async fn execute_thread_cancel(args: Value, runtime: &ToolRuntime) -> ToolResult {
    let field = |name| require_str(&args, name);
    let origin_run_id = match field("origin_run_id") {
        Ok(v) => v,
        Err(e) => return e,
    };
    let name = match field("name") {
        Ok(v) => v,
        Err(e) => return e,
    };
    let dispatch_id = match field("dispatch_id") {
        Ok(v) => v,
        Err(e) => return e,
    };
    let tool_call_id = match field("originating_tool_call_id") {
        Ok(v) => v,
        Err(e) => return e,
    };
    let wait_ms = args
        .get("wait_ms")
        .and_then(Value::as_u64)
        .unwrap_or(0)
        .min(30_000);
    let key = ThreadDispatchKey::new(
        SessionRunId::from_string(origin_run_id),
        name,
        dispatch_id,
        tool_call_id,
    );
    let outcome = match runtime.active_threads.request_cancel(&key) {
        Ok(outcome) => outcome,
        Err(error) => {
            return ToolResult {
                content: format!("Error cancelling dispatch: {error}"),
                is_error: true,
            };
        }
    };
    if wait_ms > 0
        && matches!(
            outcome,
            crate::tools::ThreadCancelOutcome::CancelRequested
                | crate::tools::ThreadCancelOutcome::AlreadyCancelling
        )
    {
        let _ = tokio::time::timeout(Duration::from_millis(wait_ms), async {
            while runtime.active_threads.matches(&key) {
                runtime.active_threads.wait_for_activity().await;
            }
        })
        .await;
    }
    let (label, is_error) = match outcome {
        crate::tools::ThreadCancelOutcome::CancelRequested => ("requested", false),
        crate::tools::ThreadCancelOutcome::AlreadyCancelling => ("already_cancelling", false),
        crate::tools::ThreadCancelOutcome::AlreadyTerminal(_) => ("already_terminal", false),
        crate::tools::ThreadCancelOutcome::NotFound => ("not_found", true),
        crate::tools::ThreadCancelOutcome::IdentityMismatch => ("identity_mismatch", true),
    };
    ToolResult { content: serde_json::json!({"outcome": label, "origin_run_id": key.run_id, "name": key.thread_name, "dispatch_id": key.dispatch_id, "originating_tool_call_id": key.tool_call_id, "terminal": !runtime.active_threads.matches(&key)}).to_string(), is_error }
}

pub async fn execute_thread_delete(args: Value, runtime: &ToolRuntime) -> ToolResult {
    let thread_name = match require_str(&args, "name") {
        Ok(s) => s,
        Err(e) => return e,
    };
    let session_id = match require_session(runtime) {
        Ok(s) => s.to_string(),
        Err(e) => return e,
    };

    if is_thread_active(runtime, &thread_name) {
        return ToolResult {
            content: format!(
                "Thread '{}' is currently running; wait for it to finish before deleting it.",
                thread_name
            ),
            is_error: true,
        };
    }

    let store_path = runtime.store_path.clone();
    let sid = session_id.clone();
    let tname = thread_name.clone();
    match tokio::task::spawn_blocking(move || store::delete_thread(&store_path, &sid, &tname)).await
    {
        Ok(Ok(true)) => ToolResult {
            content: format!(
                "Deleted thread '{}' and its retained episodes.",
                thread_name
            ),
            is_error: false,
        },
        Ok(Ok(false)) => ToolResult {
            content: format!("Thread '{}' does not exist in this session.", thread_name),
            is_error: true,
        },
        Ok(Err(error)) => ToolResult {
            content: format!("Error deleting thread '{}': {}", thread_name, error),
            is_error: true,
        },
        Err(join_error) => ToolResult {
            content: format!(
                "Internal error deleting thread '{}': {}",
                thread_name, join_error
            ),
            is_error: true,
        },
    }
}

fn def(name: &str, description: &str, parameters: serde_json::Value) -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: crate::types::FunctionDef {
            name: name.to_string(),
            description: description.to_string(),
            parameters,
        },
    }
}

fn require_session(runtime: &ToolRuntime) -> Result<&str, ToolResult> {
    runtime.session_id.as_deref().ok_or_else(|| ToolResult {
        content: "Error: thread tools require an active session".to_string(),
        is_error: true,
    })
}

fn resolve_scheduled_skills(
    args: &Value,
    registry: Option<&SkillRegistry>,
) -> Result<Vec<String>, ToolResult> {
    let mut skills = Vec::new();
    for skill in require_string_array(args, "skills")? {
        if !skills.contains(&skill) {
            skills.push(skill);
        }
    }
    if skills.is_empty() {
        return Ok(skills);
    }

    let Some(registry) = registry else {
        return Err(ToolResult {
            content: "Error: no skills are available for thread dispatch".to_string(),
            is_error: true,
        });
    };

    for skill in &skills {
        if !registry.has_skill(skill) {
            return Err(ToolResult {
                content: format!("Error: unknown skill '{}'", skill),
                is_error: true,
            });
        }
    }

    Ok(skills)
}

fn resolve_thread_timeout_secs(args: &Value, default_timeout_secs: u64) -> u64 {
    args.get("timeout")
        .and_then(|v| v.as_u64())
        .unwrap_or(default_timeout_secs)
        .max(MIN_THREAD_TIMEOUT_SECS)
}

pub(crate) struct FinalizedDispatch {
    pub(crate) status: crate::events::ThreadDispatchStatus,
    pub(crate) completion: ThreadCompletion,
}

pub(crate) fn finalize_thread_dispatch(
    runtime: &ToolRuntime,
    session_id: &str,
    key: ThreadDispatchKey,
    result: &ToolResult,
    status: crate::events::ThreadDispatchStatus,
    exit_code: i32,
    timed_out: bool,
    timeout_reason: Option<String>,
    usage: Option<crate::model::TokenUsage>,
) -> Option<FinalizedDispatch> {
    let thread_name = key.thread_name.clone();
    match runtime.active_threads.finalize_once(
        &runtime.store_path,
        session_id,
        ThreadCompletion {
            key: key.clone(),
            content: result.content.clone(),
            is_error: result.is_error,
        },
        status,
        true,
    ) {
        Ok(Some(outcome)) => {
            let resolved_status = outcome.status;
            let cancelled = resolved_status == crate::events::ThreadDispatchStatus::Cancelled;
            runtime.event_sink.emit(AgentEvent::ThreadFinished {
                name: key.thread_name,
                exit_code,
                timed_out: if cancelled { false } else { timed_out },
                timeout_reason: if cancelled { None } else { timeout_reason },
                usage,
                run_id: Some(key.run_id),
                dispatch_id: Some(key.dispatch_id),
                tool_call_id: Some(key.tool_call_id),
                status: Some(resolved_status),
            });
            if let Some(error) = outcome.steering_error {
                runtime.event_sink.emit(AgentEvent::Error {
                    thread_name: Some(thread_name),
                    message: format!("thread terminalized but steering expiration failed: {error}"),
                });
            }
            for record in outcome.expired {
                runtime.event_sink.emit(AgentEvent::ThreadSteeringExpired {
                    name: record.thread_name.clone(),
                    dispatch_id: record.dispatch_id.clone(),
                    steering_id: record.id,
                    instruction_preview: record.instruction.chars().take(160).collect(),
                });
            }
            Some(FinalizedDispatch {
                status: resolved_status,
                completion: outcome.completion,
            })
        }
        Ok(None) => None,
        Err(error) => {
            runtime.event_sink.emit(AgentEvent::Error {
                thread_name: Some(thread_name),
                message: format!("failed to finalize background thread dispatch: {error}"),
            });
            None
        }
    }
}

pub(crate) fn complete_thread_dispatch(
    runtime: &ToolRuntime,
    session_id: &str,
    key: ThreadDispatchKey,
    result: &ToolResult,
) {
    let cancelling = runtime
        .active_threads
        .active_dispatches()
        .iter()
        .any(|dispatch| {
            dispatch.key == key && dispatch.state == crate::tools::ThreadDispatchState::Cancelling
        });
    let status = if cancelling {
        crate::events::ThreadDispatchStatus::Cancelled
    } else if result.is_error {
        crate::events::ThreadDispatchStatus::Failed
    } else {
        crate::events::ThreadDispatchStatus::Completed
    };
    finalize_thread_dispatch(
        runtime, session_id, key, result, status, -1, false, None, None,
    );
}

pub(crate) fn mark_thread_active(
    runtime: &ToolRuntime,
    thread_name: &str,
    dispatch_id: &str,
) -> bool {
    runtime.active_threads.mark(thread_name, dispatch_id)
}

pub(crate) fn close_thread_dispatch(
    runtime: &ToolRuntime,
    session_id: &str,
    thread_name: &str,
    dispatch_id: &str,
) {
    match runtime.active_threads.close_compat(
        &runtime.store_path,
        session_id,
        thread_name,
        dispatch_id,
    ) {
        Ok(expired) => {
            for record in expired {
                runtime.event_sink.emit(AgentEvent::ThreadSteeringExpired {
                    name: record.thread_name.clone(),
                    dispatch_id: record.dispatch_id.clone(),
                    steering_id: record.id,
                    instruction_preview: record.instruction.chars().take(160).collect(),
                });
            }
        }
        Err(error) => runtime.event_sink.emit(AgentEvent::Error {
            thread_name: Some(thread_name.to_string()),
            message: format!("failed to expire undelivered steering: {error}"),
        }),
    }
}

fn is_thread_active(runtime: &ToolRuntime, thread_name: &str) -> bool {
    runtime.active_threads.is_active(thread_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::{EventSink, SessionEventBus, SessionRunId};
    use crate::tools::test_runtime;
    use serde_json::json;
    use std::sync::Arc;

    fn wait_runtime(label: &str) -> (ToolRuntime, SessionRunId) {
        let mut runtime = test_runtime();
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        runtime.store_path = std::env::temp_dir()
            .join(format!("nac_thread_wait_{label}_{unique}"))
            .join("store.db");
        crate::store::initialize(&runtime.store_path).unwrap();
        crate::store::insert_test_session(&runtime.store_path, "test-session");
        let run_id = SessionRunId::new();
        runtime.event_sink = EventSink::bus_with_context(
            SessionEventBus::new(Some("test-session".to_string())),
            Some(run_id.clone()),
            None,
        );
        (runtime, run_id)
    }

    fn wait_key(run_id: &SessionRunId, name: &str) -> ThreadDispatchKey {
        ThreadDispatchKey::new(
            run_id.clone(),
            name,
            format!("dispatch-{name}"),
            format!("call-{name}"),
        )
    }

    fn finish_wait_thread(runtime: &ToolRuntime, key: ThreadDispatchKey, content: &str) {
        runtime
            .active_threads
            .complete(
                &runtime.store_path,
                "test-session",
                ThreadCompletion {
                    key,
                    content: content.to_string(),
                    is_error: false,
                },
            )
            .unwrap();
    }

    fn enable_respond_live(runtime: &ToolRuntime) {
        crate::store::update_respond_live_preference(&runtime.store_path, "test-session", true, 0)
            .unwrap();
        runtime.active_threads.set_live_thread_updates(true);
    }

    fn skill_record(
        name: &str,
        description: &str,
        compatibility: Option<&str>,
    ) -> crate::skills::SkillRecord {
        crate::skills::SkillRecord {
            name: name.to_string(),
            description: description.to_string(),
            compatibility: compatibility.map(str::to_string),
            skill_root_visible: std::path::PathBuf::from(format!("/tmp/{name}")),
            body: format!("{name} body"),
            resources: Vec::new(),
        }
    }

    fn test_registry() -> SkillRegistry {
        SkillRegistry::load_for_test(vec![
            skill_record("lint", "Run linting workflows.", None),
            skill_record("review", "Review code quality.", Some("Rust")),
        ])
    }

    fn test_runtime_with_skills() -> ToolRuntime {
        let mut rt = test_runtime();
        rt.skills = Some(Arc::new(test_registry()));
        rt
    }

    #[test]
    fn dispatch_definition_skills_schema_depends_on_registry() {
        assert!(
            dispatch_definition(None).function.parameters["properties"]
                .get("skills")
                .is_none()
        );

        let registry = test_registry();
        let definition = dispatch_definition(Some(&registry));
        let skills = &definition.function.parameters["properties"]["skills"];
        assert_eq!(skills["items"]["enum"], json!(["lint", "review"]));
        assert_eq!(skills["uniqueItems"], true);
        let description = skills["description"].as_str().unwrap();
        assert!(description.contains("Compact catalog"));
        assert!(description.contains("- lint: Run linting workflows."));
        assert!(description.contains("- review: Review code quality. (compatibility: Rust)"));
    }

    #[test]
    fn scheduled_skills_validation_dedupes_and_rejects_invalid_requests() {
        let registry = test_registry();
        assert!(
            resolve_scheduled_skills(&json!({}), None)
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            resolve_scheduled_skills(
                &json!({ "skills": ["review", "lint", "review"] }),
                Some(&registry),
            )
            .unwrap(),
            vec!["review", "lint"]
        );

        let unknown = resolve_scheduled_skills(&json!({ "skills": ["missing"] }), Some(&registry))
            .unwrap_err();
        assert_eq!(unknown.content, "Error: unknown skill 'missing'");

        let unavailable =
            resolve_scheduled_skills(&json!({ "skills": ["lint"] }), None).unwrap_err();
        assert_eq!(
            unavailable.content,
            "Error: no skills are available for thread dispatch"
        );
    }

    #[test]
    fn thread_timeout_defaults_to_one_hour() {
        assert_eq!(
            resolve_thread_timeout_secs(&json!({}), DEFAULT_THREAD_TIMEOUT_SECS),
            60 * 60
        );
    }

    #[test]
    fn thread_timeout_is_clamped_to_thirty_minutes() {
        assert_eq!(resolve_thread_timeout_secs(&json!({}), 10), 30 * 60);
        assert_eq!(
            resolve_thread_timeout_secs(&json!({ "timeout": 20 }), DEFAULT_THREAD_TIMEOUT_SECS),
            30 * 60
        );
        assert_eq!(
            resolve_thread_timeout_secs(&json!({ "timeout": 7200 }), DEFAULT_THREAD_TIMEOUT_SECS),
            7200
        );
    }

    // ------------------------------------------------------------------
    // parse_dispatch_args
    // ------------------------------------------------------------------

    #[test]
    fn parse_dispatch_args_extracts_all_fields() {
        let runtime = test_runtime_with_skills();
        let args = json!({
            "name": "impl/auth",
            "action": "Implement authentication",
            "threads": ["design", "research"],
            "skills": ["lint", "review"],
            "timeout": 7200,
        });

        let params = parse_dispatch_args(&args, &runtime).unwrap();
        assert_eq!(params.thread_name, "impl/auth");
        assert_eq!(params.action, "Implement authentication");
        assert_eq!(params.source_threads, vec!["design", "research"]);
        assert_eq!(params.scheduled_skills, vec!["lint", "review"]);
        assert_eq!(params.session_id, "test-session");
        assert_eq!(params.timeout_secs, 7200);
    }

    #[test]
    fn parse_dispatch_args_errors_when_name_missing() {
        let runtime = test_runtime();
        let args = json!({ "action": "Do something" });

        let err = parse_dispatch_args(&args, &runtime).unwrap_err();
        assert!(err.is_error);
        assert!(err.content.contains("'name'"));
    }

    #[test]
    fn parse_dispatch_args_errors_when_action_missing() {
        let runtime = test_runtime();
        let args = json!({ "name": "impl/auth" });

        let err = parse_dispatch_args(&args, &runtime).unwrap_err();
        assert!(err.is_error);
        assert!(err.content.contains("'action'"));
    }

    #[test]
    fn parse_dispatch_args_defaults_threads_to_empty() {
        let runtime = test_runtime();
        let args = json!({ "name": "t1", "action": "work" });

        let params = parse_dispatch_args(&args, &runtime).unwrap();
        assert!(params.source_threads.is_empty());
    }

    #[test]
    fn parse_dispatch_args_defaults_skills_to_empty() {
        let runtime = test_runtime();
        let args = json!({ "name": "t1", "action": "work" });

        let params = parse_dispatch_args(&args, &runtime).unwrap();
        assert!(params.scheduled_skills.is_empty());
    }

    #[test]
    fn parse_dispatch_args_applies_default_timeout() {
        let runtime = test_runtime();
        let args = json!({ "name": "t1", "action": "work" });

        let params = parse_dispatch_args(&args, &runtime).unwrap();
        assert_eq!(params.timeout_secs, DEFAULT_THREAD_TIMEOUT_SECS);
    }

    #[test]
    fn queue_close_ordering_and_name_reuse_are_dispatch_exact() {
        let mut runtime = test_runtime();
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        runtime.store_path = std::env::temp_dir()
            .join(format!("nac_registry_ordering_{unique}"))
            .join("store.db");
        crate::store::initialize(&runtime.store_path).unwrap();
        crate::store::insert_test_session(&runtime.store_path, "test-session");

        assert!(mark_thread_active(&runtime, "worker", "dispatch-a"));
        runtime
            .active_threads
            .queue(&runtime.store_path, "test-session", "worker", "for A")
            .unwrap()
            .unwrap();
        close_thread_dispatch(&runtime, "test-session", "worker", "dispatch-a");
        assert!(!runtime.active_threads.is_active("worker"));
        assert_eq!(
            crate::store::list_thread_steering(&runtime.store_path, "test-session").unwrap()[0]
                .status,
            "expired",
            "queue-before-close must be expired"
        );

        assert!(mark_thread_active(&runtime, "worker", "dispatch-b"));
        close_thread_dispatch(&runtime, "test-session", "worker", "dispatch-a");
        let reused = runtime
            .active_threads
            .queue(&runtime.store_path, "test-session", "worker", "for B")
            .unwrap()
            .unwrap();
        assert_eq!(reused.dispatch_id, "dispatch-b");

        close_thread_dispatch(&runtime, "test-session", "worker", "dispatch-b");
        assert!(
            runtime
                .active_threads
                .queue(&runtime.store_path, "test-session", "worker", "too late",)
                .unwrap()
                .is_none()
        );
        let _ = std::fs::remove_dir_all(runtime.store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn thread_wait_later_run_consumes_old_completion_once_with_origin_identity() {
        let (runtime, consuming_run) = wait_runtime("cross_run");
        let origin_run = SessionRunId::new();
        let old = wait_key(&origin_run, "first");
        let unrelated = wait_key(&consuming_run, "second");
        assert!(runtime.active_threads.try_accept(old.clone()));
        assert!(runtime.active_threads.try_accept(unrelated.clone()));
        finish_wait_thread(&runtime, old.clone(), "old result");
        finish_wait_thread(&runtime, unrelated, "unrelated result");

        let result = execute_thread_wait(
            json!({"dispatch_ids": [old.dispatch_id], "timeout": 1}),
            &runtime,
        )
        .await;
        assert!(result.content.contains("old result"));
        assert!(result.content.contains(origin_run.as_str()));
        assert!(result.content.contains(&old.tool_call_id));
        assert!(!result.content.contains("unrelated result"));
        let again = execute_thread_wait(
            json!({"dispatch_ids": [old.dispatch_id], "timeout": 1}),
            &runtime,
        )
        .await;
        assert!(again.content.contains("No eligible"));
        let unrelated =
            execute_thread_wait(json!({"names": ["second"], "timeout": 1}), &runtime).await;
        assert!(unrelated.content.contains("unrelated result"));
    }

    #[tokio::test]
    async fn automatic_wait_delivers_only_exact_origin_run_dispatches() {
        for _ in 0..3 {
            let (runtime, run_id) = wait_runtime("automatic_exact");
            enable_respond_live(&runtime);
            let selected = wait_key(&run_id, "selected");
            let foreign_run = SessionRunId::new();
            let foreign = wait_key(&foreign_run, "foreign");
            assert!(runtime.active_threads.try_accept(selected.clone()));
            assert!(runtime.active_threads.try_accept(foreign.clone()));
            finish_wait_thread(&runtime, foreign.clone(), "foreign result");
            finish_wait_thread(&runtime, selected.clone(), "selected result");

            let result = execute_thread_wait(
                json!({
                    "dispatch_ids": runtime.active_threads.dispatch_ids_for_run(&run_id),
                    RESPOND_LIVE_MARKER: run_id.as_str(),
                    "timeout": 1
                }),
                &runtime,
            )
            .await;
            assert!(result.content.contains("selected result"));
            assert!(!result.content.contains("foreign result"));
            let retained = runtime
                .active_threads
                .take_completions(&HashSet::new(), &HashSet::from([foreign.dispatch_id]));
            assert_eq!(retained.len(), 1);
            assert_eq!(retained[0].content, "foreign result");
        }
    }

    #[tokio::test]
    async fn automatic_wait_queue_wins_and_preserves_completion() {
        for _ in 0..3 {
            let (runtime, run_id) = wait_runtime("automatic_queue");
            enable_respond_live(&runtime);
            let selected = wait_key(&run_id, "worker");
            assert!(runtime.active_threads.try_accept(selected.clone()));
            finish_wait_thread(&runtime, selected.clone(), "must remain buffered");
            crate::store::create_queued_run(
                &runtime.store_path,
                &crate::store::CreateQueuedRun {
                    session_id: "test-session".to_string(),
                    client_message_id: uuid::Uuid::new_v4().to_string(),
                    queued_run_id: uuid::Uuid::new_v4().to_string(),
                    display_prompt: "next".to_string(),
                    agent_prompt: "next".to_string(),
                    after_run_id: run_id.as_str().to_string(),
                },
            )
            .unwrap();

            let result = execute_thread_wait(
                json!({
                    "dispatch_ids": [selected.dispatch_id.clone()],
                    RESPOND_LIVE_MARKER: run_id.as_str(),
                    "timeout": 1
                }),
                &runtime,
            )
            .await;
            assert_eq!(result.content, RESPOND_LIVE_YIELD_QUEUED);
            let retained = runtime
                .active_threads
                .take_completions(&HashSet::new(), &HashSet::from([selected.dispatch_id]));
            assert_eq!(retained.len(), 1);
            assert_eq!(retained[0].content, "must remain buffered");
        }
    }

    #[tokio::test]
    async fn automatic_wait_wakes_on_local_or_remote_mode_off() {
        for remote in [false, true] {
            let (runtime, run_id) = wait_runtime(if remote {
                "automatic_remote_off"
            } else {
                "automatic_local_off"
            });
            enable_respond_live(&runtime);
            let selected = wait_key(&run_id, "worker");
            assert!(runtime.active_threads.try_accept(selected.clone()));
            let waiting = runtime.clone();
            let marker = run_id.as_str().to_string();
            let dispatch_id = selected.dispatch_id.clone();
            let wait = tokio::spawn(async move {
                execute_thread_wait(
                    json!({
                        "dispatch_ids": [dispatch_id],
                        RESPOND_LIVE_MARKER: marker,
                        "timeout": 3
                    }),
                    &waiting,
                )
                .await
            });
            tokio::time::sleep(Duration::from_millis(30)).await;
            crate::store::update_respond_live_preference(
                &runtime.store_path,
                "test-session",
                false,
                1,
            )
            .unwrap();
            if !remote {
                runtime.active_threads.set_live_thread_updates(false);
            }
            let result = tokio::time::timeout(Duration::from_secs(2), wait)
                .await
                .expect("automatic wait did not poll mode-off")
                .unwrap();
            assert_eq!(result.content, RESPOND_LIVE_YIELD_DISABLED);
            assert!(runtime.active_threads.matches(&selected));
        }
    }

    #[tokio::test]
    async fn explicit_wait_ignores_mode_off_and_delivers_completion() {
        let (runtime, run_id) = wait_runtime("explicit_mode_off");
        let selected = wait_key(&run_id, "worker");
        assert!(runtime.active_threads.try_accept(selected.clone()));
        finish_wait_thread(&runtime, selected.clone(), "explicit result");
        let result = execute_thread_wait(
            json!({"dispatch_ids": [selected.dispatch_id], "timeout": 1}),
            &runtime,
        )
        .await;
        assert!(result.content.contains("explicit result"));
    }

    #[tokio::test]
    async fn thread_wait_live_mode_selects_without_stealing_unrelated_completion() {
        let (runtime, run_id) = wait_runtime("live_selection");
        runtime.active_threads.set_live_thread_updates(true);
        let selected = wait_key(&run_id, "selected");
        let other = wait_key(&run_id, "other");
        assert!(runtime.active_threads.try_accept(selected.clone()));
        assert!(runtime.active_threads.try_accept(other.clone()));
        finish_wait_thread(&runtime, other, "other result");
        finish_wait_thread(&runtime, selected, "selected result");

        let result =
            execute_thread_wait(json!({"names": ["selected"], "timeout": 1}), &runtime).await;
        assert!(result.content.contains("selected result"));
        assert!(!result.content.contains("other result"));
        let remaining =
            execute_thread_wait(json!({"names": ["other"], "timeout": 1}), &runtime).await;
        assert!(remaining.content.contains("other result"));
    }

    #[tokio::test]
    async fn thread_wait_wakes_only_for_durable_same_run_guidance_without_consuming_it() {
        let (runtime, run_id) = wait_runtime("guidance");
        let worker = wait_key(&run_id, "worker");
        assert!(runtime.active_threads.try_accept(worker.clone()));
        crate::store::queue_thread_steering(
            &runtime.store_path,
            "test-session",
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            "foreign-run",
            "stale",
        )
        .unwrap();

        let waiting = runtime.clone();
        let wait =
            tokio::spawn(async move { execute_thread_wait(json!({"timeout": 5}), &waiting).await });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!wait.is_finished());
        crate::store::queue_thread_steering(
            &runtime.store_path,
            "test-session",
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            run_id.as_str(),
            "new direction",
        )
        .unwrap();
        runtime.active_threads.signal_activity();

        let result = wait.await.unwrap();
        assert!(result.content.contains("guidance is pending for this run"));
        assert!(
            crate::store::has_queued_thread_steering(
                &runtime.store_path,
                "test-session",
                crate::store::ORCHESTRATOR_STEERING_TARGET,
                run_id.as_str(),
            )
            .unwrap()
        );
        runtime
            .active_threads
            .close(&runtime.store_path, "test-session", &worker)
            .unwrap();
    }

    #[tokio::test]
    async fn thread_wait_yields_repeatedly_to_queued_ordinary_input_before_completion() {
        let (runtime, run_id) = wait_runtime("ordinary_yield");
        let worker = wait_key(&run_id, "worker");
        assert!(runtime.active_threads.try_accept(worker.clone()));

        let waiting = runtime.clone();
        let wait = tokio::spawn(async move {
            execute_thread_wait(json!({"names": ["worker"], "timeout": 5}), &waiting).await
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!wait.is_finished());

        crate::store::create_queued_run(
            &runtime.store_path,
            &crate::store::CreateQueuedRun {
                session_id: "test-session".to_string(),
                queued_run_id: uuid::Uuid::new_v4().to_string(),
                client_message_id: uuid::Uuid::new_v4().to_string(),
                display_prompt: "new user message".to_string(),
                agent_prompt: "new user message".to_string(),
                after_run_id: run_id.as_str().to_string(),
            },
        )
        .unwrap();
        // Complete in the same ordering window: ordinary input must win and
        // leave the completion buffered for a later run.
        finish_wait_thread(&runtime, worker, "finished concurrently");
        runtime.active_threads.signal_activity();

        let yielded = wait.await.unwrap();
        assert!(yielded.content.contains("Yield requested"));
        let repeated =
            execute_thread_wait(json!({"names": ["worker"], "timeout": 1}), &runtime).await;
        assert!(repeated.content.contains("Yield requested"));
        let buffered = runtime
            .active_threads
            .take_completions(&HashSet::from(["worker".to_string()]), &HashSet::new());
        assert_eq!(buffered.len(), 1);
        assert_eq!(buffered[0].content, "finished concurrently");
    }

    #[tokio::test]
    async fn thread_wait_timeout_reports_running_and_preserves_foreign_completion() {
        let (runtime, run_id) = wait_runtime("timeout");
        let running = wait_key(&run_id, "running");
        let foreign_run = SessionRunId::new();
        let foreign = wait_key(&foreign_run, "foreign");
        assert!(runtime.active_threads.try_accept(running.clone()));
        assert!(runtime.active_threads.try_accept(foreign.clone()));
        finish_wait_thread(&runtime, foreign.clone(), "foreign result");

        let result =
            execute_thread_wait(json!({"names": ["running"], "timeout": 1}), &runtime).await;
        assert!(!result.is_error);
        assert!(result.content.contains("Still running: running"));
        assert_eq!(
            runtime
                .active_threads
                .take_completions(&HashSet::new(), &HashSet::new())[0]
                .content,
            "foreign result"
        );
        runtime
            .active_threads
            .close(&runtime.store_path, "test-session", &running)
            .unwrap();
    }

    #[test]
    fn concurrent_cancel_finalize_race_emits_one_event_and_one_authoritative_completion() {
        let (mut runtime, run_id) = wait_runtime("cancel_finalize_event_race");
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        runtime.event_sink = EventSink::channel(sender);
        let runtime = Arc::new(runtime);
        let key = wait_key(&run_id, "racer");
        assert!(runtime.active_threads.try_accept(key.clone()));
        let barrier = Arc::new(std::sync::Barrier::new(3));

        let cancel_runtime = runtime.clone();
        let cancel_key = key.clone();
        let cancel_barrier = barrier.clone();
        let cancel = std::thread::spawn(move || {
            cancel_barrier.wait();
            cancel_runtime
                .active_threads
                .request_cancel(&cancel_key)
                .unwrap()
        });
        let finalize_runtime = runtime.clone();
        let finalize_key = key.clone();
        let finalize_barrier = barrier.clone();
        let finalize = std::thread::spawn(move || {
            finalize_barrier.wait();
            finalize_thread_dispatch(
                &finalize_runtime,
                "test-session",
                finalize_key,
                &ToolResult {
                    content: "natural success".to_string(),
                    is_error: false,
                },
                crate::events::ThreadDispatchStatus::Completed,
                0,
                true,
                Some("conflicting natural timeout".to_string()),
                None,
            )
        });
        barrier.wait();
        let cancel_outcome = cancel.join().unwrap();
        assert!(finalize.join().unwrap().is_some());
        assert!(
            finalize_thread_dispatch(
                &runtime,
                "test-session",
                key.clone(),
                &ToolResult {
                    content: "duplicate".to_string(),
                    is_error: true,
                },
                crate::events::ThreadDispatchStatus::Failed,
                -1,
                false,
                None,
                None,
            )
            .is_none()
        );

        let completions = runtime
            .active_threads
            .take_completions(&HashSet::new(), &HashSet::new());
        assert_eq!(completions.len(), 1);
        let (expected, expected_timed_out, expected_timeout_reason) = match cancel_outcome {
            crate::tools::ThreadCancelOutcome::CancelRequested => {
                assert!(completions[0].is_error);
                assert!(completions[0].content.contains("was cancelled"));
                assert!(completions[0].content.contains(run_id.as_str()));
                (crate::events::ThreadDispatchStatus::Cancelled, false, None)
            }
            crate::tools::ThreadCancelOutcome::AlreadyTerminal(status) => {
                assert_eq!(completions[0].content, "natural success");
                assert!(!completions[0].is_error);
                (
                    status,
                    true,
                    Some("conflicting natural timeout".to_string()),
                )
            }
            outcome => panic!("unexpected race outcome: {outcome:?}"),
        };
        let events = std::iter::from_fn(|| receiver.try_recv().ok()).collect::<Vec<_>>();
        assert_eq!(events.len(), 1, "events: {events:?}");
        assert!(matches!(
            &events[0],
            AgentEvent::ThreadFinished {
                name,
                run_id: Some(event_run_id),
                dispatch_id: Some(dispatch_id),
                tool_call_id: Some(tool_call_id),
                timed_out,
                timeout_reason,
                status: Some(status),
                ..
            } if name == &key.thread_name
                && event_run_id == &key.run_id
                && dispatch_id == &key.dispatch_id
                && tool_call_id == &key.tool_call_id
                && status == &expected
                && timed_out == &expected_timed_out
                && timeout_reason == &expected_timeout_reason
        ));
    }

    #[tokio::test]
    async fn thread_cancel_tool_requires_and_matches_complete_identity() {
        let runtime = crate::tools::test_runtime();
        let key = ThreadDispatchKey::new(
            SessionRunId::from_string("old-run".to_string()),
            "worker",
            "dispatch",
            "call",
        );
        assert!(runtime.active_threads.try_accept(key.clone()));
        let mismatch = execute_thread_cancel(
            serde_json::json!({"origin_run_id":"old-run","name":"worker","dispatch_id":"dispatch","originating_tool_call_id":"wrong"}),
            &runtime,
        ).await;
        assert!(mismatch.is_error);
        assert!(mismatch.content.contains("identity_mismatch"));
        assert!(runtime.active_threads.matches(&key));

        let requested = execute_thread_cancel(
            serde_json::json!({"origin_run_id":"old-run","name":"worker","dispatch_id":"dispatch","originating_tool_call_id":"call","wait_ms":0}),
            &runtime,
        ).await;
        assert!(!requested.is_error);
        assert!(requested.content.contains("requested"));
        let repeated = execute_thread_cancel(
            serde_json::json!({"origin_run_id":"old-run","name":"worker","dispatch_id":"dispatch","originating_tool_call_id":"call"}),
            &runtime,
        ).await;
        assert!(!repeated.is_error);
        assert!(repeated.content.contains("already_cancelling"));
    }
}
