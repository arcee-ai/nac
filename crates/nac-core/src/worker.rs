use std::collections::HashSet;
use std::io::BufRead;

use crate::tools::ThreadCancellation;
use anyhow::Result;

use crate::agent::Agent;
use crate::skills::SkillRegistry;
use crate::store::{self, WorkerContext};
use crate::types::Message;
use crate::worker_credentials::{ManagedWorkerCredentialReceiver, ManagedWorkerNativeCredentials};

pub(crate) const MANAGED_WORKER_HISTORY_READY: &str = "__NAC_HISTORY_READY__";
pub(crate) const MANAGED_WORKER_CANCEL_ACK: &str = "__NAC_CANCEL_ACK__";

pub struct ManagedWorkerRunConfig {
    pub(crate) agent: Agent,
    pub(crate) session_id: String,
    pub(crate) thread_name: String,
    pub(crate) action: String,
    pub(crate) dispatch_id: String,
}

impl ManagedWorkerRunConfig {
    pub fn set_command_environment_provider(
        &mut self,
        provider: Option<std::sync::Arc<dyn nac_contracts::CommandEnvironmentProvider>>,
    ) {
        self.agent.set_command_environment_provider(provider);
    }
}

pub fn build_worker_context_messages(
    thread_name: &str,
    worker_context: &WorkerContext,
) -> Vec<Message> {
    let mut messages = Vec::new();
    if let Some(self_context) =
        store::render_self_context(thread_name, &worker_context.self_episodes)
    {
        messages.push(Message::User {
            content: self_context,
        });
    }
    for source_episode in &worker_context.source_episodes {
        messages.push(Message::User {
            content: store::render_source_context(source_episode),
        });
    }
    messages
}

pub fn build_preloaded_skill_messages(
    registry: Option<&SkillRegistry>,
    names: &[String],
) -> Result<Vec<Message>> {
    if names.is_empty() {
        return Ok(Vec::new());
    }

    let Some(registry) = registry else {
        anyhow::bail!("requested skills but no skills are available");
    };

    let mut seen = HashSet::new();
    let mut messages = Vec::new();
    for name in names {
        if !seen.insert(name.as_str()) {
            continue;
        }
        if !registry.has_skill(name) {
            anyhow::bail!("unknown skill '{name}'");
        }

        let activated = registry.activate(name);
        messages.push(Message::System {
            content: format!(
                "The orchestrator preloaded this skill for this worker dispatch.\n\n{}",
                activated.content
            ),
        });
    }

    Ok(messages)
}

fn spawn_cancellation_listener(
    command_cancellation: ThreadCancellation,
    ready: Option<std::sync::mpsc::Sender<()>>,
    completion: Option<(
        crate::worker_protocol::Completion,
        tokio::sync::oneshot::Sender<Result<()>>,
    )>,
) {
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        let mut input = stdin.lock();
        if let Some(ready) = ready {
            let _ = ready.send(());
        }
        let result = (|| -> Result<()> {
            let mut bytes = Vec::new();
            let count = std::io::Read::take(
                &mut input,
                crate::worker_protocol::MAX_CONTROL_BYTES as u64 + 1,
            )
            .read_until(b'\n', &mut bytes)?;
            anyhow::ensure!(
                count > 0 && bytes.len() <= crate::worker_protocol::MAX_CONTROL_BYTES,
                "host control pipe closed or exceeded its limit before acknowledgement"
            );
            let line = String::from_utf8(bytes)?;
            if line.trim() == "cancel" {
                eprintln!("{MANAGED_WORKER_CANCEL_ACK}");
                anyhow::bail!("worker cancelled by host");
            }
            anyhow::ensure!(
                completion
                    .as_ref()
                    .is_some_and(|(expected, _)| expected.validates_ack(line.trim_end())),
                "invalid host commit acknowledgement"
            );
            Ok(())
        })();
        if result.is_err() {
            command_cancellation.cancel();
        }
        if let Some((_, sender)) = completion {
            let _ = sender.send(result);
        }
    });
}

pub async fn run_managed_worker(
    run_config: ManagedWorkerRunConfig,
    credential_receiver: ManagedWorkerCredentialReceiver,
) -> Result<()> {
    // The CLI builds `run_config`, including every configured MCP transport,
    // before entering this function. Only now does the worker announce
    // readiness and receive the credential over its non-inherited socket.
    let credentials = credential_receiver.receive_after_mcp().await?;
    run_managed_worker_with_credentials(run_config, credentials).await
}

async fn run_managed_worker_with_credentials(
    run_config: ManagedWorkerRunConfig,
    credentials: ManagedWorkerNativeCredentials,
) -> Result<()> {
    let mut completion = crate::worker_protocol::Completion {
        session_id: run_config.session_id.clone(),
        thread_name: run_config.thread_name.clone(),
        dispatch_id: run_config.dispatch_id.clone(),
        content: String::new(),
    };
    let (ack_tx, ack_rx) = tokio::sync::oneshot::channel();
    let cancellation = run_config.agent.command_cancellation();
    spawn_cancellation_listener(
        cancellation.clone(),
        None,
        Some((completion.clone(), ack_tx)),
    );
    let response = produce_worker_response(run_config, credentials).await?;
    completion.content = response;
    use std::io::Write;
    // Stderr is ordered: the host acknowledges all prefix events before this barrier.
    eprintln!("{MANAGED_WORKER_HISTORY_READY}");
    std::io::stderr().lock().flush()?;
    std::io::stdout()
        .lock()
        .write_all(completion.encode()?.as_bytes())?;
    std::io::stdout().lock().flush()?;
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => anyhow::bail!("worker cancelled before commit acknowledgement"),
        ack = ack_rx => ack.map_err(|_| anyhow::anyhow!("host acknowledgement listener stopped"))??,
    }
    crate::events::EventSink::stderr_prefixed().emit(crate::events::AgentEvent::RunFinished {
        thread_name: Some(completion.thread_name),
    });
    Ok(())
}

async fn produce_worker_response(
    run_config: ManagedWorkerRunConfig,
    credentials: ManagedWorkerNativeCredentials,
) -> Result<String> {
    let ManagedWorkerRunConfig {
        mut agent, action, ..
    } = run_config;
    agent.set_worker_web_credential(credentials.into_exa_api_key());
    let cancellation = agent.command_cancellation();
    let response = if cancellation.has_host_execution_authority() {
        tokio::select! {
        biased;
        () = cancellation.cancelled() => Err(anyhow::anyhow!("worker execution authority cancelled")),
        result = agent.send(&action) => result,
        }
    } else {
        agent.send(&action).await
    };
    if cancellation.is_cancelled() {
        agent.terminal_manager().settle_run().await?;
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{AgentConfig, AgentMode};
    use crate::events::EventSink;
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};
    use crate::model::ModelClient;
    use crate::skills::SkillRecord;
    use crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS;
    use std::io::{Read, Write};
    use std::path::PathBuf;
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};

    #[tokio::test]
    async fn host_execution_worker_without_tool_activity_stops_after_local_denial() {
        let fixture = crate::model::host_execution_test_support::Fixture::new();
        let authority_path = fixture.root.join("managed_host_key.json");
        let server = ScriptedServer::start_observed(
            vec![ScriptedResponse::json("503 Service Unavailable", "{}")],
            move |_, _| {
                std::fs::remove_file(&authority_path).unwrap();
            },
        );
        let client = ModelClient::new_for_test_server(server.base_url.clone())
            .with_host_execution_authority(Some(fixture.authority.clone()))
            .unwrap();
        let store_path = fixture.root.join("worker-store.db");
        store::initialize(&store_path).unwrap();
        store::insert_test_session(&store_path, "session");
        let agent = test_worker_agent(client, store_path);
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            produce_worker_response(
                ManagedWorkerRunConfig {
                    agent,
                    session_id: "session".into(),
                    thread_name: "impl".into(),
                    action: "synthetic guarded work".into(),
                    dispatch_id: "dispatch".into(),
                },
                ManagedWorkerNativeCredentials::default(),
            ),
        )
        .await
        .unwrap();
        assert!(result.is_err());
        assert!(fixture.authority.check_available().is_err());
        assert_eq!(server.finish().len(), 1);
    }

    fn test_registry() -> SkillRegistry {
        SkillRegistry::load_for_test(vec![SkillRecord {
            name: "code-review".to_string(),
            description: "Review code quality".to_string(),
            compatibility: None,
            skill_root_visible: PathBuf::from("/tmp/code-review"),
            body: "Review body instructions.".to_string(),
            resources: Vec::new(),
        }])
    }

    fn test_worker_agent(client: ModelClient, store_path: PathBuf) -> Agent {
        Agent::with_config(
            client,
            AgentConfig {
                command_output_limits: crate::terminal::CommandOutputLimits::default(),
                mode: AgentMode::Worker,
                session_behavior: None,
                store_path,
                session_id: Some("session".to_string()),
                orchestrator_compaction_threshold: None,
                initial_messages: Vec::new(),
                thread_name: Some("impl".to_string()),
                dispatch_id: Some("dispatch".to_string()),
                event_sink: EventSink::none(),
                workspace_cwd: PathBuf::from("."),
                config_cwd: PathBuf::from("."),
                working_directory: ".".to_string(),
                worker_executable: None,
                sandbox: None,
                ssh: None,
                mcp: None,
                skills: None,
                extra_tool_defs: Vec::new(),
                agents_md_message: None,
                thread_timeout_secs: DEFAULT_THREAD_TIMEOUT_SECS,
                light_client: None,
                permission_rules: Vec::new(),
            },
        )
        .expect("worker agent config must be valid")
    }

    #[tokio::test]
    async fn managed_worker_credential_is_model_safe_and_absent_from_durable_state() {
        let root = std::env::temp_dir().join(format!(
            "nac_worker_credential_store_{}",
            uuid::Uuid::new_v4()
        ));
        let store_path = root.join("store.db");
        store::initialize(&store_path).unwrap();
        store::insert_test_session(&store_path, "session");
        let response = serde_json::json!({
            "status": "completed",
            "output": [{
                "type": "message",
                "content": [{"type": "output_text", "text": "worker answer"}]
            }],
            "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
        })
        .to_string();
        let server = ScriptedServer::start(vec![ScriptedResponse::json("200 OK", response)]);
        let credential = "exa-durable-state-canary";
        let run_config = ManagedWorkerRunConfig {
            agent: test_worker_agent(
                ModelClient::new_for_test_server(server.base_url.clone()),
                store_path.clone(),
            ),
            dispatch_id: "dispatch".to_string(),
            session_id: "session".to_string(),
            thread_name: "impl".to_string(),
            action: "answer the delegated question".to_string(),
        };

        let answer = produce_worker_response(
            run_config,
            ManagedWorkerNativeCredentials::for_test(Some(credential)),
        )
        .await
        .unwrap();

        let requests = server.finish();
        assert_eq!(requests.len(), 1);
        let request = String::from_utf8_lossy(&requests[0].body);
        assert!(request.contains("web_search"));
        assert!(request.contains("web_fetch"));
        assert!(!request.contains(credential));

        let episodes = store::thread_read(&store_path, "session", "impl").unwrap();
        assert!(
            episodes.is_empty(),
            "worker must leave durable episode ownership to the host"
        );
        assert_eq!(answer, "worker answer");
        assert!(
            store::TranscriptLogWriter::new(&store_path)
                .unwrap()
                .read_from("session", 0)
                .unwrap()
                .is_empty(),
            "worker execution must not write orchestrator transcript rows"
        );
        for entry in std::fs::read_dir(&root).unwrap() {
            let path = entry.unwrap().path();
            if path.is_file() {
                let bytes = std::fs::read(&path).unwrap();
                assert!(
                    !bytes
                        .windows(credential.len())
                        .any(|window| window == credential.as_bytes()),
                    "credential persisted in {}",
                    path.display()
                );
            }
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn cancellation_listener_process_helper() {
        let Some(mode) = std::env::var_os("NAC_CANCELLATION_LISTENER_HELPER") else {
            return;
        };
        let cancellation = ThreadCancellation::default();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        spawn_cancellation_listener(cancellation.clone(), Some(ready_tx), None);
        ready_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("cancellation listener did not start reading");
        if mode == "wait-cancel" {
            tokio::time::timeout(Duration::from_secs(2), cancellation.cancelled())
                .await
                .expect("cancellation listener did not cancel");
        }
    }

    fn assert_child_exits(child: &mut Child, panic_message: &str) {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if let Some(status) = child.try_wait().unwrap() {
                assert!(status.success());
                return;
            }
            if Instant::now() >= deadline {
                child.kill().unwrap();
                let _ = child.wait();
                panic!("{panic_message}");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn cancellation_listener_does_not_hold_runtime_open_with_parent_stdin() {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "worker::tests::cancellation_listener_process_helper",
                "--nocapture",
            ])
            .env("NAC_CANCELLATION_LISTENER_HELPER", "exit")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let _open_stdin = child.stdin.take().unwrap();
        assert_child_exits(&mut child, "cancellation listener held the runtime open");
    }

    #[test]
    fn cancellation_listener_acknowledges_and_delivers_cancel() {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "worker::tests::cancellation_listener_process_helper",
                "--nocapture",
            ])
            .env("NAC_CANCELLATION_LISTENER_HELPER", "wait-cancel")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let mut open_stdin = child.stdin.take().unwrap();
        open_stdin.write_all(b"cancel\n").unwrap();
        open_stdin.flush().unwrap();
        assert_child_exits(&mut child, "cancellation listener ignored cancel");
        let mut stderr = String::new();
        child
            .stderr
            .take()
            .unwrap()
            .read_to_string(&mut stderr)
            .unwrap();
        assert!(stderr.contains(MANAGED_WORKER_CANCEL_ACK));
    }

    #[test]
    fn preloaded_skill_messages_dedupe_validate_and_precede_context() {
        let registry = test_registry();
        let names = vec!["code-review".to_string(), "code-review".to_string()];
        let mut messages = build_preloaded_skill_messages(Some(&registry), &names).unwrap();
        messages.extend(build_worker_context_messages(
            "impl",
            &WorkerContext {
                self_episodes: vec![store::EpisodeRecord {
                    id: 1,
                    thread_name: "impl".to_string(),
                    session_id: "session".to_string(),
                    action: "previous".to_string(),
                    content: "retained context".to_string(),
                    status: store::EpisodeStatus::Ok.as_str().to_string(),
                    created_at: "now".to_string(),
                }],
                source_episodes: Vec::new(),
            },
        ));

        assert_eq!(messages.len(), 2);
        match &messages[0] {
            Message::System { content } => {
                assert!(content.contains("orchestrator preloaded this skill"));
                assert!(content.contains("<skill_content name=\"code-review\">"));
                assert!(content.contains("Review body instructions."));
            }
            other => panic!("expected preloaded skill system message, got {:?}", other),
        }
        match &messages[1] {
            Message::User { content } => assert!(content.contains("retained context")),
            other => panic!("expected retained context after skill, got {:?}", other),
        }

        let agent = Agent::with_config(
            ModelClient::new_for_test(),
            AgentConfig {
                command_output_limits: crate::terminal::CommandOutputLimits::default(),
                mode: AgentMode::Worker,
                session_behavior: None,
                store_path: store::default_store_path(),
                session_id: None,
                orchestrator_compaction_threshold: None,
                initial_messages: messages.clone(),
                thread_name: Some("impl".to_string()),
                dispatch_id: None,
                event_sink: EventSink::none(),
                workspace_cwd: PathBuf::from("."),
                config_cwd: PathBuf::from("."),
                working_directory: ".".to_string(),
                worker_executable: None,
                sandbox: None,
                ssh: None,
                mcp: None,
                skills: None,
                extra_tool_defs: Vec::new(),
                agents_md_message: Some("AGENTS.md worker instructions".to_string()),
                thread_timeout_secs: DEFAULT_THREAD_TIMEOUT_SECS,
                light_client: None,
                permission_rules: Vec::new(),
            },
        )
        .expect("agent config must be valid");
        let system_messages = agent
            .messages
            .iter()
            .filter(|message| matches!(message, Message::System { .. }))
            .count();
        assert_eq!(system_messages, 1);
        assert_eq!(agent.messages.len(), 2);
        match (&agent.messages[0], &agent.messages[1]) {
            (Message::System { content }, Message::User { content: context }) => {
                assert!(content.contains("AGENTS.md worker instructions"));
                assert!(content.contains("orchestrator preloaded this skill"));
                assert!(content.contains("<skill_content name=\"code-review\">"));
                assert!(context.contains("retained context"));
            }
            other => panic!(
                "expected merged system then retained context, got {:?}",
                other
            ),
        }

        let missing = vec!["missing".to_string()];
        assert!(build_preloaded_skill_messages(Some(&registry), &missing)
            .unwrap_err()
            .to_string()
            .contains("unknown skill 'missing'"));
        assert!(build_preloaded_skill_messages(None, &missing)
            .unwrap_err()
            .to_string()
            .contains("no skills are available"));
    }
}
