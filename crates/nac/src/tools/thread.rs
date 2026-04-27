use std::collections::BTreeMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::time::timeout;

use crate::api::ModelClient;
use crate::events::{decode_stderr_event, AgentEvent};
use crate::process::{isolate_process_group, terminate_child_tree};
use crate::store;
use crate::tools::{require_str, require_string_array, ToolResult, ToolRuntime};
use crate::types::ToolDefinition;

const DEFAULT_THREAD_TIMEOUT_SECS: u64 = 60 * 60;
const MIN_THREAD_TIMEOUT_SECS: u64 = 30 * 60;

pub fn dispatch_definition() -> ToolDefinition {
    use serde_json::json;
    def(
        "thread",
        "Dispatch a named worker thread. The worker reuses its own retained history and can pull the latest retained episode from other named threads. Default timeout is 3600 seconds; minimum timeout is 1800 seconds.",
        json!({
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
        }),
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

pub async fn execute_dispatch(
    args: Value,
    runtime: &ToolRuntime,
    client: &ModelClient,
) -> ToolResult {
    let thread_name = match require_str(&args, "name") {
        Ok(s) => s,
        Err(e) => return e,
    };
    let action = match require_str(&args, "action") {
        Ok(s) => s,
        Err(e) => return e,
    };
    let source_threads = match require_string_array(&args, "threads") {
        Ok(v) => v,
        Err(e) => return e,
    };
    let session_id = match require_session(runtime) {
        Ok(s) => s.to_string(),
        Err(e) => return e,
    };

    if !mark_thread_active(runtime, &thread_name).await {
        return ToolResult {
            content: format!(
                "Thread '{}' is already running; retry after the current dispatch completes.",
                thread_name
            ),
            is_error: true,
        };
    }

    let timeout_secs = resolve_thread_timeout_secs(&args);

    runtime.event_sink.emit(AgentEvent::ThreadStarted {
        name: thread_name.clone(),
        action: action.clone(),
        source_threads: source_threads.clone(),
    });

    let result = run_worker(
        runtime,
        client,
        &session_id,
        &thread_name,
        &action,
        &source_threads,
        timeout_secs,
    )
    .await;
    unmark_thread_active(runtime, &thread_name).await;

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
            });
            ToolResult {
                content: match timeout_reason {
                    Some(reason) => {
                        format!(
                            "Thread '{}' timed out after {}s.\n{}",
                            thread_name, timeout_secs, reason
                        )
                    }
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
            });
            ToolResult {
                content: run.stdout.trim().to_string(),
                is_error: false,
            }
        }
    }
}

pub async fn execute_threads(runtime: &ToolRuntime) -> ToolResult {
    let session_id = match require_session(runtime) {
        Ok(s) => s.to_string(),
        Err(e) => return e,
    };

    let store_path = runtime.store_path.clone();
    let sid = session_id.clone();
    let threads = match tokio::task::spawn_blocking(move || {
        store::list_threads(&store_path, &sid)
    }).await {
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
    match tokio::task::spawn_blocking(move || {
        store::thread_read(&store_path, &sid, &tname)
    }).await {
        Ok(Ok(episodes)) => ToolResult {
            content: store::render_thread_document(&thread_name, &episodes),
            is_error: false,
        },
        Ok(Err(error)) => ToolResult {
            content: format!("Error reading thread '{}': {}", thread_name, error),
            is_error: true,
        },
        Err(join_error) => ToolResult {
            content: format!("Internal error reading thread '{}': {}", thread_name, join_error),
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

    if is_thread_active(runtime, &thread_name).await {
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
    match tokio::task::spawn_blocking(move || {
        store::delete_thread(&store_path, &sid, &tname)
    }).await {
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
            content: format!("Internal error deleting thread '{}': {}", thread_name, join_error),
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

fn resolve_thread_timeout_secs(args: &Value) -> u64 {
    args.get("timeout")
        .and_then(|v| v.as_u64())
        .or_else(|| {
            std::env::var("AGENT_THREAD_TIMEOUT")
                .ok()
                .and_then(|v| v.parse().ok())
        })
        .unwrap_or(DEFAULT_THREAD_TIMEOUT_SECS)
        .max(MIN_THREAD_TIMEOUT_SECS)
}

async fn mark_thread_active(runtime: &ToolRuntime, thread_name: &str) -> bool {
    let mut active = runtime.active_threads.lock().await;
    if active.contains(thread_name) {
        false
    } else {
        active.insert(thread_name.to_string());
        true
    }
}

async fn unmark_thread_active(runtime: &ToolRuntime, thread_name: &str) {
    runtime.active_threads.lock().await.remove(thread_name);
}

async fn is_thread_active(runtime: &ToolRuntime, thread_name: &str) -> bool {
    runtime.active_threads.lock().await.contains(thread_name)
}

struct WorkerRun {
    stdout: String,
    stderr: String,
    exit_code: i32,
    timed_out: bool,
    timeout_reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ActiveToolCallTrace {
    name: String,
    args_detail: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum TimeoutLocation {
    Startup,
    ModelApi { iteration: usize },
    ToolCall,
    BetweenToolAndModel,
    Finalizing,
}

impl Default for TimeoutLocation {
    fn default() -> Self {
        Self::Startup
    }
}

#[derive(Default)]
struct WorkerTimeoutTrace {
    location: TimeoutLocation,
    active_tool_calls: BTreeMap<String, ActiveToolCallTrace>,
}

impl WorkerTimeoutTrace {
    fn observe(&mut self, event: &AgentEvent) {
        match event {
            AgentEvent::RunStarted { .. } => {
                self.location = TimeoutLocation::Startup;
                self.active_tool_calls.clear();
            }
            AgentEvent::ModelCallStarted { iteration, .. } => {
                self.location = TimeoutLocation::ModelApi {
                    iteration: *iteration,
                };
                self.active_tool_calls.clear();
            }
            AgentEvent::ToolCallStarted {
                call_id,
                name,
                args_detail,
                ..
            } => {
                self.location = TimeoutLocation::ToolCall;
                self.active_tool_calls.insert(
                    call_id.clone(),
                    ActiveToolCallTrace {
                        name: name.clone(),
                        args_detail: args_detail.clone(),
                    },
                );
            }
            AgentEvent::ToolCallFinished { call_id, .. } => {
                self.active_tool_calls.remove(call_id);
                if self.active_tool_calls.is_empty() {
                    self.location = TimeoutLocation::BetweenToolAndModel;
                } else {
                    self.location = TimeoutLocation::ToolCall;
                }
            }
            AgentEvent::AssistantMessage { .. } | AgentEvent::RunFinished { .. } => {
                self.location = TimeoutLocation::Finalizing;
                self.active_tool_calls.clear();
            }
            AgentEvent::Error { .. } | AgentEvent::ThreadLog { .. } => {}
            AgentEvent::ThreadStarted { .. } | AgentEvent::ThreadFinished { .. } => {}
        }
    }

    fn timeout_reason(&self) -> String {
        match &self.location {
            TimeoutLocation::ModelApi { iteration } => format!(
                "The thread timed out at a call to the model API.\nModel call: iteration {}",
                iteration
            ),
            TimeoutLocation::ToolCall if !self.active_tool_calls.is_empty() => {
                if self.active_tool_calls.len() == 1 {
                    let (call_id, call) = self.active_tool_calls.iter().next().unwrap();
                    return format!(
                        "The thread timed out at a tool call.\nTool call: {} {}\narguments: {}",
                        call.name,
                        call_id,
                        call.args_detail.as_deref().unwrap_or("<not captured>")
                    );
                }

                let mut reason = String::from("The thread timed out at tool calls:");
                for (call_id, call) in &self.active_tool_calls {
                    reason.push_str(&format!("\n- {} {}", call.name, call_id));
                    match call.args_detail.as_deref() {
                        Some(args_detail) => {
                            reason.push_str(&format!("\n  arguments: {}", args_detail));
                        }
                        None => reason.push_str("\n  arguments: <not captured>"),
                    }
                }
                reason
            }
            TimeoutLocation::BetweenToolAndModel => {
                "The thread timed out after tool call completion while preparing the next model API call."
                    .to_string()
            }
            TimeoutLocation::Finalizing => {
                "The thread timed out after producing a final response while the worker was exiting."
                    .to_string()
            }
            TimeoutLocation::Startup | TimeoutLocation::ToolCall => {
                "The thread timed out before entering a model API call or tool call.".to_string()
            }
        }
    }
}

async fn run_worker(
    runtime: &ToolRuntime,
    client: &ModelClient,
    session_id: &str,
    thread_name: &str,
    action: &str,
    source_threads: &[String],
    timeout_secs: u64,
) -> std::io::Result<WorkerRun> {
    let executable = std::env::current_exe()?;
    let mut command = Command::new(executable);
    command
        .arg("--worker")
        .arg("--session-id")
        .arg(session_id)
        .arg("--thread-name")
        .arg(thread_name)
        .arg("--action")
        .arg(action)
        .arg("--api-model")
        .arg(client.model.as_str())
        .arg("--api-base-url")
        .arg(client.base_url())
        .arg("--backend")
        .arg(client.backend().as_str())
        .arg("--store-path")
        .arg(runtime.store_path.as_os_str())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(reasoning_effort) = client.reasoning_effort() {
        command.arg("--effort").arg(reasoning_effort.as_str());
    }

    for source_thread in source_threads {
        command.arg("--source-thread").arg(source_thread);
    }
    if let Some(sandbox) = &runtime.sandbox {
        command.args(sandbox.worker_cli_args());
    }
    isolate_process_group(&mut command);

    let mut child = command.spawn()?;

    let timeout_trace = Arc::new(Mutex::new(WorkerTimeoutTrace::default()));
    let stderr = child.stderr.take().unwrap();
    let event_sink = runtime.event_sink.clone();
    let thread_name_for_logs = thread_name.to_string();
    let timeout_trace_for_logs = timeout_trace.clone();
    let stderr_handle = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        let mut output = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(event) = decode_stderr_event(&line) {
                timeout_trace_for_logs.lock().await.observe(&event);
                event_sink.emit(event);
            } else {
                event_sink.emit(AgentEvent::ThreadLog {
                    name: thread_name_for_logs.clone(),
                    line: line.clone(),
                });
                if !output.is_empty() {
                    output.push('\n');
                }
                output.push_str(&line);
            }
        }
        output
    });

    let stdout = child.stdout.take().unwrap();
    let stdout_handle = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut output = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if !output.is_empty() {
                output.push('\n');
            }
            output.push_str(&line);
        }
        output
    });

    let status = timeout(Duration::from_secs(timeout_secs), child.wait()).await;
    let timed_out = status.is_err();
    if timed_out {
        terminate_child_tree(&mut child).await;
    }

    let stderr = stderr_handle.await.unwrap_or_default();
    let stdout = stdout_handle.await.unwrap_or_default();
    let timeout_reason = if timed_out {
        Some(timeout_trace.lock().await.timeout_reason())
    } else {
        None
    };
    let exit_code = match status {
        Ok(wait_result) => wait_result?.code().unwrap_or(-1),
        Err(_) => -1,
    };

    Ok(WorkerRun {
        stdout,
        stderr,
        exit_code,
        timed_out,
        timeout_reason,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::ffi::OsString;

    fn restore_env(name: &str, value: Option<OsString>) {
        match value {
            Some(value) => unsafe { std::env::set_var(name, value) },
            None => unsafe { std::env::remove_var(name) },
        }
    }

    #[test]
    fn thread_timeout_defaults_to_one_hour() {
        let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
        let original = std::env::var_os("AGENT_THREAD_TIMEOUT");
        unsafe {
            std::env::remove_var("AGENT_THREAD_TIMEOUT");
        }

        assert_eq!(resolve_thread_timeout_secs(&json!({})), 60 * 60);

        restore_env("AGENT_THREAD_TIMEOUT", original);
    }

    #[test]
    fn thread_timeout_is_clamped_to_thirty_minutes() {
        let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
        let original = std::env::var_os("AGENT_THREAD_TIMEOUT");
        unsafe {
            std::env::set_var("AGENT_THREAD_TIMEOUT", "10");
        }

        assert_eq!(resolve_thread_timeout_secs(&json!({})), 30 * 60);
        assert_eq!(
            resolve_thread_timeout_secs(&json!({ "timeout": 20 })),
            30 * 60
        );
        assert_eq!(
            resolve_thread_timeout_secs(&json!({ "timeout": 7200 })),
            7200
        );

        restore_env("AGENT_THREAD_TIMEOUT", original);
    }

    #[test]
    fn timeout_trace_reports_model_api_location() {
        let mut trace = WorkerTimeoutTrace::default();
        trace.observe(&AgentEvent::ModelCallStarted {
            thread_name: Some("impl/auth".to_string()),
            iteration: 2,
        });

        assert_eq!(
            trace.timeout_reason(),
            "The thread timed out at a call to the model API.\nModel call: iteration 2"
        );
    }

    #[test]
    fn timeout_trace_reports_active_tool_call_details() {
        let mut trace = WorkerTimeoutTrace::default();
        trace.observe(&AgentEvent::ToolCallStarted {
            thread_name: Some("impl/auth".to_string()),
            call_id: "call_123".to_string(),
            name: "bash".to_string(),
            args_preview: "cargo test -p nac".to_string(),
            args_detail: Some(r#"{"command":"cargo test -p nac","timeout":300}"#.to_string()),
        });

        assert_eq!(
            trace.timeout_reason(),
            "The thread timed out at a tool call.\nTool call: bash call_123\narguments: {\"command\":\"cargo test -p nac\",\"timeout\":300}"
        );
    }
}
