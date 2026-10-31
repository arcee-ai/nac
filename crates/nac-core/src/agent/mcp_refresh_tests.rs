use super::*;
use crate::mcp::recording_server::{RecordingMcpServer, TestHome};
use crate::runtime::{self, ModelOptions, OptionalModelOption, RunOptions, StoreOptions};

const ECHO: &str = "mcp__recorded__echo";

fn configure(home: &TestHome, url: &str, extra: &str) {
    std::fs::write(
        home.path.join("config.toml"),
        format!(
            "[mcp_servers.recorded]\ntransport = \"streamable_http\"\nurl = {}\n{extra}\n",
            serde_json::to_string(url).unwrap()
        ),
    )
    .unwrap();
}

fn model_options() -> ModelOptions {
    ModelOptions {
        backend: Some(crate::model::BackendKind::OpenAiResponses),
        api_base_url: Some("https://example.invalid/v1".into()),
        api_model: Some("test-model".into()),
        api_key_env: OptionalModelOption::Value("TEST_MCP_CLIENT_ID".into()),
        ..ModelOptions::default()
    }
}

async fn direct(home: &TestHome, behavior: crate::sessions::SessionBehavior) -> Agent {
    let root = home.path.join("repo");
    std::fs::create_dir_all(&root).unwrap();
    runtime::build_run_config_for_project_with_behavior(
        RunOptions {
            workspace_cwd: root.clone(),
            config_cwd: Some(root),
            worker_executable: None,
            store: StoreOptions {
                store_path: Some(home.path.join("store.db")),
            },
            model: model_options(),
            orchestrator_compaction_threshold: Some(32_000),
            sandbox: Default::default(),
            ssh: Default::default(),
        },
        &runtime::NacConfig::default(),
        None,
        behavior,
    )
    .await
    .unwrap()
    .agent
}

fn request(agent: &Agent, revision: i64) {
    crate::store::request_session_mcp_refresh(
        &agent.tool_runtime.store_path,
        agent.tool_runtime.session_id.as_deref().unwrap(),
        revision,
    )
    .unwrap();
}

fn names(agent: &mut Agent) -> Vec<String> {
    agent
        .refresh_model_request_capabilities()
        .unwrap()
        .into_iter()
        .map(|tool| tool.function.name)
        .collect()
}

#[tokio::test]
async fn mcp_mount_refresh_add_replace_remove_and_restart_preserve_captured_round() {
    let _env = crate::TEST_ENV_LOCK.lock().unwrap();
    let first = RecordingMcpServer::start_with_guidance("original definition", "original guidance");
    let second =
        RecordingMcpServer::start_with_guidance("replacement definition", "replacement guidance");
    let home = TestHome::with_server(
        "mcp-mount-refresh",
        "recorded",
        &first.url,
        "enabled = false",
    );
    let mut agent = direct(&home, crate::sessions::SessionBehavior::Direct).await;
    let (events, mut observations) = tokio::sync::mpsc::unbounded_channel();
    agent.set_event_sink(EventSink::channel(events));
    let backend = Arc::clone(&agent.tool_runtime.backend);
    assert!(!names(&mut agent).contains(&ECHO.to_string()));
    configure(&home, &first.url, "approval = \"allow\"\nheaders = { Authorization = \"Bearer original-fixture-credential\" }");
    assert!(
        !names(&mut agent).contains(&ECHO.to_string()),
        "config alone cannot add a mount"
    );
    request(&agent, 0);
    agent.admit_mcp_mount_refresh().await.unwrap();
    assert!(names(&mut agent).contains(&ECHO.to_string()));
    let retired_registry = Arc::downgrade(agent.tool_runtime.mcp.as_ref().unwrap());
    // Long-lived native shell contexts must not pin an imported registry.
    let _human_terminal = agent.user_terminal_runtime().unwrap();
    let _human_command = agent.shell_execution_context().unwrap();
    let captured_round = agent.tool_runtime.clone();
    let original_definition =
        serde_json::to_string(&captured_round.mcp_tools[ECHO].definition()).unwrap();

    configure(&home, &second.url, "approval = \"ask\"\nheaders = { Authorization = \"Bearer replacement-fixture-credential\" }");
    request(&agent, 1);
    agent.admit_mcp_mount_refresh().await.unwrap();
    assert!(names(&mut agent).contains(&ECHO.to_string()));
    assert_eq!(
        agent.tool_runtime.mcp_tools[ECHO].approval(),
        crate::mcp::McpToolApproval::Ask
    );
    assert_eq!(
        captured_round.mcp_tools[ECHO].approval(),
        crate::mcp::McpToolApproval::Allow
    );
    assert!(captured_round.mcp_tools[ECHO]
        .definition()
        .function
        .description
        .contains("original definition"));
    assert!(agent.tool_runtime.mcp_tools[ECHO]
        .definition()
        .function
        .description
        .contains("replacement definition"));
    let canonical = serde_json::to_string(&agent.messages).unwrap();
    let mut provider_view = agent.messages.clone();
    agent.project_mcp_instructions(&mut provider_view);
    let provider = serde_json::to_string(&provider_view).unwrap();
    assert!(provider.contains("replacement guidance"));
    assert!(!provider.contains("original guidance"));
    assert_eq!(serde_json::to_string(&agent.messages).unwrap(), canonical);
    assert_eq!(
        serde_json::to_string(&captured_round.mcp_tools[ECHO].definition()).unwrap(),
        original_definition
    );
    let old =
        tools::execute_tool(ECHO, serde_json::json!({}), &captured_round, &agent.client).await;
    assert!(!old.is_error, "{}", old.content);
    assert_eq!(first.authorizations("tools/call").len(), 1);
    assert_eq!(
        first.authorizations("tools/call"),
        vec![Some("Bearer original-fixture-credential".to_string())]
    );
    assert_eq!(
        second.authorizations("initialize").last(),
        Some(&Some("Bearer replacement-fixture-credential".to_string()))
    );
    let status = agent.mcp_mounts.status(
        crate::store::load_session_mcp_refresh(
            &agent.tool_runtime.store_path,
            agent.tool_runtime.session_id.as_deref().unwrap(),
        )
        .unwrap(),
    );
    assert!(!serde_json::to_string(&status)
        .unwrap()
        .contains("fixture-credential"));
    assert!(second.authorizations("tools/call").is_empty());
    let refused = tools::execute_tool(
        ECHO,
        serde_json::json!({}),
        &agent.tool_runtime,
        &agent.client,
    )
    .await;
    assert!(refused.is_error, "headless ask must remain fail closed");
    assert!(second.authorizations("tools/call").is_empty());
    let observations: Vec<_> = std::iter::from_fn(|| observations.try_recv().ok()).collect();
    let notices: Vec<_> = observations
        .iter()
        .filter_map(|event| match event {
            AgentEvent::McpNotification {
                kind: crate::events::McpNotificationKind::CatalogRefreshed,
                message,
                ..
            } if message.starts_with("Session mount refresh revision") => Some(message),
            _ => None,
        })
        .collect();
    assert_eq!(notices.len(), 2);
    assert!(notices.iter().all(|message| message.len() < 128));
    assert!(!serde_json::to_string(&observations)
        .unwrap()
        .contains("fixture-credential"));
    drop(captured_round);
    assert!(
        retired_registry.upgrade().is_none(),
        "only admitted model rounds may retain retired registries"
    );
    assert!(Arc::ptr_eq(&backend, &agent.tool_runtime.backend));

    configure(&home, &second.url, "enabled = false");
    request(&agent, 2);
    agent.admit_mcp_mount_refresh().await.unwrap();
    assert!(!names(&mut agent).contains(&ECHO.to_string()));
    agent.refresh_compaction_tool_definitions();
    assert!(agent
        .tool_defs
        .iter()
        .all(|tool| tool.function.name != ECHO));
    assert!(agent.mcp_mounts.registry().is_none());
    let id = agent.tool_runtime.session_id.clone().unwrap();
    drop(agent);
    let mut resumed = runtime::build_resume_config_for_session(
        home.path.join("store.db"),
        &id,
        &runtime::NacConfig::default(),
        home.path.join("repo"),
        None,
        runtime::ResumeModelOptions::default(),
    )
    .await
    .unwrap()
    .agent;
    resumed.admit_mcp_mount_refresh().await.unwrap();
    assert_eq!(resumed.mcp_mounts.revision(), 3);
    assert!(!names(&mut resumed).contains(&ECHO.to_string()));
    assert_eq!(
        first.authorizations("tools/call").len(),
        1,
        "restart cannot replay calls"
    );
}

#[tokio::test]
async fn mcp_mount_refresh_keeps_approval_wait_bound_and_invokes_exactly_once() {
    let _env = crate::TEST_ENV_LOCK.lock().unwrap();
    let first = RecordingMcpServer::start();
    let second = RecordingMcpServer::start();
    let home = TestHome::new("mcp-refresh-approval", "recorded", &first.url);
    configure(&home, &first.url, "approval = \"ask\"");
    let mut agent = direct(
        &home,
        crate::sessions::SessionBehavior::DirectWithOrchestrator,
    )
    .await;
    names(&mut agent);
    let broker = agent.configure_permission_broker(0).unwrap();
    let bus = crate::events::SessionEventBus::new(agent.tool_runtime.session_id.clone());
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let captured_round = agent.tool_runtime.clone();
    let call = tools::execute_tool(ECHO, serde_json::json!({}), &captured_round, &agent.client);
    let refresh_while_waiting = async {
        let pending = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Some(request) = broker.pending().pop() {
                    break request;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        configure(&home, &second.url, "approval = \"allow\"");
        request(&agent, 0);
        assert_eq!(
            agent.mcp_mounts.revision(),
            0,
            "request must not change an approval wait"
        );
        assert_eq!(pending.resources[0].resource, ECHO);
        broker
            .reply(&pending.id, crate::permissions::PermissionReply::Once)
            .unwrap();
    };
    let (settled, ()) = tokio::join!(call, refresh_while_waiting);
    assert!(!settled.is_error, "{}", settled.content);
    assert_eq!(first.authorizations("tools/call").len(), 1);
    assert!(second.authorizations("tools/call").is_empty());
    agent.admit_mcp_mount_refresh().await.unwrap();
    names(&mut agent);
    let next = tools::execute_tool(
        ECHO,
        serde_json::json!({}),
        &agent.tool_runtime,
        &agent.client,
    )
    .await;
    assert!(!next.is_error);
    assert_eq!(first.authorizations("tools/call").len(), 1);
    assert_eq!(second.authorizations("tools/call").len(), 1);
}

#[tokio::test]
async fn mcp_mount_refresh_required_failure_invalidates_old_mounts_until_explicit_retry() {
    let _env = crate::TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::new("mcp-refresh-failure", "recorded", &server.url);
    let mut agent = direct(&home, crate::sessions::SessionBehavior::Direct).await;
    names(&mut agent);
    std::fs::write(home.path.join("config.toml"), "[mcp_servers.broken]\nrequired = true\ntransport = \"stdio\"\ncommand = \"/nonexistent/nac-mcp-fixture\"\n").unwrap();
    request(&agent, 0);
    assert!(agent.admit_mcp_mount_refresh().await.is_err());
    assert!(agent.mcp_mounts.registry().is_none());
    assert!(!names(&mut agent).contains(&ECHO.to_string()));
    configure(&home, &server.url, "approval = \"allow\"");
    assert!(
        agent.admit_mcp_mount_refresh().await.is_err(),
        "failure is not retried implicitly"
    );
    request(&agent, 1);
    agent.admit_mcp_mount_refresh().await.unwrap();
    assert!(names(&mut agent).contains(&ECHO.to_string()));
    std::fs::write(home.path.join("config.toml"), "[mcp_servers.optional]\ntransport = \"stdio\"\ncommand = \"/nonexistent/nac-mcp-fixture\"\n").unwrap();
    request(&agent, 2);
    agent.admit_mcp_mount_refresh().await.unwrap();
    assert!(!names(&mut agent).contains(&ECHO.to_string()));
    let status = agent.mcp_mounts.status(
        crate::store::load_session_mcp_refresh(
            &agent.tool_runtime.store_path,
            agent.tool_runtime.session_id.as_deref().unwrap(),
        )
        .unwrap(),
    );
    assert_eq!(status.state, crate::mcp::SessionMcpRefreshState::Degraded);
    assert_eq!(status.applied_revision, Some(3));
    assert!(!serde_json::to_string(&status)
        .unwrap()
        .contains("/nonexistent"));
    assert!(server.authorizations("tools/call").is_empty());
}

#[tokio::test]
async fn mcp_mount_refresh_invalid_configuration_fails_closed_until_explicit_retry() {
    let _env = crate::TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::new("mcp-refresh-invalid-config", "recorded", &server.url);
    let mut agent = direct(&home, crate::sessions::SessionBehavior::Direct).await;
    assert!(names(&mut agent).contains(&ECHO.to_string()));
    std::fs::write(home.path.join("config.toml"), "[mcp_servers.recorded\n").unwrap();
    request(&agent, 0);
    assert!(agent.admit_mcp_mount_refresh().await.is_err());
    assert!(agent.mcp_mounts.registry().is_none());
    assert!(!names(&mut agent).contains(&ECHO.to_string()));
    let status = agent.mcp_mounts.status(
        crate::store::load_session_mcp_refresh(
            &agent.tool_runtime.store_path,
            agent.tool_runtime.session_id.as_deref().unwrap(),
        )
        .unwrap(),
    );
    assert_eq!(status.state, crate::mcp::SessionMcpRefreshState::Failed);
    assert_eq!(status.applied_revision, None);
    let diagnostic = status.message.unwrap();
    assert!(diagnostic.contains("configuration"));
    assert!(diagnostic.len() < 256);
    assert!(!diagnostic.contains(home.path.to_string_lossy().as_ref()));
    configure(&home, &server.url, "approval = \"allow\"");
    assert!(agent.admit_mcp_mount_refresh().await.is_err());
    request(&agent, 1);
    agent.admit_mcp_mount_refresh().await.unwrap();
    assert!(names(&mut agent).contains(&ECHO.to_string()));
    assert!(server.authorizations("tools/call").is_empty());
}

#[tokio::test]
async fn mcp_mount_refresh_superseded_load_cannot_publish_an_older_revision() {
    let _env = crate::TEST_ENV_LOCK.lock().unwrap();
    let (first, arrived, release) = RecordingMcpServer::start_holding_first("tools/list");
    let second = RecordingMcpServer::start();
    let home = TestHome::with_server(
        "mcp-refresh-superseded",
        "recorded",
        &first.url,
        "enabled = false",
    );
    let mut agent = direct(&home, crate::sessions::SessionBehavior::Direct).await;
    configure(&home, &first.url, "approval = \"allow\"");
    request(&agent, 0);
    let store = agent.tool_runtime.store_path.clone();
    let session = agent.tool_runtime.session_id.clone().unwrap();
    let concurrent_change = async {
        tokio::task::spawn_blocking(move || arrived.recv_timeout(Duration::from_secs(5)))
            .await
            .unwrap()
            .unwrap();
        configure(&home, &second.url, "approval = \"ask\"");
        crate::store::request_session_mcp_refresh(&store, &session, 1).unwrap();
        release.send(()).unwrap();
    };
    let (stale, ()) = tokio::join!(agent.admit_mcp_mount_refresh(), concurrent_change);
    assert!(stale.is_err());
    assert!(agent.mcp_mounts.registry().is_none());
    assert_eq!(agent.mcp_mounts.revision(), 1);
    agent.admit_mcp_mount_refresh().await.unwrap();
    names(&mut agent);
    assert_eq!(agent.mcp_mounts.revision(), 2);
    assert_eq!(
        agent.tool_runtime.mcp_tools[ECHO].approval(),
        crate::mcp::McpToolApproval::Ask
    );
    assert!(first.authorizations("tools/call").is_empty());
    assert!(second.authorizations("tools/call").is_empty());
}

#[tokio::test]
async fn mcp_mount_refresh_cancellation_retains_pending_intent_without_replaying_tools() {
    let _env = crate::TEST_ENV_LOCK.lock().unwrap();
    let (server, arrived, release) = RecordingMcpServer::start_holding_first("tools/list");
    let home = TestHome::with_server(
        "mcp-refresh-cancellation",
        "recorded",
        &server.url,
        "enabled = false",
    );
    let mut agent = direct(&home, crate::sessions::SessionBehavior::Direct).await;
    configure(&home, &server.url, "approval = \"allow\"");
    request(&agent, 0);
    let cancellation = agent.command_cancellation();
    let cancel = async {
        tokio::task::spawn_blocking(move || arrived.recv_timeout(Duration::from_secs(5)))
            .await
            .unwrap()
            .unwrap();
        cancellation.cancel();
        release.send(()).unwrap();
    };
    let (cancelled, ()) = tokio::join!(agent.admit_mcp_mount_refresh(), cancel);
    assert!(cancelled.unwrap_err().to_string().contains("cancelled"));
    assert_eq!(agent.mcp_mounts.revision(), 0);
    assert!(agent.mcp_mounts.registry().is_none());
    agent.tool_runtime.command_cancellation = Default::default();
    agent.admit_mcp_mount_refresh().await.unwrap();
    assert!(names(&mut agent).contains(&ECHO.to_string()));
    assert_eq!(agent.mcp_mounts.revision(), 1);
    assert!(server.authorizations("tools/call").is_empty());
}

#[tokio::test]
async fn mcp_mount_refresh_preserves_an_inflight_transport_until_its_one_settlement() {
    let _env = crate::TEST_ENV_LOCK.lock().unwrap();
    let (first, arrived, release) = RecordingMcpServer::start_holding_first_call();
    let second = RecordingMcpServer::start();
    let home = TestHome::new("mcp-refresh-inflight", "recorded", &first.url);
    let mut agent = direct(&home, crate::sessions::SessionBehavior::Direct).await;
    names(&mut agent);
    let round = agent.tool_runtime.clone();
    let client = agent.client.clone();
    let call = tools::execute_tool(ECHO, serde_json::json!({}), &round, &client);
    let refresh = async {
        tokio::task::spawn_blocking(move || arrived.recv_timeout(Duration::from_secs(5)))
            .await
            .unwrap()
            .unwrap();
        configure(&home, &second.url, "approval = \"allow\"");
        request(&agent, 0);
        agent.admit_mcp_mount_refresh().await.unwrap();
        release.send(()).unwrap();
    };
    let (settled, ()) = tokio::join!(call, refresh);
    assert!(!settled.is_error, "{}", settled.content);
    assert_eq!(first.authorizations("tools/call").len(), 1);
    assert!(second.authorizations("tools/call").is_empty());
    names(&mut agent);
    assert!(
        !tools::execute_tool(ECHO, serde_json::json!({}), &agent.tool_runtime, &client)
            .await
            .is_error
    );
    assert_eq!(first.authorizations("tools/call").len(), 1);
    assert_eq!(second.authorizations("tools/call").len(), 1);
}

#[tokio::test]
async fn mcp_mount_refresh_orchestrators_propagate_only_to_their_own_worker_boundaries() {
    let _env = crate::TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::with_server(
        "mcp-refresh-workers",
        "recorded",
        &server.url,
        "enabled = false",
    );
    let mut orchestrator = direct(&home, crate::sessions::SessionBehavior::Orchestrator).await;
    let mut separate = direct(
        &home,
        crate::sessions::SessionBehavior::DirectWithOrchestrator,
    )
    .await;
    let child = direct(&home, crate::sessions::SessionBehavior::Direct).await;
    let child_id = child.tool_runtime.session_id.clone().unwrap();
    let parent_id = separate.tool_runtime.session_id.clone().unwrap();
    let store_path = home.path.join("store.db");
    let child_relationship = crate::store::create_traditional_child_relationship(
        &store_path,
        &parent_id,
        &child_id,
        crate::store::GENERAL_CHILD_PROFILE,
        "fixture child",
    )
    .unwrap();
    let managed_relationship = crate::store::create_managed_orchestrator_relationship(
        &store_path,
        &parent_id,
        orchestrator.tool_runtime.session_id.as_deref().unwrap(),
        "fixture orchestrator",
    )
    .unwrap();
    drop(child);
    let mut child = runtime::build_resume_config_for_session(
        store_path.clone(),
        &child_id,
        &runtime::NacConfig::default(),
        home.path.join("repo"),
        None,
        runtime::ResumeModelOptions::default(),
    )
    .await
    .unwrap()
    .agent;
    let owner = orchestrator.tool_runtime.session_id.clone().unwrap();
    let options = runtime::ManagedWorkerOptions {
        workspace_cwd: home.path.join("repo"),
        config_cwd: Some(home.path.join("repo")),
        dispatch: runtime::WorkerDispatchOptions {
            session_id: owner,
            thread_name: "fixture".to_string(),
            dispatch_id: "fixture-dispatch".to_string(),
            action: "fixture".to_string(),
            source_threads: Vec::new(),
            skills: Vec::new(),
        },
        store: StoreOptions {
            store_path: Some(home.path.join("store.db")),
        },
        model: model_options(),
        sandbox: Default::default(),
        ssh: Default::default(),
    };
    let mut worker = runtime::build_managed_worker_config(options, &runtime::NacConfig::default())
        .await
        .unwrap()
        .agent;
    assert!(!names(&mut worker).contains(&ECHO.to_string()));
    configure(&home, &server.url, "approval = \"allow\"");
    request(&orchestrator, 0);
    orchestrator.admit_mcp_mount_refresh().await.unwrap();
    assert!(
        !names(&mut orchestrator).contains(&ECHO.to_string()),
        "primary taxonomy must not change"
    );
    separate.admit_mcp_mount_refresh().await.unwrap();
    assert!(!names(&mut separate).contains(&ECHO.to_string()));
    worker.admit_mcp_mount_refresh().await.unwrap();
    assert!(names(&mut worker).contains(&ECHO.to_string()));
    assert_eq!(worker.mcp_mounts.revision(), 1);
    assert_eq!(separate.mcp_mounts.revision(), 0);
    request(&separate, 0);
    separate.admit_mcp_mount_refresh().await.unwrap();
    assert!(names(&mut separate).contains(&ECHO.to_string()));
    child.admit_mcp_mount_refresh().await.unwrap();
    assert!(
        !names(&mut child).contains(&ECHO.to_string()),
        "parent refresh cannot mutate traditional children"
    );
    request(&child, 0);
    child.admit_mcp_mount_refresh().await.unwrap();
    assert!(names(&mut child).contains(&ECHO.to_string()));
    assert_eq!(
        crate::store::load_traditional_child(&store_path, &child_id)
            .unwrap()
            .unwrap(),
        child_relationship
    );
    assert_eq!(
        crate::store::load_managed_orchestrator(
            &store_path,
            &managed_relationship.orchestrator_session_id
        )
        .unwrap()
        .unwrap(),
        managed_relationship
    );
}

#[tokio::test]
async fn mcp_mount_refresh_during_compaction_applies_before_the_following_model_request() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};
    let _env = crate::TEST_ENV_LOCK.lock().unwrap();
    let original =
        RecordingMcpServer::start_with_guidance("original definition", "original guidance");
    let replacement =
        RecordingMcpServer::start_with_guidance("replacement definition", "replacement guidance");
    let home = TestHome::new("mcp-refresh-compaction", "recorded", &original.url);
    let mut agent = direct(&home, crate::sessions::SessionBehavior::Direct).await;
    let store = agent.tool_runtime.store_path.clone();
    let session = agent.tool_runtime.session_id.clone().unwrap();
    let mut history = agent.messages.clone();
    history.extend([
        Message::User {
            content: "older request".to_string(),
        },
        Message::Assistant {
            content: Some("older answer".to_string()),
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
    ]);
    agent.restore_messages(history);
    let mut snapshot = crate::sessions::load_session(&store, &session).unwrap();
    snapshot.messages = agent.messages.clone();
    crate::sessions::save_session(&store, &snapshot).unwrap();
    agent.compaction = Some(CompactionState::new(
        store.clone(),
        session.clone(),
        Some(1),
        CompactionPolicy::Direct,
    ));
    configure(&home, &replacement.url, "approval = \"allow\"");
    request(&agent, 0);
    let config_path = home.path.join("config.toml");
    let removed_config = format!(
        "[mcp_servers.recorded]\ntransport = \"streamable_http\"\nurl = {}\nenabled = false\n",
        serde_json::to_string(&replacement.url).unwrap()
    );
    let response = |text: &str| {
        serde_json::json!({
        "status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
        "usage": {"input_tokens": 100, "output_tokens": 5, "total_tokens": 105}
    }).to_string()
    };
    let model = ScriptedServer::start_observed(
        vec![
            ScriptedResponse::json("200 OK", response("concise context summary")),
            ScriptedResponse::json("200 OK", response("ordinary answer")),
        ],
        move |index, _request| {
            if index == 0 {
                std::fs::write(&config_path, &removed_config).unwrap();
                crate::store::request_session_mcp_refresh(&store, &session, 1).unwrap();
            }
        },
    );
    agent.client = ModelClient::new_for_test_server(model.base_url.clone());
    let run_id = SessionRunId::new();
    agent.set_steering_dispatch_id(Some(run_id.to_string()));
    let (prompt_commit, _receipt) = watch::channel(RunPromptCommitStatus::Pending);
    assert_eq!(
        agent
            .send_session_run("current request", &run_id, prompt_commit, None, None)
            .await
            .unwrap(),
        "ordinary answer"
    );
    let requests = model.finish();
    assert_eq!(requests.len(), 2);
    let summary: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert!(summary.to_string().contains("replacement guidance"));
    assert!(!summary.to_string().contains("original guidance"));
    let ordinary: serde_json::Value = serde_json::from_slice(&requests[1].body).unwrap();
    assert!(ordinary["tools"]
        .as_array()
        .unwrap()
        .iter()
        .all(|tool| tool["name"] != ECHO));
    assert!(!ordinary.to_string().contains("replacement guidance"));
    assert!(
        serde_json::to_string(&agent.messages[0])
            .unwrap()
            .contains("original guidance"),
        "projection must preserve canonical history"
    );
    assert_eq!(agent.mcp_mounts.revision(), 2);
    assert!(original.authorizations("tools/call").is_empty());
    assert!(replacement.authorizations("tools/call").is_empty());
}

#[tokio::test]
async fn mcp_mount_refresh_rebinds_expanded_tool_visibility_and_exact_tool_policy() {
    let _env = crate::TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::new("mcp-refresh-tool-policy", "recorded", &server.url);
    configure(&home, &server.url, "allowed_tools = []\napproval = \"ask\"");
    let mut agent = direct(&home, crate::sessions::SessionBehavior::Direct).await;
    assert!(!names(&mut agent).contains(&ECHO.to_string()));
    configure(
        &home,
        &server.url,
        "allowed_tools = [\"echo\"]\napproval = \"ask\"\ntool_approvals = { echo = \"allow\" }",
    );
    assert!(!names(&mut agent).contains(&ECHO.to_string()));
    request(&agent, 0);
    agent.admit_mcp_mount_refresh().await.unwrap();
    assert!(names(&mut agent).contains(&ECHO.to_string()));
    assert_eq!(
        agent.tool_runtime.mcp_tools[ECHO].approval(),
        crate::mcp::McpToolApproval::Allow
    );
    let expanded_round = agent.tool_runtime.clone();
    configure(
        &home,
        &server.url,
        "allowed_tools = [\"echo\"]\ndenied_tools = [\"echo\"]\napproval = \"allow\"",
    );
    request(&agent, 1);
    agent.admit_mcp_mount_refresh().await.unwrap();
    assert!(
        !names(&mut agent).contains(&ECHO.to_string()),
        "configured tool denial still wins over the expanded allowlist"
    );
    let retained =
        tools::execute_tool(ECHO, serde_json::json!({}), &expanded_round, &agent.client).await;
    assert!(!retained.is_error, "{}", retained.content);
    assert_eq!(server.authorizations("tools/call").len(), 1);
    let excluded = tools::execute_tool(
        ECHO,
        serde_json::json!({}),
        &agent.tool_runtime,
        &agent.client,
    )
    .await;
    assert!(excluded.is_error);
    assert_eq!(server.authorizations("tools/call").len(), 1);
}

#[tokio::test]
async fn mcp_mount_refresh_retains_ssh_backend_and_never_spawns_stdio() {
    let _env = crate::TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::with_server(
        "mcp-refresh-ssh-policy",
        "recorded",
        &server.url,
        "enabled = false",
    );
    let owner = direct(&home, crate::sessions::SessionBehavior::Orchestrator).await;
    let store = owner.tool_runtime.store_path.clone();
    let session = owner.tool_runtime.session_id.clone().unwrap();
    drop(owner);
    let mut saved = crate::sessions::load_session(&store, &session).unwrap();
    saved.ssh = Some(crate::sandbox::SshConnection::new("fixture.invalid"));
    saved.cwd = PathBuf::from("/remote/fixture");
    crate::sessions::save_session(&store, &saved).unwrap();
    // Worker construction and HTTP MCP do not contact the SSH host. This is
    // a construction-policy fixture, not live SSH infrastructure acceptance.
    let mut worker = runtime::build_managed_worker_config(
        runtime::ManagedWorkerOptions {
            workspace_cwd: saved.cwd,
            config_cwd: Some(home.path.clone()),
            dispatch: runtime::WorkerDispatchOptions {
                session_id: session,
                thread_name: "fixture".to_string(),
                dispatch_id: "fixture-ssh-dispatch".to_string(),
                action: "fixture".to_string(),
                source_threads: Vec::new(),
                skills: Vec::new(),
            },
            store: StoreOptions {
                store_path: Some(store),
            },
            model: model_options(),
            sandbox: Default::default(),
            ssh: runtime::SshOptions {
                host: Some("fixture.invalid".to_string()),
                ..Default::default()
            },
        },
        &runtime::NacConfig::default(),
    )
    .await
    .unwrap()
    .agent;
    let selected = Arc::clone(&worker.tool_runtime.backend);
    assert!(matches!(
        selected.as_ref(),
        crate::sandbox::ExecutionBackend::Ssh(_)
    ));
    let marker = home.path.join("stdio-must-not-spawn");
    let stdio = format!(
        "approval = \"allow\"\n\n[mcp_servers.local]\ntransport = \"stdio\"\ncommand = \"/bin/sh\"\nargs = [\"-c\", 'printf spawned > \"$MCP_MARKER\"']\nenv = {{ MCP_MARKER = {} }}",
        serde_json::to_string(&marker.to_string_lossy()).unwrap()
    );
    configure(&home, &server.url, &stdio);
    request(&worker, 0);
    worker.admit_mcp_mount_refresh().await.unwrap();
    assert!(names(&mut worker).contains(&ECHO.to_string()));
    assert!(Arc::ptr_eq(&selected, &worker.tool_runtime.backend));
    assert!(!marker.exists());
    assert!(server.authorizations("tools/call").is_empty());
}

#[tokio::test]
async fn mcp_mount_refresh_manual_compaction_does_not_inherit_a_cancelled_run() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};
    let _env = crate::TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::with_server(
        "mcp-refresh-manual-cancellation",
        "recorded",
        &server.url,
        "enabled = false",
    );
    let mut agent = direct(&home, crate::sessions::SessionBehavior::Direct).await;
    let prior_run = agent.begin_run_cancellation();
    prior_run.cancel();
    let mut history = agent.messages.clone();
    history.extend([
        Message::User {
            content: "older request".to_string(),
        },
        Message::Assistant {
            content: Some("older answer".to_string()),
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
    ]);
    agent.restore_messages(history);
    let store = agent.tool_runtime.store_path.clone();
    let session = agent.tool_runtime.session_id.clone().unwrap();
    let mut saved = crate::sessions::load_session(&store, &session).unwrap();
    saved.messages = agent.messages.clone();
    crate::sessions::save_session(&store, &saved).unwrap();
    configure(&home, &server.url, "approval = \"allow\"");
    request(&agent, 0);
    let model = ScriptedServer::start(vec![ScriptedResponse::json("200 OK", serde_json::json!({
        "status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "concise manual summary"}]}],
        "usage": {"input_tokens": 100, "output_tokens": 5, "total_tokens": 105}
    }).to_string())]);
    agent.client = ModelClient::new_for_test_server(model.base_url.clone());
    assert!(matches!(
        agent.compact().await.unwrap(),
        CompactionResult::Compacted { .. }
    ));
    assert_eq!(agent.mcp_mounts.revision(), 1);
    assert!(
        prior_run.is_cancelled(),
        "the previous generation's token stays cancelled"
    );
    assert!(!agent.command_cancellation().is_cancelled());
    assert_eq!(model.finish().len(), 1);
    assert!(server.authorizations("tools/call").is_empty());
}
