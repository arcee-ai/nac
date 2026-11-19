use crate::managed_native_credentials::ManagedNativeCredentials;
use std::collections::BTreeMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::Command;
use tokio::sync::{watch, Mutex};
use tokio::time::{sleep, timeout};

use crate::events::{decode_stderr_event, sanitize_external_agent_event, AgentEvent};
use crate::model::{ModelClient, TokenUsage};
use crate::process::ProcessTreeGuard;
use crate::tools::{RunCancellation, ToolRuntime};
use crate::worker_credentials::prepare_worker_credential_channel;
/// Worker telemetry cannot choose its host-owned thread or mint native subagent facts.
fn bind_worker_tool_events(event: &mut AgentEvent, owner: &str) -> bool {
    if owner.is_empty()
        && matches!(
            event,
            AgentEvent::ToolCallStarted { .. } | AgentEvent::ToolCallFinished { .. }
        )
    {
        // An empty worker identity would be interpreted as primary by clients.
        return false;
    }
    match event {
        AgentEvent::ToolCallStarted {
            thread_name,
            name,
            args_preview,
            key_arg_preview,
            args_detail,
            delegation_intent,
            delegation_summary_verified,
            ..
        } => {
            *thread_name = Some(owner.to_string());
            *delegation_intent = None;
            *delegation_summary_verified = false;
            if name == "subagent" {
                args_preview.clear();
                *key_arg_preview = None;
                *args_detail = None;
            }
        }
        AgentEvent::ToolCallFinished {
            thread_name,
            name,
            content_preview,
            delegation_outcome,
            delegation_summary,
            ..
        } => {
            *thread_name = Some(owner.to_string());
            *delegation_outcome = None;
            *delegation_summary = None;
            if name == "subagent" {
                content_preview.clear();
            }
        }
        _ => {}
    }
    true
}
const CANCEL_ACK_GRACE: Duration = Duration::from_millis(250);
// SSH cleanup can spend five seconds in the kill request; Podman can spend two.
const COOPERATIVE_CLEANUP_GRACE: Duration = Duration::from_secs(7);
const READER_DRAIN_GRACE: Duration = Duration::from_millis(100);

pub(super) struct WorkerRun {
    pub(super) stdout: String,
    pub(super) stderr: String,
    pub(super) exit_code: i32,
    pub(super) timed_out: bool,
    pub(super) cancelled: bool,
    pub(super) timeout_reason: Option<String>,
    pub(super) usage: Option<TokenUsage>,
    pub(super) model_error: Option<String>,
    pub(super) cleanup_error: Option<String>,
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
            | AgentEvent::McpServerSkipped { .. }
            | AgentEvent::McpNotification { .. }
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
            | AgentEvent::OrchestratorCompactionFailed { .. }
            | AgentEvent::ThreadStarted { .. }
            | AgentEvent::ThreadFinished { .. } => {}
        }
    }

    fn timeout_reason(&self) -> String {
        match &self.location {
            TimeoutLocation::ModelApi { iteration } => format!(
                "The thread timed out at a call to the model API.\nModel call: iteration {iteration}"
            ),
            TimeoutLocation::ToolCall if !self.active_tool_calls.is_empty() => {
                if self.active_tool_calls.len() == 1 {
                    if let Some((call_id, call)) = self.active_tool_calls.iter().next() {
                        return format!(
                            "The thread timed out at a tool call.\nTool call: {} {}\narguments: {}",
                            call.name,
                            call_id,
                            call.args_detail.as_deref().unwrap_or("<not captured>")
                        );
                    }
                }

                let mut reason = String::from("The thread timed out at tool calls:");
                for (call_id, call) in &self.active_tool_calls {
                    reason.push_str(&format!("\n- {} {}", call.name, call_id));
                    match call.args_detail.as_deref() {
                        Some(args_detail) => {
                            reason.push_str(&format!("\n  arguments: {args_detail}"));
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
    pub(super) require_history: bool,
    pub(super) session_id: &'a str,
    pub(super) thread_name: &'a str,
    pub(super) dispatch_id: &'a str,
    pub(super) action: &'a str,
    pub(super) source_threads: &'a [String],
    pub(super) scheduled_skills: &'a [String],
    pub(super) timeout_secs: u64,
}

#[expect(
    clippy::expect_used,
    reason = "the header snapshot is a string-to-string map and cannot fail JSON serialization"
)]
fn append_worker_model_arguments(command: &mut Command, client: &ModelClient) {
    command
        .arg("--api-model")
        .arg(client.model.as_str())
        .arg("--api-base-url")
        .arg(client.base_url())
        .arg("--backend")
        .arg(client.backend().as_str());

    if client.allow_insecure_http() {
        command.arg("--allow-insecure-http");
    }

    if let Some(reasoning_effort) = client.reasoning_effort() {
        command.arg("--effort").arg(reasoning_effort.as_str());
    }
    if let Some(api_key_env) = client.api_key_env() {
        command.arg("--api-key-env").arg(api_key_env);
    }
    if let Some(path) = client.trusted_api_key_file() {
        command.arg("--managed-api-key-file").arg(path);
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

/// Native integration credentials never enter the worker process environment.
/// The worker receives this snapshot through its private socket only after
/// startup-time MCP construction has completed.
fn remove_worker_native_credentials(command: &mut Command) {
    for name in crate::model::NATIVE_INTEGRATION_CREDENTIAL_ENV_NAMES {
        command.env_remove(name);
    }
}

fn redact_worker_native_credentials(text: &str, credentials: &[String]) -> String {
    credentials
        .iter()
        .filter(|credential| !credential.is_empty())
        .fold(text.to_string(), |text, credential| {
            text.replace(credential, "[REDACTED]")
        })
}

pub(super) async fn run_worker(
    runtime: &ToolRuntime,
    client: &ModelClient,
    invocation: WorkerInvocation<'_>,
    cancellation: RunCancellation,
) -> std::io::Result<WorkerRun> {
    let executable = runtime.worker_executable.clone().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "worker executable path was not configured; cannot spawn managed worker",
        )
    })?;
    // Existing managed provisioning remains independent. Ordinary local workers
    // can receive only the eligible orchestrator's admitted native-web snapshot.
    let delegates_native_credentials =
        runtime.command_environment.is_some() || runtime.web_credential.is_some();
    let native_credentials = if let Some(credential) = runtime.web_credential.as_ref() {
        ManagedNativeCredentials::from_exa_api_key(Some(credential.secret().to_string()))
    } else if runtime.command_environment.is_some() {
        ManagedNativeCredentials::from_process_environment()?
    } else {
        ManagedNativeCredentials::default()
    };
    let native_credential_redactions = native_credentials.exact_redactions();
    let mut command = Command::new(executable);
    command.arg("__worker");
    remove_worker_native_credentials(&mut command);
    if runtime.backend.workspace_cwd_is_local() {
        command.current_dir(&runtime.workspace_cwd);
    }
    command
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
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for source_thread in invocation.source_threads {
        command.arg("--source-thread").arg(source_thread);
    }
    for skill in invocation.scheduled_skills {
        command.arg("--skill").arg(skill);
    }
    command.args(runtime.backend.worker_cli_args());
    command.kill_on_drop(true);

    let credential_channel = delegates_native_credentials
        .then(|| prepare_worker_credential_channel(&mut command))
        .transpose()?;
    let (mut child, mut process_tree) = ProcessTreeGuard::spawn_supervised(&mut command)?;
    let _child_activity = crate::telemetry::ChildProcessGuard::start(
        child.id(),
        crate::telemetry::Correlation::session(Some(invocation.session_id)),
    );
    let control_stdin = Arc::new(Mutex::new(child.stdin.take()));
    let credential_sender = match credential_channel {
        Some(channel) => Some(channel.into_sender(child.id())?),
        None => None,
    };

    let timeout_trace = Arc::new(Mutex::new(WorkerTimeoutTrace::default()));
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| std::io::Error::other("supervised worker stderr pipe is unavailable"))?;
    let event_sink = runtime.event_sink.clone();
    let thread_name_for_logs = invocation.thread_name.to_string();
    let timeout_trace_for_logs = Arc::clone(&timeout_trace);
    let stderr_credential_redactions = native_credential_redactions.clone();
    let (cancel_ack_tx, mut cancel_ack_rx) = watch::channel(false);
    let (commit_ack_tx, commit_ack_rx) = watch::channel(false);
    let (history_tx, mut history_rx) = watch::channel(None::<std::result::Result<(), String>>);
    let require_history = invocation.require_history;
    let reader_shutdown = RunCancellation::default();
    let protocol_failure = RunCancellation::default();
    let stderr_protocol_failure = protocol_failure.clone();
    let stderr_cancellation = cancellation.clone();
    let stderr_shutdown = reader_shutdown.clone();
    let stderr_handle = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        let mut output = String::new();
        let mut worker_usage = TokenUsage::default();
        let mut model_error = None;
        let mut deferred_finish = None;
        loop {
            let line = tokio::select! {
                _ = stderr_shutdown.cancelled() => break,
                line = next_pipe_line(&mut lines) => line,
            };
            let Some(line) = line else {
                break;
            };
            let line = redact_worker_native_credentials(&line, &stderr_credential_redactions);
            if line == crate::worker::MANAGED_WORKER_HISTORY_READY {
                let _ = history_tx.send(Some(Ok(())));
                continue;
            }
            if line == crate::worker::MANAGED_WORKER_CANCEL_ACK {
                let _ = cancel_ack_tx.send(true);
                continue;
            }
            if is_worker_telemetry_line(&line) {
                eprintln!("{line}");
                continue;
            }
            if stderr_cancellation.is_cancelled() {
                // Drain accounting until pipe EOF or the existing reader-stop
                // bound, while suppressing cancelled product events/output.
                continue;
            }
            if let Some(mut event) = decode_stderr_event(&line) {
                if !bind_worker_tool_events(&mut event, &thread_name_for_logs) {
                    continue;
                }
                timeout_trace_for_logs.lock().await.observe(&event);
                if let AgentEvent::AssistantMessage {
                    usage: Some(usage), ..
                } = &event
                {
                    worker_usage += usage.clone();
                }
                if matches!(event, AgentEvent::ModelError { .. }) {
                    if let Some(AgentEvent::ModelError { message, .. }) =
                        sanitize_external_agent_event(event.clone())
                    {
                        if !message.trim().is_empty() {
                            model_error = Some(message);
                        }
                    }
                }
                if matches!(event, AgentEvent::RunFinished { .. }) {
                    deferred_finish = Some(event);
                } else {
                    if let Err(error) = event_sink.try_emit_async(event).await {
                        let message =
                            format!("required worker prefix publication failed: {error:#}");
                        let _ = history_tx.send(Some(Err(message.clone())));
                        model_error = Some(message);
                        stderr_protocol_failure.cancel();
                        break;
                    }
                }
            } else {
                event_sink
                    .emit_async(AgentEvent::ThreadLog {
                        name: thread_name_for_logs.clone(),
                        line: line.clone(),
                    })
                    .await;
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
        (output, usage, model_error, deferred_finish)
    });

    let stdout_cancellation = cancellation.clone();
    let stdout_shutdown = reader_shutdown.clone();
    let stdout_credential_redactions = native_credential_redactions;
    let completion_identity = crate::store::WorkerDispatchIdentity {
        session_id: invocation.session_id.to_string(),
        thread_name: invocation.thread_name.to_string(),
        dispatch_id: invocation.dispatch_id.to_string(),
        // Read the admission made by execute_parsed_dispatch. Raw process
        // supervision tests need no durable admission unless they send a frame.
        generation: 0,
        run_id: runtime.active_threads.run_id(),
    };
    let store_path = runtime.store_path.clone();
    let completion_stdin = Arc::clone(&control_stdin);
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("supervised worker stdout pipe is unavailable"))?;
    let stdout_protocol_failure = protocol_failure.clone();
    let stdout_handle = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut output = String::new();
        let mut protocol_error = None;
        loop {
            let mut bytes = Vec::new();
            let mut bounded =
                (&mut reader).take(crate::worker_protocol::MAX_COMPLETION_BYTES as u64 + 1);
            let read = tokio::select! {
                _ = stdout_shutdown.cancelled() => break,
                read = bounded.read_until(b'\n', &mut bytes) => read,
            };
            match read {
                Ok(0) => break,
                Ok(_) if bytes.len() <= crate::worker_protocol::MAX_COMPLETION_BYTES => {}
                _ => {
                    protocol_error = Some("invalid or oversized worker output frame".to_string());
                    break;
                }
            }
            let Ok(line) = String::from_utf8(bytes) else {
                protocol_error = Some("invalid UTF-8 worker output frame".to_string());
                break;
            };
            if stdout_cancellation.is_cancelled() {
                break;
            }
            if let Some(payload) = line
                .trim_end()
                .strip_prefix(crate::worker_protocol::COMPLETION_PREFIX)
            {
                if require_history {
                    loop {
                        let acknowledgement = history_rx.borrow().clone();
                        if let Some(result) = acknowledgement {
                            if let Err(error) = result {
                                protocol_error = Some(error);
                            }
                            break;
                        }
                        tokio::select! {
                            _ = stdout_cancellation.cancelled() => {
                                protocol_error = Some("worker prefix acknowledgement cancelled".into()); break;
                            }
                            changed = history_rx.changed() => if changed.is_err() {
                                protocol_error = Some("worker prefix barrier missing".into()); break;
                            }
                        }
                    }
                    if protocol_error.is_some() {
                        completion_stdin.lock().await.take();
                        break;
                    }
                }
                let result = commit_completion_frame(
                    &store_path,
                    &completion_identity,
                    payload,
                    &stdout_credential_redactions,
                    &stdout_cancellation,
                    &completion_stdin,
                )
                .await;
                if let Err(error) = result {
                    protocol_error = Some(format!("worker completion rejected: {error}"));
                    // EOF releases a worker waiting for an acknowledgement.
                    completion_stdin.lock().await.take();
                    break;
                }
                let _ = commit_ack_tx.send(true);
            } else {
                let line = redact_worker_native_credentials(
                    line.trim_end(),
                    &stdout_credential_redactions,
                );
                if !output.is_empty() {
                    output.push('\n');
                }
                output.push_str(&line);
            }
        }
        if protocol_error.is_some() {
            stdout_protocol_failure.cancel();
        }
        (output, protocol_error)
    });

    enum WaitOutcome {
        Exited(std::io::Result<std::process::ExitStatus>),
        TimedOut,
        ProtocolError,
        Cancelled,
        CredentialError(std::io::Error),
    }

    let deadline = sleep(Duration::from_secs(invocation.timeout_secs));
    tokio::pin!(deadline);
    let credential_delivery = async {
        match credential_sender {
            Some(sender) => sender.send_after_ready(&native_credentials).await,
            None => Ok(()),
        }
    };
    tokio::pin!(credential_delivery);
    let mut outcome = tokio::select! {
        biased;
        _ = cancellation.cancelled() => WaitOutcome::Cancelled,
        _ = protocol_failure.cancelled() => WaitOutcome::ProtocolError,
        result = child.wait() => WaitOutcome::Exited(result),
        _ = &mut deadline => WaitOutcome::TimedOut,
        result = &mut credential_delivery => match result {
            Ok(()) => tokio::select! {
                biased;
                _ = cancellation.cancelled() => WaitOutcome::Cancelled,
                _ = protocol_failure.cancelled() => WaitOutcome::ProtocolError,
                result = child.wait() => WaitOutcome::Exited(result),
                _ = &mut deadline => WaitOutcome::TimedOut,
            },
            Err(error) => match timeout(READER_DRAIN_GRACE, child.wait()).await {
                Ok(status) => WaitOutcome::Exited(status),
                Err(_) => WaitOutcome::CredentialError(error),
            },
        },
    };
    let mut cooperatively_cancelled = false;
    if matches!(outcome, WaitOutcome::Cancelled) {
        if let Some(stdin) = control_stdin.lock().await.as_mut() {
            let _ = stdin.write_all(b"cancel\n").await;
            let _ = stdin.flush().await;
        }
        let acknowledged = if *cancel_ack_rx.borrow() {
            true
        } else {
            timeout(
                CANCEL_ACK_GRACE,
                cancel_ack_rx.wait_for(|acknowledged| *acknowledged),
            )
            .await
            .is_ok()
        };
        if acknowledged {
            if let Ok(wait_result) = timeout(COOPERATIVE_CLEANUP_GRACE, child.wait()).await {
                wait_result?;
                process_tree.mark_leader_reaped();
                cooperatively_cancelled = true;
            }
        }
    } else if matches!(outcome, WaitOutcome::Exited(_)) {
        process_tree.mark_leader_reaped();
        if cancellation.is_cancelled() {
            outcome = WaitOutcome::Cancelled;
            cooperatively_cancelled = true;
        }
    }

    let timed_out = matches!(outcome, WaitOutcome::TimedOut);
    if timed_out || matches!(outcome, WaitOutcome::ProtocolError) {
        cancellation.cancel();
    }
    let mut cancelled = matches!(outcome, WaitOutcome::Cancelled);
    let mut cleanup_error = None;
    let mut force_reader_shutdown = false;
    if timed_out
        || matches!(
            outcome,
            WaitOutcome::CredentialError(_) | WaitOutcome::ProtocolError
        )
        || (cancelled && !cooperatively_cancelled)
    {
        match process_tree.terminate(&mut child).await {
            Ok(()) => force_reader_shutdown = true,
            Err(error) => {
                reader_shutdown.cancel();
                cleanup_error = Some(format!("worker cleanup incomplete: {error}"));
            }
        }
    } else if cooperatively_cancelled {
        // The reaped worker's survivors (such as a stdio MCP server) can hold
        // its stdio open. Kill them now, not in the guard's Drop after the
        // drain, and bound the drain like the other cancellation paths.
        match process_tree.finish_checked().await {
            Ok(()) => force_reader_shutdown = true,
            Err(error) => {
                reader_shutdown.cancel();
                cleanup_error = Some(format!("worker cleanup incomplete: {error}"));
            }
        }
    }

    let readers = async {
        let (stderr, worker_usage, model_error, deferred_finish) =
            stderr_handle.await.unwrap_or_default();
        let (stdout, protocol_error) = stdout_handle.await.unwrap_or_default();
        if *commit_ack_rx.borrow() {
            if let Some(event) = deferred_finish {
                if let Err(error) = runtime.event_sink.try_emit_async(event).await {
                    return (
                        stderr,
                        worker_usage,
                        Some(format!(
                            "committed worker finish publication failed: {error:#}"
                        )),
                        stdout,
                    );
                }
            }
        }
        (stderr, worker_usage, protocol_error.or(model_error), stdout)
    };
    tokio::pin!(readers);
    let mut reader_output = None;
    if !timed_out && !cancelled && !matches!(outcome, WaitOutcome::ProtocolError) {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => {
                cancelled = true;
                match process_tree.terminate(&mut child).await {
                    Ok(()) => force_reader_shutdown = true,
                    Err(error) => {
                        reader_shutdown.cancel();
                        cleanup_error = Some(format!("worker cleanup incomplete: {error}"));
                    }
                }
            }
            output = &mut readers => reader_output = Some(output),
        }
    }
    let (stderr, worker_usage, model_error, stdout) = if let Some(output) = reader_output {
        output
    } else if force_reader_shutdown {
        match timeout(READER_DRAIN_GRACE, &mut readers).await {
            Ok(output) => output,
            Err(_) => {
                reader_shutdown.cancel();
                readers.await
            }
        }
    } else {
        readers.await
    };

    if !timed_out && !cancelled {
        process_tree.finish().await;
    }
    let timeout_reason = if timed_out {
        Some(timeout_trace.lock().await.timeout_reason())
    } else {
        None
    };
    let mut exit_code = match outcome {
        WaitOutcome::Exited(wait_result) if !cancelled => wait_result?.code().unwrap_or(-1),
        WaitOutcome::Exited(_)
        | WaitOutcome::TimedOut
        | WaitOutcome::Cancelled
        | WaitOutcome::ProtocolError => -1,
        WaitOutcome::CredentialError(error) => return Err(error),
    };

    if model_error.as_ref().is_some_and(|error| {
        error.starts_with("worker completion rejected:")
            || error.starts_with("invalid or oversized")
            || error.starts_with("invalid UTF-8 worker")
    }) {
        exit_code = -1;
    }

    Ok(WorkerRun {
        stdout,
        stderr,
        exit_code,
        timed_out,
        cancelled,
        timeout_reason,
        usage: worker_usage,
        model_error,
        cleanup_error,
    })
}

async fn commit_completion_frame(
    path: &std::path::Path,
    expected: &crate::store::WorkerDispatchIdentity,
    payload: &str,
    redactions: &[String],
    cancellation: &RunCancellation,
    stdin: &Arc<Mutex<Option<tokio::process::ChildStdin>>>,
) -> anyhow::Result<()> {
    use crate::worker_protocol::{CommitAck, Completion, ACK_PREFIX};
    let mut frame: Completion = serde_json::from_str(payload)?;
    anyhow::ensure!(
        frame.session_id == expected.session_id
            && frame.thread_name == expected.thread_name
            && frame.dispatch_id == expected.dispatch_id,
        "completion identity mismatch"
    );
    frame.content = redact_worker_native_credentials(&frame.content, redactions);
    let path = path.to_path_buf();
    let mut identity = expected.clone();
    let content = frame.content;
    let commit_cancellation = cancellation.clone();
    let episode_id = crate::store::spawn_blocking_store_caller(move || {
        identity.generation =
            crate::store::worker_dispatch_generation(&path, &identity.dispatch_id)?;
        commit_cancellation
            .run_if_active(|| {
                crate::store::commit_worker_episode(
                    &path,
                    &identity,
                    &content,
                    crate::store::EpisodeStatus::Ok,
                )
            })
            .ok_or_else(|| anyhow::anyhow!("dispatch cancelled before host commit"))?
    })
    .await??;
    let ack = CommitAck {
        session_id: expected.session_id.clone(),
        thread_name: expected.thread_name.clone(),
        dispatch_id: expected.dispatch_id.clone(),
        episode_id,
    };
    let encoded = format!("{ACK_PREFIX}{}\n", serde_json::to_string(&ack)?);
    let mut control = stdin.lock().await;
    let control = control
        .as_mut()
        .ok_or_else(|| anyhow::anyhow!("worker control pipe is closed"))?;
    anyhow::ensure!(
        encoded.len() <= crate::worker_protocol::MAX_CONTROL_BYTES,
        "host acknowledgement exceeds protocol limit"
    );
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => anyhow::bail!("host acknowledgement interrupted"),
        result = async {
            control.write_all(encoded.as_bytes()).await?;
            control.flush().await
        } => result?,
    }
    Ok(())
}

fn is_worker_telemetry_line(line: &str) -> bool {
    line.strip_prefix(crate::telemetry::JSON_LINE_PREFIX)
        .or_else(|| line.strip_prefix(crate::telemetry::EXPORT_RECEIPT_PREFIX))
        .is_some_and(|payload| serde_json::from_str::<serde_json::Value>(payload).is_ok())
}

/// Next line of a worker pipe. A line that does not decode as UTF-8 (a
/// subprocess writing raw bytes to the inherited pipe) is skipped rather than
/// ending the pump, so the worker's remaining events still reach the UI.
async fn next_pipe_line<R: AsyncBufRead + Unpin>(lines: &mut Lines<R>) -> Option<String> {
    loop {
        match lines.next_line().await {
            Ok(line) => return line,
            Err(error) if error.kind() == std::io::ErrorKind::InvalidData => continue,
            Err(_) => return None,
        }
    }
}

#[cfg(test)]
#[path = "worker_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "worker_cancel_tests.rs"]
mod cancel_tests;
