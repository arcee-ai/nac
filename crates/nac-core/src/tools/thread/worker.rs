use std::collections::BTreeMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::events::{decode_stderr_event, AgentEvent};
use crate::model::{ModelClient, TokenUsage};
use crate::process::{isolate_process_group, ProcessGroupGuard};
use crate::tools::{ThreadCancellation, ToolRuntime};

pub(super) struct WorkerRun {
    pub(super) stdout: String,
    pub(super) stderr: String,
    pub(super) exit_code: i32,
    pub(super) timed_out: bool,
    pub(super) cancelled: bool,
    pub(super) timeout_reason: Option<String>,
    pub(super) usage: Option<TokenUsage>,
    pub(super) usage_persistence_error: Option<String>,
    // Retained until the registry terminal transition resolves. A cancellation
    // that wins after natural child exit can still sweep pipe-holding descendants.
    pub(super) child: tokio::process::Child,
    pub(super) process_group: ProcessGroupGuard,
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
            AgentEvent::ThreadStarted { .. }
            | AgentEvent::ThreadFinished { .. }
            | AgentEvent::ThreadCompletionDelivered { .. } => {}
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
    pub(super) cancellation: &'a ThreadCancellation,
    pub(super) dispatch_key: Option<&'a crate::tools::ThreadDispatchKey>,
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
    let process_group = ProcessGroupGuard::for_child(&child);

    let timeout_trace = Arc::new(Mutex::new(WorkerTimeoutTrace::default()));
    let stderr = child.stderr.take().unwrap();
    let event_sink = runtime.event_sink.clone();
    let usage_identity = invocation
        .dispatch_key
        .map(|key| crate::store::WorkerUsageIdentity {
            session_id: invocation.session_id.to_string(),
            origin_run_id: key.run_id.to_string(),
            dispatch_id: key.dispatch_id.clone(),
            thread_name: key.thread_name.clone(),
            originating_tool_call_id: key.tool_call_id.clone(),
        });
    let usage_store_path = runtime.store_path.clone();
    // Reader guards participate in exact dispatch draining. Dropping the outer
    // process-owner aborts the JoinSet, but drain does not complete until both
    // cancelled reader tasks have actually dropped these guards.
    let stderr_task_guard = invocation
        .dispatch_key
        .map(|key| runtime.active_threads.register_dispatch_task(key.clone()));
    let stdout_task_guard = invocation
        .dispatch_key
        .map(|key| runtime.active_threads.register_dispatch_task(key.clone()));
    let thread_name_for_logs = invocation.thread_name.to_string();
    let timeout_trace_for_logs = timeout_trace.clone();
    enum ReaderOutput {
        Stderr(String, Option<TokenUsage>, Option<String>),
        Stdout(String),
    }
    // JoinSet owns the pipe readers. If this process-owner future is force
    // aborted, dropping the set aborts both readers instead of detaching them.
    let mut readers = tokio::task::JoinSet::new();
    readers.spawn(async move {
        let _task_guard = stderr_task_guard;
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        let mut output = String::new();
        let mut worker_usage = TokenUsage::default();
        let mut persistence_error = None;
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(event) = decode_stderr_event(&line) {
                timeout_trace_for_logs.lock().await.observe(&event);
                if let AgentEvent::AssistantMessage {
                    usage: Some(usage), ..
                } = &event
                {
                    worker_usage += usage.clone();
                    // Persist the dispatch cumulative total before relaying the
                    // usage-bearing event. A crash after this point cannot lose
                    // already reported worker usage.
                    if persistence_error.is_none() {
                        if let Some(identity) = &usage_identity {
                            if let Err(error) = crate::store::upsert_worker_dispatch_usage_total(
                                &usage_store_path,
                                identity,
                                &worker_usage,
                                None,
                            ) {
                                persistence_error = Some(format!("{error:#}"));
                            }
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
        ReaderOutput::Stderr(output, usage, persistence_error)
    });

    let stdout = child.stdout.take().unwrap();
    readers.spawn(async move {
        let _task_guard = stdout_task_guard;
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut output = String::new();
        while let Ok(Some(line)) = lines.next_line().await {
            if !output.is_empty() {
                output.push('\n');
            }
            output.push_str(&line);
        }
        ReaderOutput::Stdout(output)
    });

    let deadline = tokio::time::sleep(Duration::from_secs(invocation.timeout_secs));
    tokio::pin!(deadline);
    let cancelled_signal = invocation.cancellation.cancelled();
    tokio::pin!(cancelled_signal);
    let mut timed_out = false;
    let mut cancelled = false;
    let status = tokio::select! {
        status = child.wait() => Some(status),
        _ = &mut deadline => {
            timed_out = true;
            None
        }
        _ = &mut cancelled_signal => {
            cancelled = true;
            None
        }
    };
    // Cancellation may linearize concurrently with child exit. Recheck the
    // token before relinquishing process-group ownership so descendants cannot
    // survive merely because child.wait() won the select.
    if !cancelled && invocation.cancellation.is_cancelled() {
        cancelled = true;
    }
    if timed_out || cancelled {
        process_group.terminate(&mut child).await;
    }

    let mut stderr = String::new();
    let mut stdout = String::new();
    let mut worker_usage = None;
    let mut usage_persistence_error = None;
    while !readers.is_empty() {
        tokio::select! {
            biased;
            _ = &mut cancelled_signal, if !cancelled => {
                cancelled = true;
                timed_out = false;
                process_group.terminate(&mut child).await;
            }
            _ = &mut deadline, if !timed_out && !cancelled => {
                timed_out = true;
                process_group.terminate(&mut child).await;
            }
            reader = readers.join_next() => {
                let Some(reader) = reader else { break; };
                match reader {
                    Ok(ReaderOutput::Stderr(output, usage, persistence_error)) => {
                        stderr = output;
                        worker_usage = usage;
                        usage_persistence_error = persistence_error;
                    }
                    Ok(ReaderOutput::Stdout(output)) => stdout = output,
                    Err(_) => {}
                }
            }
        }
    }
    let timeout_reason = if timed_out {
        Some(timeout_trace.lock().await.timeout_reason())
    } else {
        None
    };
    let exit_code = match status {
        Some(wait_result) => wait_result?.code().unwrap_or(-1),
        None => -1,
    };

    Ok(WorkerRun {
        stdout,
        stderr,
        exit_code,
        timed_out,
        cancelled,
        timeout_reason,
        usage: worker_usage,
        usage_persistence_error,
        child,
        process_group,
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

    #[cfg(unix)]
    #[tokio::test]
    async fn cancelling_worker_drains_readers_kills_tree_and_preserves_partial_usage() {
        use crate::events::{SessionRunId, STDERR_EVENT_PREFIX};
        use crate::tools::test_runtime;
        use std::os::unix::fs::PermissionsExt;

        tokio::time::timeout(Duration::from_secs(4), async {
            let root = std::env::temp_dir()
                .join(format!("nac_worker_cancel_{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            let usage = TokenUsage {
                input_tokens: 17,
                output_tokens: 5,
                ..TokenUsage::default()
            };
            let event = serde_json::to_string(&AgentEvent::AssistantMessage {
                thread_name: Some("A".to_string()),
                content: "partial".to_string(),
                usage: Some(usage.clone()),
            })
            .unwrap();
            let executable = root.join("worker.sh");
            std::fs::write(
                &executable,
                format!(
                    "#!/bin/sh\ntrap '' TERM\n(trap '' TERM; while :; do sleep 1; done) &\necho $! > '{grandchild}'\necho '{prefix}{event}' >&2\necho ready > '{ready}'\nwhile :; do echo stdout; echo stderr >&2; sleep 0.02; done\n",
                    grandchild = root.join("grandchild.pid").display(),
                    ready = root.join("ready").display(),
                    prefix = STDERR_EVENT_PREFIX,
                ),
            )
            .unwrap();
            let mut permissions = std::fs::metadata(&executable).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&executable, permissions).unwrap();

            let mut runtime = test_runtime();
            runtime.worker_executable = Some(executable);
            runtime.workspace_cwd = root.clone();
            runtime.config_cwd = root.clone();
            runtime.store_path = root.join("store.db");
            crate::store::initialize(&runtime.store_path).unwrap();
            crate::store::insert_test_session(&runtime.store_path, "test-session");
            let cancellation = ThreadCancellation::default();
            let canceller = cancellation.clone();
            let ready = root.join("ready");
            tokio::spawn(async move {
                while !ready.exists() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
                canceller.cancel();
            });
            let run_id = SessionRunId::new();
            let dispatch_key = crate::tools::ThreadDispatchKey::new(
                run_id.clone(),
                "A",
                "dispatch",
                "tool-call",
            );
            let result = run_worker(
                &runtime,
                &ModelClient::new_for_test(),
                WorkerInvocation {
                    session_id: "test-session",
                    thread_name: "A",
                    dispatch_id: "dispatch",
                    action: "work",
                    source_threads: &[],
                    scheduled_skills: &[],
                    timeout_secs: 30,
                    cancellation: &cancellation,
                    dispatch_key: Some(&dispatch_key),
                },
            )
            .await
            .unwrap();
            assert!(result.cancelled);
            assert_eq!(result.usage, Some(usage.clone()));
            let rows = crate::store::load_session_worker_usage(&runtime.store_path, "test-session")
                .unwrap();
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].identity.origin_run_id, run_id.to_string());
            assert_eq!(rows[0].usage, usage);
            assert_eq!(rows[0].terminal_status, None);
            let grandchild = std::fs::read_to_string(root.join("grandchild.pid"))
                .unwrap()
                .trim()
                .parse::<u32>()
                .unwrap();
            tokio::time::timeout(Duration::from_secs(1), async {
                while std::fs::read_to_string(format!("/proc/{grandchild}/stat"))
                    .ok()
                    .is_some_and(|stat| stat.split_whitespace().nth(2) != Some("Z"))
                {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await
            .expect("grandchild survived worker cancellation");
            let _ = std::fs::remove_dir_all(root);
        })
        .await
        .expect("worker cancellation test timed out");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timed_out_and_failed_workers_persist_and_finalize_partial_usage_once() {
        use crate::events::{SessionRunId, STDERR_EVENT_PREFIX};
        use crate::tools::test_runtime;
        use std::os::unix::fs::PermissionsExt;

        tokio::time::timeout(Duration::from_secs(8), async {
            let root = std::env::temp_dir().join(format!(
                "nac_worker_partial_terminal_{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&root).unwrap();
            let usage = TokenUsage {
                input_tokens: 13,
                output_tokens: 4,
                ..TokenUsage::default()
            };
            let event = serde_json::to_string(&AgentEvent::AssistantMessage {
                thread_name: Some("worker".to_string()),
                content: "partial".to_string(),
                usage: Some(usage.clone()),
            })
            .unwrap();
            let mut runtime = test_runtime();
            runtime.workspace_cwd = root.clone();
            runtime.config_cwd = root.clone();
            runtime.store_path = root.join("store.db");
            crate::store::initialize(&runtime.store_path).unwrap();
            crate::store::insert_test_session(&runtime.store_path, "test-session");

            for (name, dispatch_id, tail, expect_timeout) in [
                ("timed-out", "timeout-dispatch", "sleep 5", true),
                ("failed", "failure-dispatch", "exit 7", false),
            ] {
                let executable = root.join(format!("{name}.sh"));
                std::fs::write(
                    &executable,
                    format!("#!/bin/sh\necho '{STDERR_EVENT_PREFIX}{event}' >&2\n{tail}\n"),
                )
                .unwrap();
                let mut permissions = std::fs::metadata(&executable).unwrap().permissions();
                permissions.set_mode(0o755);
                std::fs::set_permissions(&executable, permissions).unwrap();
                runtime.worker_executable = Some(executable);
                let key = crate::tools::ThreadDispatchKey::new(
                    SessionRunId::new(),
                    name,
                    dispatch_id,
                    "tool-call",
                );
                assert!(runtime.active_threads.try_accept(key.clone()));
                let cancellation = ThreadCancellation::default();
                let result = run_worker(
                    &runtime,
                    &ModelClient::new_for_test(),
                    WorkerInvocation {
                        session_id: "test-session",
                        thread_name: name,
                        dispatch_id,
                        action: "work",
                        source_threads: &[],
                        scheduled_skills: &[],
                        timeout_secs: 1,
                        cancellation: &cancellation,
                        dispatch_key: Some(&key),
                    },
                )
                .await
                .unwrap();
                assert_eq!(result.timed_out, expect_timeout);
                assert_eq!(result.usage, Some(usage.clone()));
                assert!(runtime
                    .active_threads
                    .finalize_once(
                        &runtime.store_path,
                        "test-session",
                        crate::tools::ThreadCompletion {
                            key: key.clone(),
                            content: "terminal".into(),
                            is_error: true,
                        },
                        crate::events::ThreadDispatchStatus::Failed,
                        result.usage.as_ref(),
                        true,
                    )
                    .unwrap()
                    .is_some());
                assert!(runtime
                    .active_threads
                    .finalize_once(
                        &runtime.store_path,
                        "test-session",
                        crate::tools::ThreadCompletion {
                            key,
                            content: "duplicate".into(),
                            is_error: true,
                        },
                        crate::events::ThreadDispatchStatus::Failed,
                        result.usage.as_ref(),
                        true,
                    )
                    .unwrap()
                    .is_none());
            }

            let rows = crate::store::load_session_worker_usage(&runtime.store_path, "test-session")
                .unwrap();
            assert_eq!(rows.len(), 2);
            assert!(rows.iter().all(|row| row.usage == usage));
            assert!(rows.iter().all(|row| {
                row.terminal_status == Some(crate::events::ThreadDispatchStatus::Failed)
            }));
            let total =
                crate::store::aggregate_session_worker_usage(&runtime.store_path, "test-session")
                    .unwrap()
                    .unwrap();
            assert_eq!(total.input_tokens, 26);
            assert_eq!(total.output_tokens, 8);
            assert_eq!(
                runtime
                    .active_threads
                    .take_completions(
                        &std::collections::HashSet::new(),
                        &std::collections::HashSet::new(),
                    )
                    .len(),
                2
            );
            let _ = std::fs::remove_dir_all(root);
        })
        .await
        .expect("worker partial terminal test timed out");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_after_leader_exit_sweeps_pipe_holding_descendant() {
        use crate::tools::test_runtime;
        use std::os::unix::fs::PermissionsExt;

        tokio::time::timeout(Duration::from_secs(5), async {
            let root = std::env::temp_dir()
                .join(format!("nac_worker_exited_leader_{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            let executable = root.join("worker.sh");
            std::fs::write(
                &executable,
                format!(
                    "#!/bin/sh\n/bin/sh -c 'trap \"\" TERM; while :; do sleep 1; done' &\necho $! > '{descendant}'\necho exited > '{exited}'\nexit 0\n",
                    descendant = root.join("descendant.pid").display(),
                    exited = root.join("leader-exited").display(),
                ),
            )
            .unwrap();
            let mut permissions = std::fs::metadata(&executable).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&executable, permissions).unwrap();

            let mut runtime = test_runtime();
            runtime.worker_executable = Some(executable);
            runtime.workspace_cwd = root.clone();
            runtime.config_cwd = root.clone();
            let cancellation = ThreadCancellation::default();
            let canceller = cancellation.clone();
            let exited = root.join("leader-exited");
            tokio::spawn(async move {
                while !exited.exists() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
                canceller.cancel();
            });
            let mut result = run_worker(
                &runtime,
                &ModelClient::new_for_test(),
                WorkerInvocation {
                    session_id: "test-session",
                    thread_name: "A",
                    dispatch_id: "dispatch",
                    action: "work",
                    source_threads: &[],
                    scheduled_skills: &[],
                    timeout_secs: 30,
                    cancellation: &cancellation,
                    dispatch_key: None,
                },
            )
            .await
            .unwrap();
            assert!(result.cancelled);
            let descendant = std::fs::read_to_string(root.join("descendant.pid"))
                .unwrap()
                .trim()
                .parse::<u32>()
                .unwrap();
            tokio::time::timeout(Duration::from_secs(2), async {
                while std::path::Path::new(&format!("/proc/{descendant}")).exists() {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await
            .expect("pipe-holding descendant remained live or zombie");
            result.process_group.disarm();
            let _ = std::fs::remove_dir_all(root);
        })
        .await
        .expect("leader-exit cancellation test timed out");
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
