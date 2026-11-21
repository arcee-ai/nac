use super::*;
use crate::mcp::recording_server::{RecordingMcpServer, TestHome};
use crate::mcp::McpRuntimeManager;

const ECHO: &str = "mcp__recorded__echo";

fn run_options(root: &Path, store_path: &Path) -> RunOptions {
    RunOptions {
        workspace_cwd: root.to_path_buf(),
        config_cwd: Some(root.to_path_buf()),

        store: StoreOptions {
            store_path: Some(store_path.to_path_buf()),
        },
        model: test_openai_model_options(),
        orchestrator_compaction_threshold: Some(32_000),
        sandbox: SandboxOptions::default(),
        ssh: SshOptions::default(),
    }
}

#[tokio::test]
async fn disconnect_refuses_mounted_direct_and_child_sessions() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_api_key = std::env::var_os("OPENAI_API_KEY");
    unsafe {
        std::env::set_var("OPENAI_API_KEY", "test_dummy_key");
    }
    let server = RecordingMcpServer::start();
    let home = TestHome::new("nac-mcp-topologies", "recorded", &server.url);
    let root = home.path.join("repo");
    std::fs::create_dir_all(&root).unwrap();
    let store_path = home.path.join("store.db");
    store::initialize(&store_path).unwrap();

    let direct =
        build_run_config_for_project(run_options(&root, &store_path), &NacConfig::default(), None)
            .await
            .unwrap();
    let session_id = direct.session.session_id().unwrap().to_string();
    let child =
        build_run_config_for_project(run_options(&root, &store_path), &NacConfig::default(), None)
            .await
            .unwrap();
    let child_id = child.session.session_id().unwrap().to_string();
    store::create_traditional_child_relationship(
        &store_path,
        &session_id,
        &child_id,
        store::GENERAL_CHILD_PROFILE,
        "fixture child",
    )
    .unwrap();
    drop(child);
    let resumed = build_resume_config_for_session(
        store_path.clone(),
        &child_id,
        &NacConfig::default(),
        root.clone(),
        ResumeModelOptions::default(),
    )
    .await
    .unwrap();

    let captures = [&direct.agent, &resumed.agent].map(|agent| {
        agent
            .mcp_for_test()
            .and_then(|registry| registry.capture_tool(ECHO))
            .expect("every session mounts the configured server")
    });
    for capture in &captures {
        assert!(!capture.call(serde_json::json!({}), false).await.is_error);
    }
    assert_eq!(server.authorizations("tools/call").len(), captures.len());

    McpRuntimeManager::new(home.path.clone())
        .disconnect("recorded")
        .await
        .unwrap();
    for capture in &captures {
        let refused = capture.call(serde_json::json!({}), false).await;
        assert!(refused.is_error);
        assert!(refused.content.to_string().contains("disconnected"));
    }
    assert_eq!(server.authorizations("tools/call").len(), captures.len());

    let after =
        build_run_config_for_project(run_options(&root, &store_path), &NacConfig::default(), None)
            .await
            .unwrap();
    assert!(after
        .agent
        .tool_definitions_for_test()
        .iter()
        .all(|definition| definition.function.name != ECHO));

    drop((direct, resumed, after));
    restore_env("OPENAI_API_KEY", original_api_key);
}
