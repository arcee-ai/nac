use serde_json::Value;

use crate::events::AgentEvent;
use crate::model::ModelClient;
use crate::skills::SkillRegistry;
use crate::store;
use crate::tools::{require_str, require_string_array, ToolResult, ToolRuntime};
use crate::types::{ToolDefinition, TOOL_CALL_CANCELLED_MARKER};

mod worker;
#[cfg(test)]
pub(crate) use worker::worker_model_arguments_for_test;
use worker::{run_worker, WorkerInvocation, WorkerRun};

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
    let Some(cancellation) = runtime.active_threads.start(&thread_name, &dispatch_id) else {
        close_thread_dispatch(runtime, &session_id, &thread_name, &dispatch_id);
        return ToolResult {
            content: format!(
                "{TOOL_CALL_CANCELLED_MARKER} Thread '{thread_name}' was cancelled before it started."
            ),
            is_error: true,
        };
    };

    runtime.event_sink.emit(AgentEvent::ThreadStarted {
        name: thread_name.clone(),
        action: action.clone(),
        source_threads: source_threads.clone(),
    });

    // A worker commits its handoff and only then exits, so a kill or a timeout
    // can land in the gap between the two. This marks off what the thread
    // already held, so a dispatch that did answer is not recorded as a failure
    // on top of the episode it just wrote.
    let handoff_watermark = read_handoff_watermark(runtime, &session_id, &thread_name).await;

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
        cancellation,
    )
    .await;

    let run = match result {
        Ok(run) => run,
        Err(error) => {
            let message = format!("Failed to spawn thread '{}': {}", thread_name, error);
            record_dispatch_failure(
                runtime,
                &session_id,
                &thread_name,
                &action,
                store::EpisodeStatus::Error,
                &message,
            )
            .await;
            close_thread_dispatch(runtime, &session_id, &thread_name, &dispatch_id);
            runtime.event_sink.emit(AgentEvent::Error {
                thread_name: Some(thread_name.clone()),
                message: message.clone(),
            });
            runtime.event_sink.emit(AgentEvent::ThreadFinished {
                name: thread_name,
                exit_code: SPAWN_FAILURE_EXIT_CODE,
                timed_out: false,
                timeout_reason: None,
                usage: None,
            });
            return ToolResult {
                content: message,
                is_error: true,
            };
        }
    };

    let failure = classify_dispatch_failure(&run, &thread_name, timeout_secs);
    if let Some(failure) = &failure {
        if !handed_off(runtime, &session_id, &thread_name, handoff_watermark).await {
            record_dispatch_failure(
                runtime,
                &session_id,
                &thread_name,
                &action,
                failure.status,
                &failure.message,
            )
            .await;
        }
    }
    close_thread_dispatch(runtime, &session_id, &thread_name, &dispatch_id);

    // Fold worker token usage into the shared runtime accumulator so the
    // orchestrator's agent loop can include it in session totals.
    if let Some(usage) = &run.usage {
        let mut wu = runtime.worker_usage.lock().await;
        wu.add_cost_saturating(usage);
    }

    let Some(failure) = failure else {
        runtime.event_sink.emit(AgentEvent::ThreadFinished {
            name: thread_name,
            exit_code: run.exit_code,
            timed_out: false,
            timeout_reason: None,
            usage: run.usage,
        });
        return ToolResult {
            content: run.stdout.trim().to_string(),
            is_error: false,
        };
    };

    if failure.status == store::EpisodeStatus::Cancelled {
        // Deliberately no `ThreadFinished`: the stop that killed this worker
        // ends the whole run, and `RunCancelled` is what the panel reloads on.
        // A finish event here would repaint the card as an ordinary failure.
        return ToolResult {
            content: format!("{TOOL_CALL_CANCELLED_MARKER} {}", failure.message),
            is_error: true,
        };
    }

    let timed_out = failure.status == store::EpisodeStatus::TimedOut;
    runtime.event_sink.emit(AgentEvent::ThreadFinished {
        name: thread_name,
        exit_code: run.exit_code,
        timed_out,
        timeout_reason: if timed_out { run.timeout_reason } else { None },
        usage: run.usage,
    });
    ToolResult {
        content: failure.message,
        is_error: true,
    }
}

/// Exit code standing for a dispatch whose worker never ran, so the card can
/// still settle as failed instead of spinning until the run ends.
const SPAWN_FAILURE_EXIT_CODE: i32 = -1;

struct DispatchFailure {
    status: store::EpisodeStatus,
    message: String,
}

/// How a dispatch died, or `None` when the worker handed back an answer.
fn classify_dispatch_failure(
    run: &WorkerRun,
    thread_name: &str,
    timeout_secs: u64,
) -> Option<DispatchFailure> {
    if run.cancelled {
        return Some(DispatchFailure {
            status: store::EpisodeStatus::Cancelled,
            message: format!("Thread '{thread_name}' was cancelled."),
        });
    }

    if run.timed_out {
        let message = match run.timeout_reason.as_deref() {
            Some(reason) => format!(
                "Thread '{}' timed out after {}s.\n{}",
                thread_name, timeout_secs, reason
            ),
            None => format!("Thread '{}' timed out after {}s", thread_name, timeout_secs),
        };
        return Some(DispatchFailure {
            status: store::EpisodeStatus::TimedOut,
            message,
        });
    }

    if run.exit_code != 0 {
        let details = worker_failure_details(run.model_error.as_deref(), &run.stderr, &run.stdout);
        return Some(DispatchFailure {
            status: store::EpisodeStatus::Error,
            message: format!(
                "Thread '{}' failed (exit {}):\n{}",
                thread_name, run.exit_code, details
            ),
        });
    }

    None
}

/// Episodes this thread held before the dispatch started, or `None` when the
/// read failed. Without it a killed dispatch is recorded as a failure whether
/// or not it handed off, which is what happened before the watermark existed.
async fn read_handoff_watermark(
    runtime: &ToolRuntime,
    session_id: &str,
    thread_name: &str,
) -> Option<i64> {
    let store_path = runtime.store_path.clone();
    let session_id = session_id.to_string();
    let thread = thread_name.to_string();
    tokio::task::spawn_blocking(move || store::latest_episode_id(&store_path, &session_id, &thread))
        .await
        .ok()?
        .ok()
}

/// Whether the dispatch that just ended left a retained episode behind.
async fn handed_off(
    runtime: &ToolRuntime,
    session_id: &str,
    thread_name: &str,
    watermark: Option<i64>,
) -> bool {
    let Some(watermark) = watermark else {
        return false;
    };
    let store_path = runtime.store_path.clone();
    let session_id = session_id.to_string();
    let thread = thread_name.to_string();
    tokio::task::spawn_blocking(move || {
        store::has_retained_episode_after(&store_path, &session_id, &thread, watermark)
    })
    .await
    .is_ok_and(|retained| retained.unwrap_or(false))
}

/// Record a dispatch that produced no handoff. A worker only writes its own
/// episode after the model answers, so every other ending — spawn failure,
/// cancellation, timeout, non-zero exit — would otherwise leave nothing behind
/// saying what the thread had been asked to do.
///
/// Written before the dispatch is closed, and therefore before `ThreadFinished`
/// or `RunCancelled`: those are what make the panel reload episodes, and a stop
/// waits for the dispatch to close before aborting the run task that this write
/// runs in.
async fn record_dispatch_failure(
    runtime: &ToolRuntime,
    session_id: &str,
    thread_name: &str,
    action: &str,
    status: store::EpisodeStatus,
    content: &str,
) {
    let store_path = runtime.store_path.clone();
    let session_id = session_id.to_string();
    let thread = thread_name.to_string();
    let action = action.to_string();
    let content = content.to_string();
    let write = tokio::task::spawn_blocking(move || {
        store::append_episode_with_status(
            &store_path,
            &session_id,
            &thread,
            &action,
            &content,
            status,
        )
    })
    .await;

    let failure = match write {
        Ok(Ok(())) => return,
        Ok(Err(error)) => error.to_string(),
        Err(join_error) => join_error.to_string(),
    };
    runtime.event_sink.emit(AgentEvent::Error {
        thread_name: Some(thread_name.to_string()),
        message: format!("failed to record the outcome of thread '{thread_name}': {failure}"),
    });
}

fn worker_failure_details(model_error: Option<&str>, stderr: &str, stdout: &str) -> String {
    let model_error = model_error
        .map(str::trim)
        .filter(|message| !message.is_empty());
    let stderr = stderr.trim();
    if let Some(model_error) = model_error {
        if stderr.is_empty() {
            return model_error.to_string();
        }
        return format!("{model_error}\n\nWorker diagnostics:\n{stderr}");
    }
    if !stderr.is_empty() {
        stderr.to_string()
    } else if !stdout.trim().is_empty() {
        stdout.trim().to_string()
    } else {
        "no output".to_string()
    }
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
    let result = execute_parsed_dispatch(params, runtime, client).await;
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
                }
            }
            Err(join_error) => {
                return ToolResult {
                    content: format!("Internal error listing threads: {}", join_error),
                    is_error: true,
                }
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
    fn worker_failure_prioritizes_model_error_and_preserves_diagnostics() {
        assert_eq!(
            worker_failure_details(
                Some("provider overloaded"),
                "pid file already exists\nMCP unavailable",
                "partial stdout",
            ),
            "provider overloaded\n\nWorker diagnostics:\npid file already exists\nMCP unavailable"
        );
        assert_eq!(
            worker_failure_details(Some("  provider overloaded  "), " \n", "partial stdout"),
            "provider overloaded"
        );
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn failed_dispatch_reports_latest_model_error_before_ordered_diagnostics() {
        use std::os::unix::fs::PermissionsExt;

        let root =
            std::env::temp_dir().join(format!("nac_dispatch_error_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("worker.sh");
        let model_started = serde_json::to_string(&AgentEvent::ModelCallStarted {
            thread_name: Some("worker".to_string()),
            iteration: 2,
        })
        .unwrap();
        let first = serde_json::to_string(&AgentEvent::ModelError {
            thread_name: Some("worker".to_string()),
            message: "first provider error".to_string(),
        })
        .unwrap();
        let second = serde_json::to_string(&AgentEvent::ModelError {
            thread_name: Some("worker".to_string()),
            message: "latest provider error\nrequest-id: safe".to_string(),
        })
        .unwrap();
        let script = format!(
            "#!/bin/sh\nprintf '%s\\n' '{prefix}{model_started}' >&2\n\
             printf '%s\\n' '{prefix}{first}' >&2\n\
             printf '%s\\n' 'pid file already exists' >&2\n\
             printf '%s\\n' '{prefix}{second}' >&2\n\
             printf '%s\\n' 'MCP unavailable' >&2\n\
             printf '%s\\n' 'partial stdout'\nexit 1\n",
            prefix = crate::events::STDERR_EVENT_PREFIX,
        );
        std::fs::write(&executable, script).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();

        let mut runtime = test_runtime();
        runtime.workspace_cwd = root.clone();
        runtime.config_cwd = root.clone();
        runtime.worker_executable = Some(executable);
        let params = ParsedDispatchParams {
            thread_name: "worker".to_string(),
            dispatch_id: "dispatch".to_string(),
            action: "fail".to_string(),
            source_threads: Vec::new(),
            scheduled_skills: Vec::new(),
            session_id: "test-session".to_string(),
            timeout_secs: 30,
        };
        assert!(mark_thread_active(&runtime, "worker", "dispatch"));

        let result = execute_parsed_dispatch(params, &runtime, &ModelClient::new_for_test()).await;

        assert!(result.is_error);
        assert_eq!(
            result.content,
            "Thread 'worker' failed (exit 1):\n\
             latest provider error\nrequest-id: safe\n\n\
             Worker diagnostics:\npid file already exists\nMCP unavailable"
        );
        assert!(!result.content.contains(crate::events::STDERR_EVENT_PREFIX));
        assert!(!is_thread_active(&runtime, "worker"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn worker_failure_preserves_existing_output_fallbacks() {
        assert_eq!(
            worker_failure_details(None, " stderr details ", "stdout details"),
            "stderr details"
        );
        assert_eq!(
            worker_failure_details(None, " \n", " stdout details "),
            "stdout details"
        );
        assert_eq!(worker_failure_details(None, "", ""), "no output");
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
}
