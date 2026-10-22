use super::*;
use crate::model::{ApiKeySelector, BackendKind, EffectiveModelSettings};
use crate::runtime::{
    create_owner_test_helpers::{finish, Fixture},
    ModelImportFixture,
};

fn components() -> (
    ModelImportFixture,
    Fixture,
    CreatePublicationCustody,
    ModelClient,
    AgentConfig,
) {
    let (imported, key, complete) = ModelImportFixture::new();
    let owner = Fixture::for_host_key(key.binding());
    let custody = finish(&owner);
    let settings = EffectiveModelSettings::from_optional_with_selector(
        Some(BackendKind::ArceeApi),
        Some("trinity-large-thinking".into()),
        Some("https://api.arcee.ai/api/v1".into()),
        None,
        ApiKeySelector::Exact(None),
        Default::default(),
        false,
    )
    .unwrap();
    let client = ModelClient::from_protected_host_key(
        settings,
        Arc::new(key),
        Arc::new(complete),
        Arc::clone(custody.context()),
    )
    .unwrap();
    let source = custody.source().unwrap();
    let crate::sandbox::ExecutionBackend::Local { workspace_cwd } =
        custody.context().selected_backend().as_ref()
    else {
        panic!("fixture backend");
    };
    let config = AgentConfig {
        mode: AgentMode::Direct,
        session_behavior: Some(crate::sessions::SessionBehavior::Direct),
        store_path: source.bound_store_path().to_path_buf(),
        session_id: Some(source.binding().session_id.clone()),
        orchestrator_compaction_threshold: Some(8192),
        initial_messages: Vec::new(),
        thread_name: None,
        dispatch_id: None,
        event_sink: EventSink::none(),
        workspace_cwd: workspace_cwd.clone(),
        config_cwd: workspace_cwd.clone(),
        working_directory: workspace_cwd.display().to_string(),
        worker_executable: None,
        sandbox: None,
        ssh: None,
        mcp: None,
        skills: None,
        extra_tool_defs: Vec::new(),
        agents_md_message: Some("Retained preparation guidance".into()),
        thread_timeout_secs: 3600,
        command_output_limits: Default::default(),
        light_client: None,
        permission_rules: Vec::new(),
    };
    (imported, owner, custody, client, config)
}
#[test]
fn actual_agent_construction_retains_exact_backend_context_and_existing_prompt() {
    // Private synthetic original authority/runtime only; no supported Native
    // activation or positive runtime acceptance is inferred from this control.
    let (_imported, _owner, custody, client, config) = components();
    let backend = Arc::clone(custody.context().selected_backend());
    let mut agent = Agent::with_protected_config(client, config, &custody).unwrap();
    assert!(Arc::ptr_eq(&agent.tool_runtime.backend, &backend));
    assert!(Arc::ptr_eq(
        agent.tool_runtime.protected_context.as_ref().unwrap(),
        custody.context()
    ));
    assert!(
        matches!(&agent.messages[0], Message::System { content } if content.contains("Retained preparation guidance"))
    );
    assert!(
        agent.refresh_model_request_capabilities().is_err(),
        "no ambient web/key discovery before protected tool join"
    );
}
#[test]
fn ordinary_client_and_different_operation_store_or_workspace_cannot_be_stamped() {
    for change in 0..4 {
        let (_imported, _owner, custody, mut client, mut config) = components();
        match change {
            0 => client = ModelClient::new_for_test(),
            1 => config.session_id = Some("another-session".into()),
            2 => config.store_path = config.store_path.with_file_name("another.db"),
            _ => config.workspace_cwd.push("different"),
        }
        assert!(Agent::with_protected_config(client, config, &custody).is_err());
    }
}
#[tokio::test]
async fn protected_agent_never_falls_back_to_host_tool_preparation_or_execution() {
    let (_imported, _owner, custody, client, config) =
        tokio::task::spawn_blocking(components).await.unwrap();
    let agent = Agent::with_protected_config(client, config, &custody).unwrap();
    let private = agent.tool_runtime.workspace_cwd.join("host-only.txt");
    std::fs::write(&private, "host-file-canary-must-not-reach-tool").unwrap();
    let result = crate::tools::execute_tool(
        "read",
        serde_json::json!({"path":private}),
        &agent.tool_runtime,
        &agent.client,
    )
    .await;
    assert!(result.is_error);
    assert!(!result
        .content
        .as_text()
        .unwrap()
        .contains("host-file-canary"));
    let output = agent.tool_runtime.workspace_cwd.join("must-not-create.txt");
    let result = crate::tools::execute_tool(
        "write",
        serde_json::json!({"path":output,"content":"must-not-write","expected_revision":null}),
        &agent.tool_runtime,
        &agent.client,
    )
    .await;
    assert!(result.is_error);
    assert!(!output.exists());
    assert!(agent.ensure_backend_ready().await.is_err());
}

#[tokio::test]
async fn actual_agent_service_and_private_publication_share_the_same_original_context() {
    let (_imported, _owner, custody, client, config) =
        tokio::task::spawn_blocking(components).await.unwrap();
    let source = custody.source().unwrap();
    let path = source.bound_store_path().to_path_buf();
    let session_id = source.binding().session_id.clone();
    let workspace = config.workspace_cwd.clone();
    let agent = Agent::with_protected_config(client.clone(), config, &custody).unwrap();
    let mut snapshot = crate::sessions::new_snapshot(
        session_id.clone(),
        workspace.clone(),
        client.model.clone(),
        client.base_url().into(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        Default::default(),
    );
    snapshot.behavior = crate::sessions::SessionBehavior::Direct;
    let reservation = Arc::clone(&source);
    let bound = snapshot.clone();
    tokio::task::spawn_blocking(move || reservation.bind_prepared_snapshot(&bound))
        .await
        .unwrap()
        .unwrap();
    let run = crate::runtime::OrchestratorRunConfig {
        agent,
        client,
        session: crate::runtime::OrchestratorSession::Active {
            snapshot,
            store_path: path.clone(),
            session_id: session_id.clone(),
        },
        sandbox_status: "off".into(),
        agents_md_status: "1 file loaded".into(),
        workspace_display: workspace.display().to_string(),
        workspace_git: None,
        resume_base_cwd: workspace,
    };
    let parts =
        crate::session_service::SessionService::from_protected_run_config(run, &custody).unwrap();
    let mut original = crate::session_service::PreparedCreatePublication::retain(
        parts.service,
        crate::runtime::PreparedSessionResources::for_test(None),
        custody,
    );
    let mut admitted = original.try_issue().await.unwrap();
    admitted.persist_creation().await.unwrap();
    let mut cached = None;
    admitted
        .publish(|service| {
            cached = Some(service);
            Ok(())
        })
        .unwrap();
    assert_eq!(
        cached.unwrap().metadata().session_id.as_deref(),
        Some(session_id.as_str())
    );
    assert!(crate::sessions::load_session(&path, &session_id).is_ok());
    // This checks actual Core constructor/transaction/callback mechanics using
    // private synthetic authority. It does not qualify Native cache/runtime or
    // enable the unfinished protected tool adapters or production admission.
}
