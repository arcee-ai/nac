use std::collections::BTreeMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::time::timeout;

use crate::events::{decode_stderr_event, AgentEvent};
use crate::model::{ModelClient, TokenUsage};
use crate::process::{isolate_process_group, terminate_child_tree};
use crate::tools::ToolRuntime;

pub(super) struct WorkerRun {
    pub(super) stdout: String,
    pub(super) stderr: String,
    pub(super) exit_code: i32,
    pub(super) timed_out: bool,
    pub(super) timeout_reason: Option<String>,
    pub(super) usage: Option<TokenUsage>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ActiveToolCallTrace {
    name: String,
    args_detail: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
enum TimeoutLocation {
    #[default]
    Startup,
    ModelApi {
        iteration: usize,
    },
    ToolCall,
    BetweenToolAndModel,
    Finalizing,
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
            AgentEvent::Error { .. }
            | AgentEvent::ModelError { .. }
            | AgentEvent::TokenUsageUpdated { .. }
            | AgentEvent::ThreadLog { .. }
            | AgentEvent::ThreadSteeringQueued { .. }
            | AgentEvent::ThreadSteeringDelivered { .. }
            | AgentEvent::ThreadSteeringExpired { .. }
            | AgentEvent::OrchestratorSteeringQueued { .. }
            | AgentEvent::OrchestratorSteeringDelivered { .. }
            | AgentEvent::OrchestratorSteeringExpired { .. }
            | AgentEvent::OrchestratorCompactionStarted { .. }
            | AgentEvent::OrchestratorCompactionCompleted { .. }
            | AgentEvent::OrchestratorCompactionSkipped { .. }
            | AgentEvent::OrchestratorCompactionFailed { .. } => {}
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

pub(super) struct WorkerInvocation<'a> {
    pub(super) session_id: &'a str,
    pub(super) thread_name: &'a str,
    pub(super) dispatch_id: &'a str,
    pub(super) action: &'a str,
    pub(super) source_threads: &'a [String],
    pub(super) scheduled_skills: &'a [String],
    pub(super) timeout_secs: u64,
}

fn append_worker_model_arguments(command: &mut Command, client: &ModelClient) {
    command
        .arg("--api-model")
        .arg(client.model.as_str())
        .arg("--api-base-url")
        .arg(client.base_url())
        .arg("--backend")
        .arg(client.backend().as_str());

    if let Some(reasoning_effort) = client.reasoning_effort() {
        command.arg("--effort").arg(reasoning_effort.as_str());
    }
    if let Some(api_key_env) = client.api_key_env() {
        command.arg("--api-key-env").arg(api_key_env);
    }

    // Always transport the snapshot header map, including `{}`, so workers can
    // never reinterpret an empty map as permission to consult config.toml.
    let headers = serde_json::to_string(client.extra_headers())
        .expect("serializing a string header map cannot fail");
    command.arg("--extra-headers").arg(headers);
}

#[cfg(test)]
pub(crate) fn worker_model_arguments_for_test(client: &ModelClient) -> Vec<String> {
    let mut command = Command::new("worker");
    append_worker_model_arguments(&mut command, client);
    command
        .as_std()
        .get_args()
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect()
}

pub(super) async fn run_worker(
    runtime: &ToolRuntime,
    client: &ModelClient,
    invocation: WorkerInvocation<'_>,
) -> std::io::Result<WorkerRun> {
    let executable = runtime.worker_executable.clone().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "worker executable path was not configured; cannot spawn managed worker",
        )
    })?;
    let mut command = Command::new(executable);
    if runtime.backend.workspace_cwd_is_local() {
        command.current_dir(&runtime.workspace_cwd);
    }
    command
        .arg("__worker")
        .arg("--session-id")
        .arg(invocation.session_id)
        .arg("--thread-name")
        .arg(invocation.thread_name)
        .arg("--dispatch-id")
        .arg(invocation.dispatch_id)
        .arg("--action")
        .arg(invocation.action)
        .arg("--store-path")
        .arg(runtime.store_path.as_os_str())
        .arg("--workspace-cwd")
        .arg(runtime.workspace_cwd.as_os_str());
    append_worker_model_arguments(&mut command, client);

    if !runtime.backend.workspace_cwd_is_local() || runtime.config_cwd != runtime.workspace_cwd {
        command
            .arg("--config-cwd")
            .arg(runtime.config_cwd.as_os_str());
    }

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for source_thread in invocation.source_threads {
        command.arg("--source-thread").arg(source_thread);
    }
    for skill in invocation.scheduled_skills {
        command.arg("--skill").arg(skill);
    }
    command.args(runtime.backend.worker_cli_args());
    isolate_process_group(&mut command);
    command.kill_on_drop(true);

    let mut child = command.spawn()?;

    let timeout_trace = Arc::new(Mutex::new(WorkerTimeoutTrace::default()));
    let stderr = child.stderr.take().unwrap();
    let event_sink = runtime.event_sink.clone();
    let thread_name_for_logs = invocation.thread_name.to_string();
    let timeout_trace_for_logs = timeout_trace.clone();
    let stderr_handle = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        let mut output = String::new();
        let mut worker_usage = TokenUsage::default();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(event) = decode_stderr_event(&line) {
                timeout_trace_for_logs.lock().await.observe(&event);
                if let AgentEvent::AssistantMessage {
                    usage: Some(usage), ..
                } = &event
                {
                    worker_usage += usage.clone();
                }
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
        let usage = if worker_usage.input_tokens == 0
            && worker_usage.output_tokens == 0
            && worker_usage.cache_read_tokens == 0
            && worker_usage.cache_write_tokens == 0
        {
            None
        } else {
            Some(worker_usage)
        };
        (output, usage)
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

    let status = timeout(Duration::from_secs(invocation.timeout_secs), child.wait()).await;
    let timed_out = status.is_err();
    if timed_out {
        terminate_child_tree(&mut child).await;
    }

    let (stderr, worker_usage) = stderr_handle.await.unwrap_or_default();
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
        usage: worker_usage,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{BackendKind, EffectiveModelSettings};
    use crate::TEST_ENV_LOCK;

    #[test]
    fn worker_model_transport_is_complete_with_absent_effort_and_empty_headers() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let key_name = "NAC_WORKER_TRANSPORT_TEST_KEY";
        let original = std::env::var_os(key_name);
        unsafe { std::env::set_var(key_name, "test-key") };

        let client = ModelClient::from_effective_settings(
            EffectiveModelSettings::new(
                BackendKind::TogetherChat,
                "snapshot-model".to_string(),
                "https://snapshot.example/v1".to_string(),
                None,
                Some(key_name.to_string()),
                BTreeMap::new(),
            )
            .unwrap(),
        )
        .unwrap();
        let mut command = Command::new("worker");
        append_worker_model_arguments(&mut command, &client);
        let args = command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(
            args,
            vec![
                "--api-model",
                "snapshot-model",
                "--api-base-url",
                "https://snapshot.example/v1",
                "--backend",
                "together-chat",
                "--api-key-env",
                key_name,
                "--extra-headers",
                "{}",
            ]
        );
        assert!(!args.iter().any(|arg| arg == "--effort"));

        match original {
            Some(value) => unsafe { std::env::set_var(key_name, value) },
            None => unsafe { std::env::remove_var(key_name) },
        }
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
            name: "exec_command".to_string(),
            args_preview: "cargo test -p nac-core".to_string(),
            key_arg_preview: None,
            args_detail: Some(
                r#"{"cmd":"cargo test -p nac-core","tty":false,"yield_time_ms":300000}"#
                    .to_string(),
            ),
        });

        assert_eq!(
            trace.timeout_reason(),
            "The thread timed out at a tool call.\nTool call: exec_command call_123\narguments: {\"cmd\":\"cargo test -p nac-core\",\"tty\":false,\"yield_time_ms\":300000}"
        );
    }
}
