use std::collections::HashSet;
use std::time::Duration;

use serde_json::Value;

use crate::events::AgentEvent;
use crate::model::ModelClient;
use crate::skills::SkillRegistry;
use crate::store;
use crate::tools::{require_str, require_string_array, ToolResult, ToolRuntime};
use crate::types::ToolDefinition;

mod worker;
#[cfg(test)]
pub(crate) use worker::worker_model_arguments_for_test;
use worker::{run_worker, WorkerInvocation};

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
        "List known threads in the current orchestrator session and show which background dispatches are running.",
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
        "Wait for background thread progress. Returns when a selected thread finishes, new user guidance is queued for the orchestrator, or the timeout elapses.",
        json!({
            "type": "object",
            "properties": {
                "names": {
                    "type": "array",
                    "items": { "type": "string" },
                    "uniqueItems": true,
                    "description": "Optional thread names to wait for. Omit to wait for any active thread."
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
    });

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
        },
    )
    .await;

    // Fold worker token usage into the shared runtime accumulator so the
    // orchestrator's agent loop can include it in session totals.
    if let Ok(run) = &result {
        if let Some(usage) = &run.usage {
            let mut wu = runtime.worker_usage.lock().await;
            wu.add_cost_saturating(&usage);
        }
    }

    let tool_result = match result {
        Err(e) => {
            runtime.event_sink.emit(AgentEvent::Error {
                thread_name: Some(thread_name.clone()),
                message: format!("Failed to spawn thread '{}': {}", thread_name, e),
            });
            ToolResult {
                content: format!("Failed to spawn thread '{}': {}", thread_name, e),
                is_error: true,
            }
        }
        Ok(run) if run.timed_out => {
            let timeout_reason = run.timeout_reason.clone();
            runtime.event_sink.emit(AgentEvent::ThreadFinished {
                name: thread_name.clone(),
                exit_code: run.exit_code,
                timed_out: true,
                timeout_reason: timeout_reason.clone(),
                usage: run.usage.clone(),
            });
            ToolResult {
                content: match timeout_reason {
                    Some(reason) => format!(
                        "Thread '{}' timed out after {}s.\n{}",
                        thread_name, timeout_secs, reason
                    ),
                    None => format!("Thread '{}' timed out after {}s", thread_name, timeout_secs),
                },
                is_error: true,
            }
        }
        Ok(run) if run.exit_code != 0 => {
            runtime.event_sink.emit(AgentEvent::ThreadFinished {
                name: thread_name.clone(),
                exit_code: run.exit_code,
                timed_out: false,
                timeout_reason: None,
                usage: run.usage.clone(),
            });
            let details = if !run.stderr.trim().is_empty() {
                run.stderr.trim().to_string()
            } else if !run.stdout.trim().is_empty() {
                run.stdout.trim().to_string()
            } else {
                "no output".to_string()
            };
            ToolResult {
                content: format!(
                    "Thread '{}' failed (exit {}):\n{}",
                    thread_name, run.exit_code, details
                ),
                is_error: true,
            }
        }
        Ok(run) => {
            runtime.event_sink.emit(AgentEvent::ThreadFinished {
                name: thread_name.clone(),
                exit_code: run.exit_code,
                timed_out: false,
                timeout_reason: None,
                usage: run.usage.clone(),
            });
            ToolResult {
                content: run.stdout.trim().to_string(),
                is_error: false,
            }
        }
    };

    complete_thread_dispatch(
        runtime,
        &session_id,
        &thread_name,
        &dispatch_id,
        &tool_result,
    );
    tool_result
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
    let background_runtime = runtime.clone();
    let background_client = client.clone();
    let abort_handle = tokio::spawn(async move {
        execute_parsed_dispatch(params, &background_runtime, &background_client).await
    })
    .abort_handle();
    if !runtime
        .active_threads
        .attach_abort_handle(&thread_name, &dispatch_id, abort_handle)
    {
        return ToolResult {
            content: format!("Thread '{thread_name}' could not be started."),
            is_error: true,
        };
    }
    ToolResult {
        content: format!(
            "Thread '{thread_name}' started in the background. Use thread_wait to receive its result without blocking user guidance."
        ),
        is_error: false,
    }
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
                }
            }
            Err(join_error) => {
                return ToolResult {
                    content: format!("Internal error listing threads: {}", join_error),
                    is_error: true,
                }
            }
        };

    let mut active = runtime.active_threads.names();
    active.sort();
    let active_set = active.iter().cloned().collect::<HashSet<_>>();

    if threads.is_empty() && active.is_empty() {
        return ToolResult {
            content: "No threads in this session.".to_string(),
            is_error: false,
        };
    }

    let mut output = String::from("Threads:");
    let mut persisted_names = HashSet::new();
    for thread in threads {
        persisted_names.insert(thread.name.clone());
        let status = if active_set.contains(&thread.name) {
            "running"
        } else {
            "idle"
        };
        output.push_str(&format!(
            "\n- {} | {} | {} episodes | created {} | updated {}",
            thread.name, status, thread.episode_count, thread.created_at, thread.updated_at
        ));
        if let Some(action) = thread.latest_action.as_deref() {
            output.push_str(&format!(" | last action: {}", action));
        }
    }
    for name in active {
        if !persisted_names.contains(&name) {
            output.push_str(&format!("\n- {name} | running | no completed episodes"));
        }
    }

    ToolResult {
        content: output,
        is_error: false,
    }
}

pub async fn execute_thread_wait(args: Value, runtime: &ToolRuntime) -> ToolResult {
    let names = match require_string_array(&args, "names") {
        Ok(names) => names,
        Err(error) => return error,
    };
    if names.iter().any(|name| name.trim().is_empty()) {
        return ToolResult {
            content: "Error: 'names' entries must not be empty".to_string(),
            is_error: true,
        };
    }
    let requested_names = names.into_iter().collect::<HashSet<_>>();
    let timeout_secs = args
        .get("timeout")
        .and_then(Value::as_u64)
        .unwrap_or(runtime.thread_timeout_secs)
        .max(1);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(timeout_secs);

    loop {
        let live_updates = runtime.active_threads.live_thread_updates();
        // In all-at-once mode, ignore a model-selected subset: the user asked
        // for one response after every deployed thread has finished.
        let all_threads = HashSet::new();
        let effective_names = if live_updates {
            &requested_names
        } else {
            &all_threads
        };
        let mut active = runtime
            .active_threads
            .active_names_matching(effective_names);
        active.sort();

        if live_updates || active.is_empty() {
            let completions = runtime.active_threads.take_completions(effective_names);
            if !completions.is_empty() {
                let mut output = String::from("Thread updates:");
                for completion in completions {
                    output.push_str(&format!(
                        "\n\n## {} ({})\n{}",
                        completion.thread_name,
                        if completion.is_error {
                            "failed"
                        } else {
                            "completed"
                        },
                        completion.content.trim()
                    ));
                }
                let mut still_active = runtime
                    .active_threads
                    .active_names_matching(effective_names);
                still_active.sort();
                if !still_active.is_empty() {
                    output.push_str(&format!("\n\nStill running: {}", still_active.join(", ")));
                }
                return ToolResult {
                    content: output,
                    is_error: false,
                };
            }
        }

        let session_id = match require_session(runtime) {
            Ok(session_id) => session_id.to_string(),
            Err(error) => return error,
        };
        let store_path = runtime.store_path.clone();
        let guidance_pending = match tokio::task::spawn_blocking(move || {
            store::list_thread_steering(&store_path, &session_id).map(|records| {
                records.iter().any(|record| {
                    record.thread_name == store::ORCHESTRATOR_STEERING_TARGET
                        && record.status == "queued"
                })
            })
        })
        .await
        {
            Ok(Ok(pending)) => pending,
            Ok(Err(error)) => {
                return ToolResult {
                    content: format!("Error checking orchestrator guidance: {error}"),
                    is_error: true,
                }
            }
            Err(error) => {
                return ToolResult {
                    content: format!("Internal error checking orchestrator guidance: {error}"),
                    is_error: true,
                }
            }
        };
        if guidance_pending {
            return ToolResult {
                content: "New user guidance is pending for the orchestrator. Respond to it now; the background threads are still running.".to_string(),
                is_error: false,
            };
        }

        if active.is_empty() {
            let target = if requested_names.is_empty() || !live_updates {
                "No background threads are running.".to_string()
            } else {
                format!("None of these threads are running: {}", {
                    let mut names = requested_names.iter().cloned().collect::<Vec<_>>();
                    names.sort();
                    names.join(", ")
                })
            };
            return ToolResult {
                content: target,
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
        if tokio::time::timeout(deadline - now, runtime.active_threads.wait_for_activity())
            .await
            .is_err()
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

pub(crate) fn mark_thread_active(
    runtime: &ToolRuntime,
    thread_name: &str,
    dispatch_id: &str,
) -> bool {
    runtime.active_threads.mark(thread_name, dispatch_id)
}

#[cfg(test)]
pub(crate) fn close_thread_dispatch(
    runtime: &ToolRuntime,
    session_id: &str,
    thread_name: &str,
    dispatch_id: &str,
) {
    match runtime
        .active_threads
        .close(&runtime.store_path, session_id, thread_name, dispatch_id)
    {
        Ok(expired) => {
            for record in expired {
                runtime.event_sink.emit(AgentEvent::ThreadSteeringExpired {
                    name: record.thread_name,
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

pub(crate) fn complete_thread_dispatch(
    runtime: &ToolRuntime,
    session_id: &str,
    thread_name: &str,
    dispatch_id: &str,
    result: &ToolResult,
) {
    let completion = crate::tools::ThreadCompletion {
        thread_name: thread_name.to_string(),
        dispatch_id: dispatch_id.to_string(),
        content: result.content.clone(),
        is_error: result.is_error,
    };
    match runtime
        .active_threads
        .complete(&runtime.store_path, session_id, completion)
    {
        Ok(expired) => {
            for record in expired {
                runtime.event_sink.emit(AgentEvent::ThreadSteeringExpired {
                    name: record.thread_name,
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
    use crate::tools::test_runtime;
    use serde_json::json;
    use std::sync::Arc;

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

    fn test_runtime_with_store(label: &str) -> ToolRuntime {
        let mut runtime = test_runtime();
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        runtime.store_path = std::env::temp_dir()
            .join(format!("nac_thread_{label}_{unique}"))
            .join("store.db");
        crate::store::initialize(&runtime.store_path).unwrap();
        crate::store::insert_test_session(&runtime.store_path, "test-session");
        runtime
    }

    #[test]
    fn dispatch_definition_skills_schema_depends_on_registry() {
        assert!(dispatch_definition(None).function.parameters["properties"]
            .get("skills")
            .is_none());

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
        assert!(resolve_scheduled_skills(&json!({}), None)
            .unwrap()
            .is_empty());
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
        assert!(runtime
            .active_threads
            .queue(&runtime.store_path, "test-session", "worker", "too late",)
            .unwrap()
            .is_none());
        let _ = std::fs::remove_dir_all(runtime.store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn thread_wait_returns_a_completed_background_result() {
        let runtime = test_runtime_with_store("wait_completion");
        assert!(mark_thread_active(&runtime, "worker", "dispatch-a"));
        complete_thread_dispatch(
            &runtime,
            "test-session",
            "worker",
            "dispatch-a",
            &ToolResult {
                content: "implemented the change".to_string(),
                is_error: false,
            },
        );

        let result =
            execute_thread_wait(json!({ "names": ["worker"], "timeout": 1 }), &runtime).await;
        assert!(!result.is_error);
        assert!(result.content.contains("worker (completed)"));
        assert!(result.content.contains("implemented the change"));
        assert!(!runtime.active_threads.is_active("worker"));
        let _ = std::fs::remove_dir_all(runtime.store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn thread_wait_buffers_completions_until_all_threads_finish_when_live_updates_are_off() {
        let runtime = test_runtime_with_store("wait_for_all");
        runtime.active_threads.set_live_thread_updates(false);
        assert!(mark_thread_active(&runtime, "first", "dispatch-first"));
        assert!(mark_thread_active(&runtime, "second", "dispatch-second"));

        let waiting_runtime = runtime.clone();
        let wait = tokio::spawn(async move {
            execute_thread_wait(
                json!({ "names": ["first"], "timeout": 30 }),
                &waiting_runtime,
            )
            .await
        });
        tokio::task::yield_now().await;

        complete_thread_dispatch(
            &runtime,
            "test-session",
            "first",
            "dispatch-first",
            &ToolResult {
                content: "first result".to_string(),
                is_error: false,
            },
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(
            !wait.is_finished(),
            "the first completion must stay buffered while another thread runs"
        );

        complete_thread_dispatch(
            &runtime,
            "test-session",
            "second",
            "dispatch-second",
            &ToolResult {
                content: "second result".to_string(),
                is_error: false,
            },
        );
        let result = tokio::time::timeout(Duration::from_secs(1), wait)
            .await
            .unwrap()
            .unwrap();
        assert!(result.content.contains("first result"));
        assert!(result.content.contains("second result"));
        assert!(!runtime.active_threads.has_completions());
        let _ = std::fs::remove_dir_all(runtime.store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn thread_wait_wakes_for_new_orchestrator_guidance() {
        let runtime = test_runtime_with_store("wait_guidance");
        runtime.active_threads.set_live_thread_updates(false);
        assert!(mark_thread_active(&runtime, "worker", "dispatch-a"));
        let waiting_runtime = runtime.clone();
        let wait = tokio::spawn(async move {
            execute_thread_wait(json!({ "timeout": 30 }), &waiting_runtime).await
        });
        tokio::task::yield_now().await;

        crate::store::queue_thread_steering(
            &runtime.store_path,
            "test-session",
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            "run-a",
            "answer this now",
        )
        .unwrap();
        runtime.active_threads.signal_activity();

        let result = wait.await.unwrap();
        assert!(!result.is_error);
        assert!(result.content.contains("New user guidance is pending"));
        close_thread_dispatch(&runtime, "test-session", "worker", "dispatch-a");
        let _ = std::fs::remove_dir_all(runtime.store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn closing_all_threads_aborts_workers_and_discards_pending_completions() {
        let runtime = test_runtime_with_store("abort_all");
        assert!(mark_thread_active(
            &runtime,
            "completed",
            "dispatch-complete"
        ));
        complete_thread_dispatch(
            &runtime,
            "test-session",
            "completed",
            "dispatch-complete",
            &ToolResult {
                content: "old result".to_string(),
                is_error: false,
            },
        );
        assert!(runtime.active_threads.has_completions());

        assert!(mark_thread_active(&runtime, "running", "dispatch-running"));
        let task = tokio::spawn(std::future::pending::<()>());
        assert!(runtime.active_threads.attach_abort_handle(
            "running",
            "dispatch-running",
            task.abort_handle(),
        ));
        runtime
            .active_threads
            .close_all(&runtime.store_path, "test-session")
            .unwrap();

        assert!(task.await.unwrap_err().is_cancelled());
        assert!(runtime.active_threads.names().is_empty());
        assert!(!runtime.active_threads.has_completions());
        let _ = std::fs::remove_dir_all(runtime.store_path.parent().unwrap());
    }
}
