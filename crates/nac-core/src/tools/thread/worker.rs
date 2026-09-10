use std::collections::BTreeMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::Command;
use tokio::sync::{watch, Mutex};
use tokio::time::{sleep, timeout};

use crate::events::{decode_stderr_event, sanitize_external_agent_event, AgentEvent};
use crate::model::{ModelClient, TokenUsage};
use crate::process::ProcessTreeGuard;
use crate::tools::{ThreadCancellation, ToolRuntime};
use crate::worker_credentials::{
    prepare_worker_credential_channel, ManagedWorkerNativeCredentials,
};
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
    cancellation: ThreadCancellation,
) -> std::io::Result<WorkerRun> {
    let executable = runtime.worker_executable.clone().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "worker executable path was not configured; cannot spawn managed worker",
        )
    })?;
    // Command-environment providers are attached only for an explicitly
    // configured Managed NAC host. Ordinary local workers retain their prior
    // process semantics and do not participate in native credential delegation.
    let delegates_native_credentials = runtime.command_environment.is_some();
    let native_credentials = if delegates_native_credentials {
        ManagedWorkerNativeCredentials::from_process_environment()?
    } else {
        ManagedWorkerNativeCredentials::default()
    };
    let native_credential_redactions = native_credentials.exact_redactions();
    let mut command = Command::new(executable);
    command.arg("__worker");
    remove_worker_native_credentials(&mut command);
    if let Some(provider) = runtime.command_environment.as_ref() {
        let environment = provider.worker_environment();
        if let Some(secret_root) = environment.secret_root {
            command.arg("--managed-secret-root").arg(secret_root);
        }
        if let Some(client_id) = environment.github_client_id {
            command.arg("--managed-github-client-id").arg(client_id);
        }
        if let Some(home_root) = environment.home_root {
            command.arg("--managed-home-root").arg(home_root);
        }
    }
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
    let mut control_stdin = child.stdin.take();
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
    let reader_shutdown = ThreadCancellation::default();
    let stderr_cancellation = cancellation.clone();
    let stderr_shutdown = reader_shutdown.clone();
    let stderr_handle = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        let mut output = String::new();
        let mut worker_usage = TokenUsage::default();
        let mut model_error = None;
        loop {
            let line = tokio::select! {
                _ = stderr_shutdown.cancelled() => break,
                line = next_pipe_line(&mut lines) => line,
            };
            let Some(line) = line else {
                break;
            };
            let line = redact_worker_native_credentials(&line, &stderr_credential_redactions);
            if stderr_cancellation.is_cancelled() {
                break;
            }
            if line == crate::worker::MANAGED_WORKER_CANCEL_ACK {
                let _ = cancel_ack_tx.send(true);
                continue;
            }
            if let Some(event) = decode_stderr_event(&line) {
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
        (output, usage, model_error)
    });

    let stdout_cancellation = cancellation.clone();
    let stdout_shutdown = reader_shutdown.clone();
    let stdout_credential_redactions = native_credential_redactions;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("supervised worker stdout pipe is unavailable"))?;
    let stdout_handle = tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut output = String::new();
        loop {
            let line = tokio::select! {
                _ = stdout_shutdown.cancelled() => break,
                line = next_pipe_line(&mut lines) => line,
            };
            let Some(line) = line else {
                break;
            };
            let line = redact_worker_native_credentials(&line, &stdout_credential_redactions);
            if stdout_cancellation.is_cancelled() {
                break;
            }
            if !output.is_empty() {
                output.push('\n');
            }
            output.push_str(&line);
        }
        output
    });

    enum WaitOutcome {
        Exited(std::io::Result<std::process::ExitStatus>),
        TimedOut,
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
        result = child.wait() => WaitOutcome::Exited(result),
        _ = &mut deadline => WaitOutcome::TimedOut,
        result = &mut credential_delivery => match result {
            Ok(()) => tokio::select! {
                biased;
                _ = cancellation.cancelled() => WaitOutcome::Cancelled,
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
        if let Some(mut stdin) = control_stdin.take() {
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
    let mut cancelled = matches!(outcome, WaitOutcome::Cancelled);
    let mut cleanup_error = None;
    let mut force_reader_shutdown = false;
    if timed_out
        || matches!(outcome, WaitOutcome::CredentialError(_))
        || (cancelled && !cooperatively_cancelled)
    {
        match process_tree.terminate(&mut child).await {
            Ok(()) => force_reader_shutdown = true,
            Err(error) => {
                reader_shutdown.cancel();
                cleanup_error = Some(format!("worker cleanup incomplete: {error}"));
            }
        }
    }

    let readers = async {
        let (stderr, worker_usage, model_error) = stderr_handle.await.unwrap_or_default();
        let stdout = stdout_handle.await.unwrap_or_default();
        (stderr, worker_usage, model_error, stdout)
    };
    tokio::pin!(readers);
    let mut reader_output = None;
    if !timed_out && !cancelled {
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
    let exit_code = match outcome {
        WaitOutcome::Exited(wait_result) if !cancelled => wait_result?.code().unwrap_or(-1),
        WaitOutcome::Exited(_) | WaitOutcome::TimedOut | WaitOutcome::Cancelled => -1,
        WaitOutcome::CredentialError(error) => return Err(error),
    };

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
mod tests {
    use super::*;
    use crate::model::{BackendKind, EffectiveModelSettings};
    use crate::tools::test_runtime;
    use crate::TEST_ENV_LOCK;
    #[cfg(target_os = "linux")]
    use std::io::Read;
    #[cfg(target_os = "linux")]
    use std::os::unix::fs::OpenOptionsExt;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::path::PathBuf;

    const NATIVE_CREDENTIAL_CANARY: &str = "exa-worker-private-socket-canary";

    #[cfg(target_os = "linux")]
    #[test]
    fn credential_socket_startup_racer_helper() {
        let Some(root) = std::env::var_os("NAC_WORKER_NATIVE_CREDENTIAL_ROOT") else {
            return;
        };
        let root = PathBuf::from(root);
        let socket = std::env::var_os("NAC_TEST_CREDENTIAL_SOCKET").unwrap();
        let mut stream = std::os::unix::net::UnixStream::connect(socket).unwrap();
        std::fs::write(root.join("racer-connected"), "yes").unwrap();
        let mut bytes = Vec::new();
        stream.read_to_end(&mut bytes).unwrap();
        assert!(!bytes
            .windows(NATIVE_CREDENTIAL_CANARY.len())
            .any(|part| part == NATIVE_CREDENTIAL_CANARY.as_bytes()));
        bytes.fill(0);
        std::fs::write(root.join("racer-observation"), "credential=absent").unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn native_credential_adversarial_descendant_helper() {
        let Some(root) = std::env::var_os("NAC_WORKER_NATIVE_CREDENTIAL_ROOT") else {
            return;
        };
        let root = PathBuf::from(root);
        assert!(std::env::var_os(crate::model::EXA_API_KEY_ENV).is_none());
        assert!(!std::env::args().any(|argument| argument.contains(NATIVE_CREDENTIAL_CANARY)));
        #[cfg(target_os = "linux")]
        {
            let socket_link = std::env::var("NAC_TEST_CREDENTIAL_SOCKET_LINK").unwrap();
            let inherited = std::fs::read_dir("/proc/self/fd")
                .unwrap()
                .filter_map(Result::ok)
                .filter_map(|entry| std::fs::read_link(entry.path()).ok())
                .any(|link| link.to_string_lossy() == socket_link);
            assert!(!inherited, "credential socket reached an MCP descendant");
        }
        std::fs::write(
            root.join("mcp-descendant"),
            "env=absent;fd=absent;argv=absent",
        )
        .unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn native_credential_adversarial_mcp_helper() {
        let Some(root) = std::env::var_os("NAC_WORKER_NATIVE_CREDENTIAL_ROOT") else {
            return;
        };
        let root = PathBuf::from(root);
        assert!(std::env::var_os(crate::model::EXA_API_KEY_ENV).is_none());
        assert!(!std::env::args().any(|argument| argument.contains(NATIVE_CREDENTIAL_CANARY)));

        #[cfg(target_os = "linux")]
        {
            let socket_link = std::env::var("NAC_TEST_CREDENTIAL_SOCKET_LINK").unwrap();
            // The MCP builder supplies a fresh stdin pipe. Make it nonblocking
            // so an empty pipe is evidence rather than a reason to hang.
            // SAFETY: fcntl operates on the process's valid stdin descriptor.
            let flags = unsafe { libc::fcntl(libc::STDIN_FILENO, libc::F_GETFL) };
            assert!(flags >= 0);
            assert!(
                // SAFETY: F_SETFL consumes the previously returned flags.
                unsafe { libc::fcntl(libc::STDIN_FILENO, libc::F_SETFL, flags | libc::O_NONBLOCK) }
                    >= 0
            );
            let mut stdin_bytes = [0_u8; 4096];
            let stdin_read = std::io::stdin().read(&mut stdin_bytes).unwrap_or(0);
            assert!(!stdin_bytes[..stdin_read]
                .windows(NATIVE_CREDENTIAL_CANARY.len())
                .any(|bytes| bytes == NATIVE_CREDENTIAL_CANARY.as_bytes()));
            stdin_bytes.fill(0);

            let inherited_socket = std::fs::read_dir("/proc/self/fd")
                .unwrap()
                .filter_map(Result::ok)
                .filter_map(|entry| std::fs::read_link(entry.path()).ok())
                .any(|link| link.to_string_lossy() == socket_link);
            assert!(!inherited_socket, "credential socket was inherited by MCP");

            // SAFETY: getppid takes no arguments and has no memory-safety preconditions.
            let parent = unsafe { libc::getppid() };
            let deadline = std::time::Instant::now() + Duration::from_millis(400);
            let mut reopened_socket = false;
            let mut observed_credential = false;
            while std::time::Instant::now() < deadline {
                if let Ok(entries) = std::fs::read_dir(format!("/proc/{parent}/fd")) {
                    for entry in entries.filter_map(Result::ok) {
                        let Ok(link) = std::fs::read_link(entry.path()) else {
                            continue;
                        };
                        if link.to_string_lossy() != socket_link {
                            continue;
                        }
                        let opened = std::fs::OpenOptions::new()
                            .read(true)
                            .custom_flags(libc::O_NONBLOCK)
                            .open(entry.path());
                        if let Ok(mut opened) = opened {
                            reopened_socket = true;
                            let mut bytes = [0_u8; 4096];
                            let read = opened.read(&mut bytes).unwrap_or(0);
                            observed_credential |= bytes[..read]
                                .windows(NATIVE_CREDENTIAL_CANARY.len())
                                .any(|part| part == NATIVE_CREDENTIAL_CANARY.as_bytes());
                            bytes.fill(0);
                        }
                    }
                }
                std::thread::yield_now();
            }
            assert!(
                !reopened_socket,
                "MCP reopened the worker socket via procfs"
            );
            assert!(!observed_credential, "MCP read the credential via procfs");
            std::fs::write(
                root.join("mcp-observations"),
                "env=absent;argv=absent;stdin=absent;inherited-fd=absent;proc-fd=unopenable",
            )
            .unwrap();
        }
        #[cfg(not(target_os = "linux"))]
        std::fs::write(
            root.join("mcp-observations"),
            "env=absent;argv=absent;proc-fd=unsupported",
        )
        .unwrap();

        let descendant = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "tools::thread::worker::tests::native_credential_adversarial_descendant_helper",
                "--nocapture",
            ])
            .output()
            .unwrap();
        assert!(descendant.status.success());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn native_credential_worker_endpoint_helper() {
        let Some(root) = std::env::var_os("NAC_WORKER_NATIVE_CREDENTIAL_ROOT") else {
            return;
        };
        let root = PathBuf::from(root);
        let fd = std::env::var("NAC_TEST_CREDENTIAL_FD")
            .ok()
            .map(|value| value.parse::<i32>().unwrap());
        let socket_path = std::env::var_os("NAC_TEST_CREDENTIAL_SOCKET").map(PathBuf::from);
        let receiver =
            crate::worker_credentials::ManagedWorkerCredentialReceiver::from_private_channel(
                fd,
                socket_path,
            )
            .unwrap();
        let fd = receiver.raw_fd_for_test().unwrap();
        // SAFETY: F_GETFD only reads flags for the owned integer descriptor.
        let fd_flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
        assert!(fd_flags >= 0 && fd_flags & libc::FD_CLOEXEC != 0);
        #[cfg(target_os = "linux")]
        {
            // SAFETY: these prctl getters take no pointer arguments.
            assert_eq!(unsafe { libc::prctl(libc::PR_GET_DUMPABLE) }, 0);
            assert_eq!(
                unsafe { libc::prctl(libc::PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) },
                1
            );
        }
        assert!(std::env::var_os(crate::model::EXA_API_KEY_ENV).is_none());
        let expansion_error = crate::mcp::test_support::expand_env("${EXA_API_KEY}")
            .expect_err("worker MCP expansion must not observe the native credential")
            .to_string();
        assert!(!expansion_error.contains(NATIVE_CREDENTIAL_CANARY));
        std::fs::write(root.join("mcp-expansion"), "absent").unwrap();

        #[cfg(target_os = "linux")]
        let socket_link = std::fs::read_link(format!("/proc/self/fd/{fd}"))
            .unwrap()
            .to_string_lossy()
            .into_owned();
        #[cfg(not(target_os = "linux"))]
        let socket_link = "unsupported".to_string();
        let mut mcp = crate::mcp::test_support::stdio_command(
            std::env::current_exe().unwrap().to_str().unwrap(),
            &[
                "--exact".to_string(),
                "tools::thread::worker::tests::native_credential_adversarial_mcp_helper"
                    .to_string(),
                "--nocapture".to_string(),
            ],
            &BTreeMap::new(),
            &root,
        )
        .unwrap();
        mcp.env("NAC_TEST_CREDENTIAL_SOCKET_LINK", &socket_link);
        let mcp = mcp.spawn().unwrap();

        let credentials = receiver.receive_after_mcp().await.unwrap();
        let credential = credentials.into_exa_api_key().unwrap();
        assert_eq!(credential, NATIVE_CREDENTIAL_CANARY);
        std::fs::write(root.join("credential-delivered"), "yes").unwrap();
        println!("stdout:{credential}");
        eprintln!("stderr:{credential}");
        drop(credential);

        let output = mcp.wait_with_output().await.unwrap();
        assert!(output.status.success());
        assert!(!String::from_utf8_lossy(&output.stdout).contains(NATIVE_CREDENTIAL_CANARY));
        std::fs::write(root.join("mcp-output"), output.stdout).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn native_credential_worker_process_helper() {
        let Some(root) = std::env::var_os("NAC_WORKER_NATIVE_CREDENTIAL_ROOT") else {
            return;
        };
        let root = PathBuf::from(root);
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("worker.sh");
        let current_exe = std::env::current_exe().unwrap();
        let shell_quote = |value: &std::path::Path| {
            format!("'{}'", value.to_string_lossy().replace('\'', "'\\''"))
        };
        #[cfg(target_os = "linux")]
        let script = format!(
            "#!/bin/sh\nprintf '%s' \"${{EXA_API_KEY-unset}}\" > '{}'\n\
             printf '%s\\n' \"$@\" > '{}'\n\
             socket=\n\
             while [ \"$#\" -gt 0 ]; do\n\
               if [ \"$1\" = --native-credential-socket ]; then socket=$2; break; fi\n\
               shift\n\
             done\n\
             test -n \"$socket\"\n\
             NAC_TEST_CREDENTIAL_SOCKET=\"$socket\" {} --exact tools::thread::worker::tests::credential_socket_startup_racer_helper --nocapture &\n\
             while [ ! -f '{}' ]; do sleep 0.01; done\n\
             NAC_TEST_CREDENTIAL_SOCKET=\"$socket\" exec {} --exact tools::thread::worker::tests::native_credential_worker_endpoint_helper --nocapture\n",
            root.join("inherited-exa").display(),
            root.join("argv").display(),
            shell_quote(&current_exe),
            root.join("racer-connected").display(),
            shell_quote(&current_exe)
        );
        #[cfg(not(target_os = "linux"))]
        let script = format!(
            "#!/bin/sh\nprintf '%s' \"${{EXA_API_KEY-unset}}\" > '{}'\n\
             printf '%s\\n' \"$@\" > '{}'\n\
             fd=\n\
             while [ \"$#\" -gt 0 ]; do\n\
               if [ \"$1\" = --native-credential-fd ]; then fd=$2; break; fi\n\
               shift\n\
             done\n\
             test -n \"$fd\"\n\
             NAC_TEST_CREDENTIAL_FD=\"$fd\" exec {} --exact tools::thread::worker::tests::native_credential_worker_endpoint_helper --nocapture\n",
            root.join("inherited-exa").display(),
            root.join("argv").display(),
            shell_quote(&current_exe)
        );
        std::fs::write(&executable, script).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();

        let mut runtime = test_runtime();
        runtime.workspace_cwd = root.clone();
        runtime.config_cwd = root.clone();
        runtime.worker_executable = Some(executable);
        runtime.command_environment = Some(Arc::new(
            nac_managed::ManagedCommandEnvironmentProvider::new(None, None, None),
        ));
        let (event_tx, mut event_rx) = tokio::sync::mpsc::unbounded_channel();
        runtime.event_sink = crate::events::EventSink::channel(event_tx);
        let no_sources = Vec::<String>::new();
        let no_skills = Vec::<String>::new();
        let run = run_worker(
            &runtime,
            &ModelClient::new_for_test(),
            WorkerInvocation {
                session_id: "session",
                thread_name: "worker",
                dispatch_id: "dispatch",
                action: "worker",
                source_threads: &no_sources,
                scheduled_skills: &no_skills,
                timeout_secs: 30,
            },
            ThreadCancellation::default(),
        )
        .await
        .unwrap();
        assert_eq!(run.exit_code, 0);
        std::fs::write(root.join("stdout"), run.stdout).unwrap();
        std::fs::write(root.join("stderr"), run.stderr).unwrap();
        let mut event_log = String::new();
        while let Ok(event) = event_rx.try_recv() {
            event_log.push_str(&serde_json::to_string(&event).unwrap());
            event_log.push('\n');
        }
        std::fs::write(root.join("event-log"), event_log).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn managed_worker_private_socket_isolates_exa_from_adversarial_mcp() {
        let root = std::env::temp_dir().join(format!(
            "nac_worker_native_credential_{}",
            uuid::Uuid::new_v4()
        ));
        let credential = NATIVE_CREDENTIAL_CANARY;
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "tools::thread::worker::tests::native_credential_worker_process_helper",
                "--nocapture",
            ])
            .env("NAC_WORKER_NATIVE_CREDENTIAL_ROOT", &root)
            .env("EXA_API_KEY", credential)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "worker credential helper failed: stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            std::fs::read_to_string(root.join("inherited-exa")).unwrap(),
            "unset"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("mcp-expansion")).unwrap(),
            "absent"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("mcp-descendant")).unwrap(),
            "env=absent;fd=absent;argv=absent"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("credential-delivered")).unwrap(),
            "yes"
        );
        #[cfg(target_os = "linux")]
        assert_eq!(
            std::fs::read_to_string(root.join("racer-observation")).unwrap(),
            "credential=absent"
        );
        let observations = std::fs::read_to_string(root.join("mcp-observations")).unwrap();
        assert!(!observations.contains(credential));
        assert!(observations.contains("env=absent"));
        #[cfg(target_os = "linux")]
        assert!(observations.contains("proc-fd=unopenable"));
        let argv = std::fs::read_to_string(root.join("argv")).unwrap();
        assert!(!argv.contains(credential));
        #[cfg(target_os = "linux")]
        {
            assert!(argv.contains("native-credential-socket"));
            assert!(!argv.contains("native-credential-fd"));
        }
        for output_path in ["stdout", "stderr"] {
            let rendered = std::fs::read_to_string(root.join(output_path)).unwrap();
            assert!(rendered.contains("[REDACTED]"), "{output_path}: {rendered}");
            assert!(!rendered.contains(credential), "{output_path}: {rendered}");
        }
        assert!(!std::fs::read_to_string(root.join("event-log"))
            .unwrap()
            .contains(credential));
        assert!(!String::from_utf8_lossy(&output.stdout).contains(credential));
        assert!(!String::from_utf8_lossy(&output.stderr).contains(credential));
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn unmanaged_worker_process_semantics_helper() {
        let Some(root) = std::env::var_os("NAC_UNMANAGED_WORKER_ROOT") else {
            return;
        };
        let root = PathBuf::from(root);
        std::fs::create_dir_all(&root).unwrap();
        #[cfg(target_os = "linux")]
        {
            // SAFETY: PR_GET_NO_NEW_PRIVS takes integer zero placeholders only.
            let no_new_privs = unsafe { libc::prctl(libc::PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) };
            assert!(no_new_privs >= 0);
            std::fs::write(root.join("parent-nnp"), no_new_privs.to_string()).unwrap();
        }
        let executable = root.join("worker.sh");
        let script = format!(
            "#!/bin/sh\nprintf '%s' \"${{EXA_API_KEY-unset}}\" > '{}'\n\
             printf '%s\\n' \"$@\" > '{}'\n\
             if [ -r /proc/self/status ]; then awk '$1 == \"NoNewPrivs:\" {{ print $2 }}' /proc/self/status > '{}'; fi\n",
            root.join("inherited-exa").display(),
            root.join("argv").display(),
            root.join("child-nnp").display()
        );
        std::fs::write(&executable, script).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();

        let mut runtime = test_runtime();
        runtime.workspace_cwd = root.clone();
        runtime.config_cwd = root.clone();
        runtime.worker_executable = Some(executable);
        let no_sources = Vec::<String>::new();
        let no_skills = Vec::<String>::new();
        let run = run_worker(
            &runtime,
            &ModelClient::new_for_test(),
            WorkerInvocation {
                session_id: "session",
                thread_name: "worker",
                dispatch_id: "dispatch",
                action: "worker",
                source_threads: &no_sources,
                scheduled_skills: &no_skills,
                timeout_secs: 30,
            },
            ThreadCancellation::default(),
        )
        .await
        .unwrap();
        assert_eq!(run.exit_code, 0);
    }

    #[cfg(unix)]
    #[test]
    fn unmanaged_worker_does_not_delegate_or_change_process_controls() {
        let root =
            std::env::temp_dir().join(format!("nac_unmanaged_worker_{}", uuid::Uuid::new_v4()));
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "tools::thread::worker::tests::unmanaged_worker_process_semantics_helper",
                "--nocapture",
            ])
            .env("NAC_UNMANAGED_WORKER_ROOT", &root)
            .env("EXA_API_KEY", NATIVE_CREDENTIAL_CANARY)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "unmanaged worker helper failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            std::fs::read_to_string(root.join("inherited-exa")).unwrap(),
            "unset"
        );
        let argv = std::fs::read_to_string(root.join("argv")).unwrap();
        assert!(!argv.contains("native-credential-fd"));
        assert!(!argv.contains("native-credential-socket"));
        assert!(!argv.contains(NATIVE_CREDENTIAL_CANARY));
        #[cfg(target_os = "linux")]
        assert_eq!(
            std::fs::read_to_string(root.join("parent-nnp")).unwrap(),
            std::fs::read_to_string(root.join("child-nnp"))
                .unwrap()
                .trim()
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn managed_worker_subcommand_precedes_nonsecret_environment_options() {
        let root =
            std::env::temp_dir().join(format!("nac_worker_secrets_{}", uuid::Uuid::new_v4()));
        let state_root = root.join("managed-state");
        std::fs::create_dir_all(&state_root).unwrap();
        let executable = root.join("worker.sh");
        let script = format!(
            r#"#!/bin/sh
printf '%s' "${{DEMO_TOKEN-unset}}" > '{root}/inherited-secret'
printf '%s\n' "$@" > '{root}/argv'
while [ "$#" -gt 0 ]; do
  case "$1" in
    --managed-secret-root) printf '%s' "$2" > '{root}/secret-root'; shift 2 ;;
    --managed-github-client-id) printf '%s' "$2" > '{root}/github-client-id'; shift 2 ;;
    --managed-home-root) printf '%s' "$2" > '{root}/home-root'; shift 2 ;;
    *) shift ;;
  esac
done
"#,
            root = root.display()
        );
        std::fs::write(&executable, script).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();

        let store = nac_managed::HostSecretStore::new(&state_root);
        store
            .put("DEMO_TOKEN", "managed-worker-canary-never-in-argv")
            .unwrap();
        let mut runtime = test_runtime();
        runtime.workspace_cwd = root.clone();
        runtime.config_cwd = root.clone();
        runtime.worker_executable = Some(executable);
        runtime.command_environment = Some(Arc::new(
            nac_managed::ManagedCommandEnvironmentProvider::new(
                Some(store),
                Some(nac_managed::ManagedGitHubAuth::new(&state_root, "Iv1.test").unwrap()),
                Some(root.join("managed-home")),
            ),
        ));
        let no_sources = Vec::<String>::new();
        let no_skills = Vec::<String>::new();
        let run = run_worker(
            &runtime,
            &ModelClient::new_for_test(),
            WorkerInvocation {
                session_id: "session",
                thread_name: "worker",
                dispatch_id: "dispatch",
                action: "worker",
                source_threads: &no_sources,
                scheduled_skills: &no_skills,
                timeout_secs: 30,
            },
            ThreadCancellation::default(),
        )
        .await
        .unwrap();

        assert_eq!(run.exit_code, 0);
        assert_eq!(
            std::fs::read_to_string(root.join("secret-root")).unwrap(),
            state_root.display().to_string()
        );
        assert_eq!(
            std::fs::read_to_string(root.join("github-client-id")).unwrap(),
            "Iv1.test"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("home-root")).unwrap(),
            root.join("managed-home").display().to_string()
        );
        assert_eq!(
            std::fs::read_to_string(root.join("inherited-secret")).unwrap(),
            "unset"
        );
        let argv = std::fs::read_to_string(root.join("argv")).unwrap();
        assert_eq!(argv.lines().next(), Some("__worker"));
        assert!(!argv.contains("managed-worker-canary-never-in-argv"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_before_credential_ready_stops_workers_and_descendants() {
        let root = std::env::temp_dir().join(format!("nac_worker_cancel_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("worker.sh");
        let script = format!(
            r#"#!/bin/sh
name=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --thread-name) name="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf ready > '{root}/'"$name"'.ready'
trap '' TERM
(trap '' TERM; sleep 1; printf survived > '{root}/'"$name"'.late') &
wait
"#,
            root = root.display()
        );
        std::fs::write(&executable, script).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();

        let mut runtime = test_runtime();
        runtime.workspace_cwd = root.clone();
        runtime.config_cwd = root.clone();
        runtime.store_path = root.join("store.db");
        runtime.worker_executable = Some(executable);
        crate::store::initialize(&runtime.store_path).unwrap();
        crate::store::insert_test_session(&runtime.store_path, "session");
        assert!(runtime.active_threads.begin_run("run-1"));
        assert!(runtime.active_threads.mark("a", "dispatch-a"));
        assert!(runtime.active_threads.mark("b", "dispatch-b"));
        let cancellation_a = runtime.active_threads.start("a", "dispatch-a").unwrap();
        let cancellation_b = runtime.active_threads.start("b", "dispatch-b").unwrap();
        let client = ModelClient::new_for_test();
        let no_sources = Vec::<String>::new();
        let no_skills = Vec::<String>::new();

        let worker_a = async {
            let result = run_worker(
                &runtime,
                &client,
                WorkerInvocation {
                    session_id: "session",
                    thread_name: "a",
                    dispatch_id: "dispatch-a",
                    action: "a",
                    source_threads: &no_sources,
                    scheduled_skills: &no_skills,
                    timeout_secs: 30,
                },
                cancellation_a,
            )
            .await;
            let _ = runtime
                .active_threads
                .close(&runtime.store_path, "session", "a", "dispatch-a");
            result
        };
        let worker_b = async {
            let result = run_worker(
                &runtime,
                &client,
                WorkerInvocation {
                    session_id: "session",
                    thread_name: "b",
                    dispatch_id: "dispatch-b",
                    action: "b",
                    source_threads: &no_sources,
                    scheduled_skills: &no_skills,
                    timeout_secs: 30,
                },
                cancellation_b,
            )
            .await;
            let _ = runtime
                .active_threads
                .close(&runtime.store_path, "session", "b", "dispatch-b");
            result
        };
        let cancel_when_ready = async {
            tokio::time::timeout(Duration::from_secs(2), async {
                while !root.join("a.ready").exists() || !root.join("b.ready").exists() {
                    sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("managed workers never became ready");
            runtime
                .active_threads
                .cancel_and_drain(Some((&runtime.store_path, "session")))
                .await
        };

        let (worker_a, worker_b, cancellation) =
            tokio::time::timeout(Duration::from_secs(5), async {
                tokio::join!(worker_a, worker_b, cancel_when_ready)
            })
            .await
            .expect("managed worker cancellation did not drain");
        cancellation.unwrap();
        assert!(worker_a.unwrap().cancelled);
        assert!(worker_b.unwrap().cancelled);
        sleep(Duration::from_millis(1100)).await;
        assert!(!root.join("a.late").exists());
        assert!(!root.join("b.late").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn pidfd_failure_does_not_block_pre_ready_timeout_or_cancellation() {
        let _test_lock = crate::process::PIDFD_OPEN_FAILURE_LOCK.lock().await;
        let expected_usage = TokenUsage {
            input_tokens: 7,
            output_tokens: 3,
            ..TokenUsage::default()
        };
        let usage_event = serde_json::to_string(&AgentEvent::AssistantMessage {
            thread_name: Some("worker".to_string()),
            content: "partial".to_string(),
            usage: Some(expected_usage.clone()),
        })
        .unwrap();
        for cancel in [false, true] {
            let root =
                std::env::temp_dir().join(format!("nac_worker_pidfd_{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            let executable = root.join("worker.sh");
            let script = format!(
                "#!/bin/sh\n\
                 setsid sh -c 'printf $$ > \"{root}/descendant.pid\"; \
                 printf \"child-output\\n\"; trap \"\" TERM; sleep 30' &\n\
                 printf 'worker-output\\n'\n\
                 printf 'worker-stderr\\n' >&2\n\
                 printf '%s\\n' '{prefix}{usage_event}' >&2\n\
                 sleep 0.1\n\
                 printf ready > \"{root}/ready\"\n\
                 trap '' TERM\n\
                 wait\n",
                prefix = crate::events::STDERR_EVENT_PREFIX,
                root = root.display()
            );
            std::fs::write(&executable, script).unwrap();
            std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();

            let mut runtime = test_runtime();
            runtime.workspace_cwd = root.clone();
            runtime.config_cwd = root.clone();
            runtime.worker_executable = Some(executable);
            let cancellation = ThreadCancellation::default();
            let worker_cancellation = cancellation.clone();
            let no_sources = Vec::<String>::new();
            let no_skills = Vec::<String>::new();
            let client = ModelClient::new_for_test();
            let worker = run_worker(
                &runtime,
                &client,
                WorkerInvocation {
                    session_id: "session",
                    thread_name: "worker",
                    dispatch_id: "dispatch",
                    action: "worker",
                    source_threads: &no_sources,
                    scheduled_skills: &no_skills,
                    timeout_secs: if cancel { 30 } else { 1 },
                },
                worker_cancellation,
            );
            struct PidfdFailureReset;
            impl Drop for PidfdFailureReset {
                fn drop(&mut self) {
                    crate::process::set_pidfd_open_failure_for_test(0);
                }
            }
            let _failure_reset = PidfdFailureReset;
            let stop_when_ready = async {
                let descendant_pid = tokio::time::timeout(Duration::from_secs(2), async {
                    loop {
                        if root.join("ready").exists() {
                            let pid = std::fs::read_to_string(root.join("descendant.pid")).unwrap();
                            break pid.parse::<libc::pid_t>().unwrap();
                        }
                        sleep(Duration::from_millis(10)).await;
                    }
                })
                .await
                .expect("isolated worker descendant did not publish its pid");
                crate::process::set_pidfd_open_failure_for_test(descendant_pid);
                if cancel {
                    cancellation.cancel();
                }
                descendant_pid
            };

            let (run, descendant_pid) = tokio::time::timeout(Duration::from_secs(5), async {
                tokio::join!(worker, stop_when_ready)
            })
            .await
            .expect("worker cleanup remained blocked on inherited pipes");
            let run = run.unwrap();

            assert_eq!(run.cancelled, cancel);
            assert_eq!(run.timed_out, !cancel);
            assert!(run.stdout.contains("worker-output"));
            assert!(run.stdout.contains("child-output"));
            assert!(run.stderr.contains("worker-stderr"));
            assert_eq!(run.usage.as_ref(), Some(&expected_usage));
            assert!(run
                .cleanup_error
                .as_deref()
                .is_some_and(|error| error.contains("pidfd_open/capture")));

            unsafe {
                libc::kill(descendant_pid, libc::SIGKILL);
            }
            let _ = std::fs::remove_dir_all(root);
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_after_leader_exit_kills_pipe_holding_descendant() {
        let root =
            std::env::temp_dir().join(format!("nac_worker_reaped_cancel_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("worker.sh");
        let script = format!(
            r#"#!/bin/sh
printf '%s' "$$" > '{root}/leader.pid'
printf ready > '{root}/descendant-ready'
(trap '' TERM; sleep 1; printf survived > '{root}/late-write') &
exit 0
"#,
            root = root.display()
        );
        std::fs::write(&executable, script).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();

        let mut runtime = test_runtime();
        runtime.workspace_cwd = root.clone();
        runtime.config_cwd = root.clone();
        runtime.store_path = root.join("store.db");
        runtime.worker_executable = Some(executable);
        let cancellation = ThreadCancellation::default();
        let client = ModelClient::new_for_test();
        let no_sources = Vec::<String>::new();
        let no_skills = Vec::<String>::new();
        let worker = run_worker(
            &runtime,
            &client,
            WorkerInvocation {
                session_id: "session",
                thread_name: "worker",
                dispatch_id: "dispatch",
                action: "worker",
                source_threads: &no_sources,
                scheduled_skills: &no_skills,
                timeout_secs: 30,
            },
            cancellation.clone(),
        );
        let cancel_after_reap = async {
            let leader = tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    if root.join("descendant-ready").exists() {
                        let pid = std::fs::read_to_string(root.join("leader.pid"))
                            .unwrap()
                            .parse::<libc::pid_t>()
                            .unwrap();
                        break pid;
                    }
                    sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("worker descendant never became ready");
            tokio::time::timeout(Duration::from_secs(2), async {
                while unsafe { libc::kill(leader, 0) == 0 } {
                    sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("worker leader was not reaped");
            cancellation.cancel();
        };

        let (worker, ()) = tokio::time::timeout(Duration::from_secs(5), async {
            tokio::join!(worker, cancel_after_reap)
        })
        .await
        .expect("cancellation after leader exit did not drain");
        assert!(worker.unwrap().cancelled);
        sleep(Duration::from_millis(1100)).await;
        assert!(!root.join("late-write").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn worker_retains_latest_sanitized_model_error_separately_from_stderr() {
        let root = std::env::temp_dir().join(format!("nac_worker_error_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("worker.sh");
        let model_started = serde_json::to_string(&AgentEvent::ModelCallStarted {
            thread_name: Some("worker".to_string()),
            iteration: 3,
        })
        .unwrap();
        let first = serde_json::to_string(&AgentEvent::ModelError {
            thread_name: Some("worker".to_string()),
            message: "first model error".to_string(),
        })
        .unwrap();
        let second = serde_json::to_string(&AgentEvent::ModelError {
            thread_name: Some("worker".to_string()),
            message: "x".repeat(700),
        })
        .unwrap();
        let script = format!(
            "#!/bin/sh\nprintf '%s\\n' '{prefix}{model_started}' >&2\n\
             printf '%s\\n' '{prefix}{first}' >&2\n\
             printf '%s\\n' 'pid file already exists' >&2\n\
             printf '%s\\n' '{prefix}{second}' >&2\n\
             printf '%s\\n' 'MCP unavailable' >&2\nexit 1\n",
            prefix = crate::events::STDERR_EVENT_PREFIX,
        );
        std::fs::write(&executable, script).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();

        let mut runtime = test_runtime();
        runtime.workspace_cwd = root.clone();
        runtime.config_cwd = root.clone();
        runtime.worker_executable = Some(executable);
        let no_sources = Vec::<String>::new();
        let no_skills = Vec::<String>::new();
        let run = run_worker(
            &runtime,
            &ModelClient::new_for_test(),
            WorkerInvocation {
                session_id: "session",
                thread_name: "worker",
                dispatch_id: "dispatch",
                action: "worker",
                source_threads: &no_sources,
                scheduled_skills: &no_skills,
                timeout_secs: 30,
            },
            ThreadCancellation::default(),
        )
        .await
        .unwrap();

        assert_eq!(run.exit_code, 1);
        assert_eq!(run.model_error.as_deref(), Some("x".repeat(600).as_str()));
        assert_eq!(run.stderr, "pid file already exists\nMCP unavailable");
        assert!(!run.stderr.contains(crate::events::STDERR_EVENT_PREFIX));
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn worker_keeps_pumping_events_past_a_non_utf8_stderr_line() {
        let root = std::env::temp_dir().join(format!("nac_worker_utf8_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let executable = root.join("worker.sh");
        let after = serde_json::to_string(&AgentEvent::ModelError {
            thread_name: Some("worker".to_string()),
            message: "seen after raw bytes".to_string(),
        })
        .unwrap();
        let script = format!(
            "#!/bin/sh\nprintf '%s\\n' 'before' >&2\n\
             printf '\\375\\376\\377\\n' >&2\n\
             printf '%s\\n' '{prefix}{after}' >&2\n\
             printf '%s\\n' 'after' >&2\nexit 0\n",
            prefix = crate::events::STDERR_EVENT_PREFIX,
        );
        std::fs::write(&executable, script).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();

        let mut runtime = test_runtime();
        runtime.workspace_cwd = root.clone();
        runtime.config_cwd = root.clone();
        runtime.worker_executable = Some(executable);
        let no_sources = Vec::<String>::new();
        let no_skills = Vec::<String>::new();
        let run = run_worker(
            &runtime,
            &ModelClient::new_for_test(),
            WorkerInvocation {
                session_id: "session",
                thread_name: "worker",
                dispatch_id: "dispatch",
                action: "worker",
                source_threads: &no_sources,
                scheduled_skills: &no_skills,
                timeout_secs: 30,
            },
            ThreadCancellation::default(),
        )
        .await
        .unwrap();

        assert_eq!(run.exit_code, 0);
        assert_eq!(run.model_error.as_deref(), Some("seen after raw bytes"));
        assert_eq!(run.stderr, "before\nafter");
        let _ = std::fs::remove_dir_all(root);
    }

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

    #[cfg(unix)]
    #[test]
    fn mounted_model_credential_transport_contains_only_the_read_only_path() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "nac-mounted-model-transport-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let credential = root.join("credential");
        std::fs::write(&credential, "mounted-secret-value\n").unwrap();
        std::fs::set_permissions(&credential, std::fs::Permissions::from_mode(0o400)).unwrap();

        let settings = EffectiveModelSettings::new(
            BackendKind::ArceeApi,
            "trinity-large-thinking".to_string(),
            "https://api.arcee.ai/api/v1".to_string(),
            None,
            None,
            BTreeMap::new(),
        )
        .unwrap()
        .with_trusted_api_key_file(Some(credential.clone()))
        .unwrap();
        let client = ModelClient::from_effective_settings(settings).unwrap();
        let args = worker_model_arguments_for_test(&client);

        assert!(args.windows(2).any(|pair| {
            pair[0] == "--managed-api-key-file" && pair[1] == credential.to_string_lossy()
        }));
        assert!(!args.iter().any(|arg| arg == "mounted-secret-value"));
        assert!(!args.iter().any(|arg| arg == "--api-key-env"));
        let _ = std::fs::remove_dir_all(root);
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
