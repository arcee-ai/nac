use serde_json::Value;

use crate::events::AgentEvent;
use crate::model::{ModelClient, ThreadComplexity};
use crate::skills::SkillRegistry;
use crate::store;
use crate::tools::{require_str, require_string_array, ToolResult, ToolRuntime};
use crate::types::ToolDefinition;

mod worker;
#[cfg(test)]
pub(crate) use worker::worker_model_arguments_for_test;
use worker::{run_worker, WorkerInvocation};

/// The three tier worker clients a mixed-mode session resolves at
/// launch/resume. Each client carries its own catalog metadata, so dispatch
/// routing and prompt descriptions share the same identities.
#[derive(Clone)]
pub(crate) struct MixedDispatchClients {
    pub easy: ModelClient,
    pub medium: ModelClient,
    pub hard: ModelClient,
}

impl MixedDispatchClients {
    pub fn for_tier(&self, complexity: ThreadComplexity) -> &ModelClient {
        match complexity {
            ThreadComplexity::Easy => &self.easy,
            ThreadComplexity::Medium => &self.medium,
            ThreadComplexity::Hard => &self.hard,
        }
    }

    pub fn tiers(&self) -> [(ThreadComplexity, &ModelClient); 3] {
        [
            (ThreadComplexity::Easy, &self.easy),
            (ThreadComplexity::Medium, &self.medium),
            (ThreadComplexity::Hard, &self.hard),
        ]
    }

    pub fn describe_tiers(&self) -> String {
        let mut description = String::new();
        for (complexity, client) in self.tiers() {
            let mut traits = Vec::new();
            if let Some(effort) = client.reasoning_effort() {
                traits.push(format!("effort: {effort}"));
            }
            let cost = client.cost_rates();
            if cost.input > 0.0 || cost.output > 0.0 {
                traits.push(format!(
                    "~${}/${} per 1M tokens in/out",
                    cost.input, cost.output
                ));
            }
            let traits = if traits.is_empty() {
                String::new()
            } else {
                format!(" ({})", traits.join(", "))
            };
            description.push_str(&format!(
                "\n- {}: {}{}",
                complexity.as_str(),
                client.model,
                traits
            ));
        }
        description
    }
}

pub const DEFAULT_THREAD_TIMEOUT_SECS: u64 = 60 * 60;
pub const MIN_THREAD_TIMEOUT_SECS: u64 = 30 * 60;

pub fn dispatch_definition(
    skills: Option<&SkillRegistry>,
    mixed: Option<&MixedDispatchClients>,
) -> ToolDefinition {
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

    if let Some(mixed) = mixed {
        parameters["properties"]["complexity"] = json!({
            "type": "string",
            "enum": ["easy", "medium", "hard"],
            "description": format!(
                "Difficulty classification for this dispatch; selects the configured tier:{}",
                mixed.describe_tiers()
            )
        });
        parameters["required"] = json!(["name", "action", "complexity"]);
    }

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
    /// Mixed-mode difficulty tier; `None` outside mixed mode.
    pub complexity: Option<ThreadComplexity>,
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
    let complexity = parse_mixed_complexity(args, runtime)?;

    Ok(ParsedDispatchParams {
        thread_name,
        dispatch_id: uuid::Uuid::new_v4().to_string(),
        action,
        source_threads,
        scheduled_skills,
        session_id,
        timeout_secs,
        complexity,
    })
}

/// Parse the mixed-only `complexity` argument. Outside mixed mode it is
/// ignored and stays `None`, preserving single-model behavior. In mixed
/// mode it is required.
fn parse_mixed_complexity(
    args: &Value,
    runtime: &ToolRuntime,
) -> Result<Option<ThreadComplexity>, ToolResult> {
    if runtime.mixed_clients.is_none() {
        return Ok(None);
    }
    require_str(args, "complexity")
        .and_then(|raw| {
            raw.parse::<ThreadComplexity>().map_err(|error| ToolResult {
                content: format!("Error: {}", error),
                is_error: true,
            })
        })
        .map(Some)
}

/// Select the model client a dispatch runs with. Outside mixed mode this is
/// the orchestrator client, unchanged. In mixed mode the parsed complexity
/// picks the pre-resolved tier client. A crossed routing state is an invariant
/// error, never permission to run on the wrong model.
pub(crate) fn select_dispatch_client(
    params: &ParsedDispatchParams,
    runtime: &ToolRuntime,
    orchestrator_client: &ModelClient,
) -> Result<ModelClient, ToolResult> {
    match (runtime.mixed_clients.as_deref(), params.complexity) {
        (None, None) => Ok(orchestrator_client.clone()),
        (Some(mixed), Some(complexity)) => Ok(mixed.for_tier(complexity).clone()),
        (Some(_), None) => Err(ToolResult {
            content: "Error: mixed-mode dispatch is missing its required complexity".to_string(),
            is_error: true,
        }),
        (None, Some(_)) => Err(ToolResult {
            content: "Error: single-model dispatch unexpectedly has a complexity".to_string(),
            is_error: true,
        }),
    }
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
        complexity: _,
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

    close_thread_dispatch(runtime, &session_id, &thread_name, &dispatch_id);

    // Fold worker token usage into the shared runtime accumulator so the
    // orchestrator's agent loop can include it in session totals.
    if let Ok(run) = &result {
        if let Some(usage) = &run.usage {
            let mut wu = runtime.worker_usage.lock().await;
            wu.add_cost_saturating(&usage);
        }
    }

    match result {
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
    let client = match select_dispatch_client(&params, runtime, client) {
        Ok(client) => client,
        Err(error) => return error,
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
    let result = execute_parsed_dispatch(params, runtime, &client).await;
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
        assert!(
            dispatch_definition(None, None).function.parameters["properties"]
                .get("skills")
                .is_none()
        );

        let registry = test_registry();
        let definition = dispatch_definition(Some(&registry), None);
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

    // ------------------------------------------------------------------
    // mixed mode
    // ------------------------------------------------------------------

    fn routing_client(
        backend: crate::model::BackendKind,
        model: &str,
        effort: crate::model::ReasoningEffort,
    ) -> ModelClient {
        ModelClient::new_for_test_settings(backend, model, effort)
    }

    fn mixed_runtime() -> ToolRuntime {
        use crate::model::{BackendKind, ReasoningEffort};

        let mut runtime = test_runtime();
        runtime.mixed_clients = Some(Arc::new(MixedDispatchClients {
            easy: routing_client(
                BackendKind::AnthropicMessages,
                "easy-model",
                ReasoningEffort::Low,
            ),
            medium: routing_client(
                BackendKind::TogetherChat,
                "medium-model",
                ReasoningEffort::Medium,
            ),
            hard: routing_client(
                BackendKind::FireworksChat,
                "hard-model",
                ReasoningEffort::High,
            ),
        }));
        runtime
    }

    #[test]
    fn dispatch_definition_mixed_mode_requires_complexity() {
        let clients = MixedDispatchClients {
            easy: ModelClient::new_for_test(),
            medium: ModelClient::new_for_test(),
            hard: ModelClient::new_for_test(),
        };
        let definition = dispatch_definition(None, Some(&clients));
        let parameters = &definition.function.parameters;
        assert_eq!(
            parameters["properties"]["complexity"]["enum"],
            json!(["easy", "medium", "hard"])
        );
        assert_eq!(
            parameters["required"],
            json!(["name", "action", "complexity"])
        );

        // Single mode keeps the schema untouched.
        let single = dispatch_definition(None, None);
        assert!(single.function.parameters["properties"]
            .get("complexity")
            .is_none());
        assert_eq!(
            single.function.parameters["required"],
            json!(["name", "action"])
        );
    }

    #[test]
    fn parse_dispatch_args_requires_complexity_in_mixed_mode() {
        let runtime = mixed_runtime();
        let err =
            parse_dispatch_args(&json!({ "name": "t1", "action": "work" }), &runtime).unwrap_err();
        assert!(err.is_error);
        assert!(err.content.contains("'complexity'"));

        let err = parse_dispatch_args(
            &json!({ "name": "t1", "action": "work", "complexity": "extreme" }),
            &runtime,
        )
        .unwrap_err();
        assert!(err.content.contains("unsupported complexity"));

        let params = parse_dispatch_args(
            &json!({ "name": "t1", "action": "work", "complexity": "hard" }),
            &runtime,
        )
        .unwrap();
        assert_eq!(params.complexity, Some(ThreadComplexity::Hard));
    }

    #[test]
    fn parse_dispatch_args_ignores_complexity_outside_mixed_mode() {
        let runtime = test_runtime();
        let params =
            parse_dispatch_args(&json!({ "name": "t1", "action": "work" }), &runtime).unwrap();
        assert_eq!(params.complexity, None);
    }

    #[test]
    fn select_dispatch_client_routes_distinct_tier_identities() {
        use crate::model::{BackendKind, ReasoningEffort};

        let orchestrator = routing_client(
            BackendKind::OpenAiResponses,
            "orchestrator-model",
            ReasoningEffort::Xhigh,
        );

        let runtime = test_runtime();
        let params =
            parse_dispatch_args(&json!({ "name": "t1", "action": "w" }), &runtime).unwrap();
        let client = select_dispatch_client(&params, &runtime, &orchestrator).unwrap();
        assert_eq!(client.model, "orchestrator-model");
        assert_eq!(client.backend(), BackendKind::OpenAiResponses);
        assert_eq!(client.reasoning_effort(), Some(ReasoningEffort::Xhigh));

        let runtime = mixed_runtime();
        let expected = [
            (
                "easy",
                "easy-model",
                BackendKind::AnthropicMessages,
                ReasoningEffort::Low,
            ),
            (
                "medium",
                "medium-model",
                BackendKind::TogetherChat,
                ReasoningEffort::Medium,
            ),
            (
                "hard",
                "hard-model",
                BackendKind::FireworksChat,
                ReasoningEffort::High,
            ),
        ];
        for (complexity, model, backend, effort) in expected {
            let params = parse_dispatch_args(
                &json!({ "name": "t1", "action": "w", "complexity": complexity }),
                &runtime,
            )
            .unwrap();
            let client = select_dispatch_client(&params, &runtime, &orchestrator).unwrap();
            assert_eq!(client.model, model);
            assert_eq!(client.backend(), backend);
            assert_eq!(client.reasoning_effort(), Some(effort));
        }
    }

    #[test]
    fn selected_tier_identity_reaches_worker_cli_transport() {
        use crate::model::{BackendKind, ReasoningEffort};

        let runtime = mixed_runtime();
        let orchestrator = routing_client(
            BackendKind::OpenAiResponses,
            "orchestrator-model",
            ReasoningEffort::Xhigh,
        );
        let params = parse_dispatch_args(
            &json!({ "name": "t1", "action": "w", "complexity": "hard" }),
            &runtime,
        )
        .unwrap();
        let selected = select_dispatch_client(&params, &runtime, &orchestrator).unwrap();

        assert_eq!(
            super::worker::worker_model_arguments_for_test(&selected),
            vec![
                "--api-model",
                "hard-model",
                "--api-base-url",
                "https://api.openai.com/v1",
                "--backend",
                "fireworks-chat",
                "--effort",
                "high",
                "--extra-headers",
                "{}",
            ]
        );
    }

    #[test]
    fn select_dispatch_client_rejects_crossed_routing_state() {
        let orchestrator = ModelClient::new_for_test();

        let mixed = mixed_runtime();
        let params =
            parse_dispatch_args(&json!({ "name": "t1", "action": "w" }), &test_runtime()).unwrap();
        let error = select_dispatch_client(&params, &mixed, &orchestrator).unwrap_err();
        assert!(error.is_error);
        assert!(error.content.contains("missing its required complexity"));

        let params = parse_dispatch_args(
            &json!({ "name": "t1", "action": "w", "complexity": "easy" }),
            &mixed,
        )
        .unwrap();
        let error = select_dispatch_client(&params, &test_runtime(), &orchestrator).unwrap_err();
        assert!(error.is_error);
        assert!(error.content.contains("unexpectedly has a complexity"));
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
