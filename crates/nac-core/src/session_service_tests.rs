use super::*;
use crate::agent::{AgentConfig, AgentMode};
use crate::model::ModelClient;
use crate::types::{FunctionCall, ToolCall};
use std::collections::BTreeMap;

fn thread_call(id: &str, arguments: &str) -> ToolCall {
    ToolCall {
        id: id.to_string(),
        call_type: "function".to_string(),
        function: FunctionCall {
            name: "thread".to_string(),
            arguments: arguments.to_string(),
        },
    }
}

fn mixed_message_history() -> Vec<Message> {
    vec![
        Message::System {
            content: "system-one".to_string(),
        },
        Message::User {
            content: "older request".to_string(),
        },
        Message::Assistant {
            content: None,
            reasoning_text: Some("reasoning without visible content".to_string()),
            reasoning_details: Some(serde_json::json!({"type": "reasoning"})),
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::Tool {
            tool_call_id: "older-tool".to_string(),
            content: "older result".into(),
        },
        Message::System {
            content: "system-two".to_string(),
        },
        Message::User {
            content: "latest request".to_string(),
        },
        Message::Assistant {
            content: None,
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: Some(vec![
                thread_call(
                    "thread-zeta",
                    r#"{"name":" zeta ","action":"outside the returned tail"}"#,
                ),
                thread_call("thread-malformed", r#"{"name":"broken"#),
                thread_call("thread-empty", r#"{"name":"   "}"#),
            ]),
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::Tool {
            tool_call_id: "thread-zeta".to_string(),
            content: "zeta started".into(),
        },
        Message::Assistant {
            content: None,
            reasoning_text: Some("new reasoning".to_string()),
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::System {
            content: "system-three".to_string(),
        },
        Message::Assistant {
            content: None,
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: Some(vec![thread_call(
                "thread-alpha",
                r#"{"name":"alpha","action":"inside the cycle"}"#,
            )]),
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::Tool {
            tool_call_id: "thread-alpha".to_string(),
            content: "alpha started".into(),
        },
        Message::Assistant {
            content: Some("latest answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
    ]
}

fn legacy_page_messages(messages: &[Message], request: MessagePageRequest) -> MessagesPageSnapshot {
    let visible = messages
        .iter()
        .filter(|message| request.include_system || !matches!(message, Message::System { .. }))
        .cloned()
        .collect::<Vec<_>>();
    let total = visible.len();
    let end = request.before.unwrap_or(total).min(total);
    let start = end.saturating_sub(request.limit.max(1));
    MessagesPageSnapshot {
        messages: visible[start..end].to_vec(),
        created_at: Vec::new(),
        page: MessagePageMetadata {
            start,
            end,
            total,
            has_older: start > 0,
        },
    }
}

#[test]
fn paged_messages_match_legacy_windows_for_mixed_history_and_cursor_bounds() {
    let messages = mixed_message_history();
    for include_system in [false, true] {
        for before in [None, Some(0), Some(1), Some(3), Some(usize::MAX)] {
            for limit in [0, 1, 4, 100] {
                let request = MessagePageRequest {
                    before,
                    limit,
                    include_system,
                };
                let expected = legacy_page_messages(&messages, request);
                let actual = page_messages(&messages, request);
                assert_eq!(actual.page, expected.page, "request: {request:?}");
                assert_eq!(
                    serde_json::to_value(&actual.messages).unwrap(),
                    serde_json::to_value(&expected.messages).unwrap(),
                    "request: {request:?}"
                );
            }
        }
    }

    let beyond_end = page_messages(
        &messages,
        MessagePageRequest {
            before: Some(usize::MAX),
            limit: 4,
            include_system: false,
        },
    );
    assert_eq!(beyond_end.page.end, beyond_end.page.total);
    assert_eq!(beyond_end.page.total, 10);
    assert_eq!(beyond_end.messages.len(), 4);
}

#[test]
fn thread_tool_call_names_ignore_malformed_and_non_thread_calls() {
    let messages = mixed_message_history();
    // Names come from `thread` tool calls only; malformed arguments,
    // blank names, and non-thread calls are ignored, and names are
    // sorted and deduplicated.
    assert_eq!(
        thread_tool_call_names(&messages[6..]),
        vec!["alpha".to_string(), "zeta".to_string()]
    );
    assert!(thread_tool_call_names(&messages[..2]).is_empty());
    assert!(thread_tool_call_names(&[Message::System {
        content: "only system".to_string(),
    }])
    .is_empty());
}

pub(super) fn test_store_path(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    std::env::temp_dir()
        .join(format!("nac_session_service_{label}_{unique}"))
        .join("store.db")
}

pub(super) fn test_agent(
    client: ModelClient,
    store_path: PathBuf,
    session_id: Option<String>,
) -> Agent {
    build_test_agent(
        client,
        store_path,
        session_id,
        AgentMode::Orchestrator,
        None,
        None,
    )
}

pub(super) fn test_agent_with_compaction_threshold(
    client: ModelClient,
    store_path: PathBuf,
    session_id: Option<String>,
    orchestrator_compaction_threshold: Option<u64>,
) -> Agent {
    build_test_agent(
        client,
        store_path,
        session_id,
        AgentMode::Orchestrator,
        orchestrator_compaction_threshold,
        None,
    )
}

pub(super) fn test_agent_with_skills(
    client: ModelClient,
    store_path: PathBuf,
    session_id: Option<String>,
    skills: Option<Arc<SkillRegistry>>,
) -> Agent {
    build_test_agent(
        client,
        store_path,
        session_id,
        AgentMode::Orchestrator,
        None,
        skills,
    )
}

fn build_test_agent(
    client: ModelClient,
    store_path: PathBuf,
    session_id: Option<String>,
    mode: AgentMode,
    orchestrator_compaction_threshold: Option<u64>,
    skills: Option<Arc<SkillRegistry>>,
) -> Agent {
    Agent::with_config(
        client,
        AgentConfig {
            command_output_limits: crate::terminal::CommandOutputLimits::default(),
            mode,
            session_behavior: None,
            store_path,
            session_id,
            orchestrator_compaction_threshold,
            initial_messages: Vec::new(),
            thread_name: None,
            dispatch_id: None,
            event_sink: EventSink::none(),
            workspace_cwd: PathBuf::from("/repo"),
            config_cwd: PathBuf::from("/repo"),
            working_directory: "/repo".to_string(),
            worker_executable: None,
            sandbox: None,
            ssh: None,
            mcp: None,
            skills,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            light_client: None,
            permission_rules: Vec::new(),
        },
    )
    .expect("agent config must be valid")
}

pub(super) fn test_picker_service(label: &str) -> SessionServiceParts {
    let store_path = test_store_path(label);
    let client = ModelClient::new_for_test();
    let agent = test_agent(client.clone(), store_path.clone(), None);
    SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Picker { store_path },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(GitTarget::local("/repo")),
        resume_base_cwd: PathBuf::from("/repo"),
    })
}

pub(super) fn test_active_service(label: &str, session_id: &str) -> (SessionServiceParts, PathBuf) {
    test_active_service_with_skills(label, session_id, ModelClient::new_for_test(), None)
}

fn test_direct_active_service(
    label: &str,
    session_id: &str,
    client: ModelClient,
) -> (SessionServiceParts, PathBuf) {
    let store_path = test_store_path(label);
    let agent = build_test_agent(
        client.clone(),
        store_path.clone(),
        Some(session_id.to_string()),
        AgentMode::Direct,
        None,
        None,
    );
    let mut snapshot = sessions::new_snapshot(
        session_id.to_string(),
        PathBuf::from("/repo"),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        BTreeMap::new(),
    );
    snapshot.behavior = sessions::SessionBehavior::Direct;
    sessions::create_session(&store_path, &snapshot).unwrap();
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: session_id.to_string(),
            store_path: store_path.clone(),
            snapshot,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: None,
        resume_base_cwd: PathBuf::from("/repo"),
    });
    (parts, store_path)
}

/// Active-session service whose agent carries a skill registry. The
/// client is a parameter so the test can point it at a scripted server.
pub(super) fn test_active_service_with_skills(
    label: &str,
    session_id: &str,
    client: ModelClient,
    skills: Option<Arc<SkillRegistry>>,
) -> (SessionServiceParts, PathBuf) {
    let store_path = test_store_path(label);
    let agent = test_agent_with_skills(
        client.clone(),
        store_path.clone(),
        Some(session_id.to_string()),
        skills,
    );
    let snapshot = sessions::new_snapshot(
        session_id.to_string(),
        PathBuf::from("/repo"),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        BTreeMap::new(),
    );
    sessions::create_session(&store_path, &snapshot).unwrap();
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: session_id.to_string(),
            store_path: store_path.clone(),
            snapshot,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(GitTarget::local("/repo")),
        resume_base_cwd: PathBuf::from("/repo"),
    });
    (parts, store_path)
}

#[test]
fn has_sandbox_reflects_the_agent_execution_backend() {
    let (local_parts, local_store) = test_active_service("has_sandbox_local", "has-sandbox-local");
    assert!(!local_parts.service.has_sandbox());
    let _ = std::fs::remove_dir_all(local_store.parent().unwrap());

    let store_path = test_store_path("has_sandbox_sandboxed");
    let client = ModelClient::new_for_test();
    let agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            command_output_limits: crate::terminal::CommandOutputLimits::default(),
            mode: AgentMode::Orchestrator,
            session_behavior: None,
            store_path: store_path.clone(),
            session_id: Some("has-sandbox-sandboxed".to_string()),
            orchestrator_compaction_threshold: None,
            initial_messages: Vec::new(),
            thread_name: None,
            dispatch_id: None,
            event_sink: EventSink::none(),
            workspace_cwd: PathBuf::from("/repo"),
            config_cwd: PathBuf::from("/repo"),
            working_directory: "/repo".to_string(),
            worker_executable: None,
            sandbox: Some(crate::sandbox::SandboxSession::new_for_test(
                crate::sandbox::SandboxSpec {
                    backend: crate::sandbox::SandboxBackendType::Podman,
                    image: crate::sandbox::DEFAULT_SANDBOX_IMAGE.to_string(),
                    mounts: Vec::new(),
                    workdir: PathBuf::from(crate::sandbox::DEFAULT_SANDBOX_WORKDIR),
                    worktree: None,
                    gpu_devices: Vec::new(),
                    shm_size: None,
                    cpus: 2,
                    memory_mib: 2048,
                },
            )),
            ssh: None,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            light_client: None,
            permission_rules: Vec::new(),
        },
    )
    .expect("agent config must be valid");
    let snapshot = sessions::new_snapshot(
        "has-sandbox-sandboxed".to_string(),
        PathBuf::from("/repo"),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        BTreeMap::new(),
    );
    sessions::create_session(&store_path, &snapshot).unwrap();
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: "has-sandbox-sandboxed".to_string(),
            store_path: store_path.clone(),
            snapshot,
        },
        sandbox_status: "on".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(GitTarget::local("/repo")),
        resume_base_cwd: PathBuf::from("/repo"),
    });
    assert!(parts.service.has_sandbox());
    parts.service.acquire_sandbox_resource_lease().unwrap();
    assert!(matches!(
        sessions::SessionResourceMutationLease::try_acquire(&store_path, "has-sandbox-sandboxed"),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    parts.service.release_sandbox_resource_lease();
    drop(
        sessions::SessionResourceMutationLease::try_acquire(&store_path, "has-sandbox-sandboxed")
            .unwrap(),
    );
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[cfg(unix)]
#[tokio::test]
async fn sandbox_container_destruction_preserves_worktree_until_durable_delete() {
    use std::os::unix::fs::PermissionsExt;

    let _environment = crate::TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let store_path = test_store_path("destroy_preserves_worktree");
    let repo_root = store_path.parent().unwrap().to_path_buf();
    let scratch_root = repo_root.with_extension("scratch");
    let worktree_path = scratch_root.join("worktree");
    std::fs::create_dir_all(&repo_root).unwrap();
    let git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(&repo_root)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    };
    git(&["init"]);
    git(&["config", "user.name", "NAC Test"]);
    git(&["config", "user.email", "nac@example.invalid"]);
    std::fs::write(repo_root.join("tracked.txt"), b"tracked\n").unwrap();
    git(&["add", "tracked.txt"]);
    git(&["commit", "-m", "base"]);
    let fork_point = String::from_utf8(
        std::process::Command::new("git")
            .arg("-C")
            .arg(&repo_root)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_string();
    let worktree = crate::sandbox::SandboxWorktree {
        repo_root: repo_root.clone(),
        path: worktree_path.clone(),
        scratch_root: scratch_root.clone(),
        branch: "nac/destroy-preserves-worktree".to_string(),
        fork_point,
    };
    crate::workspace::worktree::create(&worktree.repo_root, &worktree.path, &worktree.branch)
        .unwrap();
    let uncommitted = worktree.path.join("uncommitted.txt");
    std::fs::write(&uncommitted, b"must survive database failure\n").unwrap();

    let bin = repo_root.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let podman = bin.join("podman");
    std::fs::write(&podman, "#!/bin/sh\nexit 0\n").unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let original_path = std::env::var_os("PATH");
    let mut paths = vec![bin];
    if let Some(path) = original_path.as_ref() {
        paths.extend(std::env::split_paths(path));
    }
    unsafe { std::env::set_var("PATH", std::env::join_paths(paths).unwrap()) };

    let client = ModelClient::new_for_test();
    let sandbox_spec = crate::sandbox::SandboxSpec {
        worktree: Some(worktree.clone()),
        ..crate::sandbox::SandboxSpec::default()
    };
    let agent = Agent::with_config(
        client.clone(),
        AgentConfig {
            command_output_limits: crate::terminal::CommandOutputLimits::default(),
            mode: AgentMode::Orchestrator,
            session_behavior: None,
            store_path: store_path.clone(),
            session_id: Some("destroy-preserves-worktree".to_string()),
            orchestrator_compaction_threshold: None,
            initial_messages: Vec::new(),
            thread_name: None,
            dispatch_id: None,
            event_sink: EventSink::none(),
            workspace_cwd: worktree.path.clone(),
            config_cwd: repo_root.clone(),
            working_directory: worktree.path.display().to_string(),
            worker_executable: None,
            sandbox: Some(crate::sandbox::SandboxSession::new_for_test(sandbox_spec)),
            ssh: None,
            mcp: None,
            skills: None,
            extra_tool_defs: Vec::new(),
            agents_md_message: None,
            thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            light_client: None,
            permission_rules: Vec::new(),
        },
    )
    .expect("agent config must be valid");
    let snapshot = sessions::new_snapshot(
        "destroy-preserves-worktree".to_string(),
        worktree.path.clone(),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        BTreeMap::new(),
    );
    sessions::create_session(&store_path, &snapshot).unwrap();
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: "destroy-preserves-worktree".to_string(),
            store_path: store_path.clone(),
            snapshot,
        },
        sandbox_status: "on".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: worktree.path.display().to_string(),
        workspace_git: Some(GitTarget::local(&worktree.path)),
        resume_base_cwd: repo_root.clone(),
    });

    parts.service.destroy_sandbox().await.unwrap();
    assert!(uncommitted.exists());
    assert!(
        crate::workspace::worktree::registered_checkout(&worktree.repo_root, &worktree.path)
            .unwrap()
            .is_some(),
        "container cleanup must not unregister the worktree before durable deletion"
    );

    unsafe {
        match original_path {
            Some(path) => std::env::set_var("PATH", path),
            None => std::env::remove_var("PATH"),
        }
    }
    drop(parts);
    crate::sandbox::session_worktree::cleanup_session_worktree(&worktree);
    let _ = std::fs::remove_dir_all(&scratch_root);
    let _ = std::fs::remove_dir_all(&repo_root);
}

/// Seed the store transcript's legacy prefix: the snapshot blob (what the
/// store-backed read paths serve) plus the agent vec, so later log
/// appends land at the right absolute idx.
pub(super) async fn seed_store_transcript(parts: &SessionServiceParts, messages: Vec<Message>) {
    parts
        .service
        .session_snapshot
        .lock()
        .await
        .as_mut()
        .unwrap()
        .messages = messages.clone();
    parts.service.agent.lock().await.messages = messages.clone();
    let connection =
        crate::store::open_runtime_connection(&parts.service.metadata.store_path).unwrap();
    connection
        .execute(
            "UPDATE sessions
                 SET messages_json = ?1, visible_message_count = ?2, last_user_prompt = ?3
                 WHERE session_id = ?4",
            rusqlite::params![
                serde_json::to_string(&messages).unwrap(),
                sessions::visible_message_count(&messages) as i64,
                sessions::last_user_prompt(&messages),
                parts.service.metadata.session_id.as_deref().unwrap()
            ],
        )
        .unwrap();
}

/// Append to the transcript log tail exactly like a commit point (the
/// store-backed read paths serve it immediately; the agent vec is not
/// required for reads).
pub(super) async fn seed_log_tail(parts: &SessionServiceParts, messages: Vec<Message>) {
    let writer = parts
        .service
        .transcript_log
        .as_ref()
        .expect("active service has a transcript log")
        .clone();
    let session_id = parts.service.metadata.session_id.clone().unwrap();
    let start_idx = parts
        .service
        .session_snapshot
        .lock()
        .await
        .as_ref()
        .map(|snapshot| snapshot.messages.len() as u64)
        .unwrap_or(0);
    tokio::task::spawn_blocking(move || writer.append_batch(&session_id, start_idx, &messages))
        .await
        .unwrap()
        .unwrap();
}

pub(super) fn compaction_messages() -> Vec<Message> {
    vec![
        Message::System {
            content: "system policy".to_string(),
        },
        Message::User {
            content: "old request".to_string(),
        },
        Message::Assistant {
            content: Some("old answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::User {
            content: "recent request".to_string(),
        },
        Message::User {
            content: "current request".to_string(),
        },
    ]
}

pub(super) fn compaction_response(text: &str) -> String {
    serde_json::json!({
        "status": "completed",
        "output": [{
            "type": "message",
            "content": [{"type": "output_text", "text": text}]
        }],
        "usage": {
            "input_tokens": 30,
            "input_tokens_details": {"cached_tokens": 4},
            "output_tokens": 5,
            "total_tokens": 39
        }
    })
    .to_string()
}

pub(super) fn test_compaction_service(
    label: &str,
    session_id: &str,
    client: ModelClient,
) -> (SessionServiceParts, PathBuf) {
    let store_path = test_store_path(label);
    let mut agent = test_agent(
        client.clone(),
        store_path.clone(),
        Some(session_id.to_string()),
    );
    agent.messages = compaction_messages();
    agent.last_usage = Some(crate::model::TokenUsage {
        input_tokens: 91,
        output_tokens: 7,
        orchestrator_context_tokens: 123,
        ..crate::model::TokenUsage::default()
    });
    let mut snapshot = sessions::new_snapshot(
        session_id.to_string(),
        PathBuf::from("/repo"),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        BTreeMap::new(),
    );
    snapshot.last_response_duration_ms = Some(123);
    snapshot.previous_response_duration_ms = Some(45);
    snapshot.response_durations_ms = Some(vec![Some(123)]);
    snapshot.token_usages = vec![Some(crate::model::TokenUsage {
        input_tokens: 11,
        output_tokens: 2,
        orchestrator_context_tokens: 13,
        ..crate::model::TokenUsage::default()
    })];
    sessions::create_session(&store_path, &snapshot).unwrap();
    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: session_id.to_string(),
            store_path: store_path.clone(),
            snapshot,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "off".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(GitTarget::local("/repo")),
        resume_base_cwd: PathBuf::from("/repo"),
    });
    (parts, store_path)
}

fn assert_run_started_event(
    envelope: SessionEventEnvelope,
    active_run: &ActiveRunSnapshot,
    prompt_preview: &str,
) {
    assert_eq!(envelope.client_id.as_ref(), active_run.client_id.as_ref());
    assert_eq!(envelope.run_id.as_ref(), Some(&active_run.run_id));
    match envelope.event {
        SessionEvent::RunStarted {
            prompt_preview: emitted_preview,
            submitted_user_message,
            started_at_epoch_ms,
        } => {
            assert_eq!(emitted_preview, prompt_preview);
            assert_eq!(submitted_user_message, active_run.submitted_user_message);
            assert_eq!(started_at_epoch_ms, active_run.started_at_epoch_ms);
        }
        other => panic!("expected run started, got {other:?}"),
    }
}

#[path = "session_service_tests/direct_interaction.rs"]
mod direct_interaction;
#[path = "session_service_tests/projection.rs"]
mod projection;
#[path = "session_service_tests/recovery.rs"]
mod recovery;
#[path = "session_service_tests/settlement.rs"]
mod settlement;
