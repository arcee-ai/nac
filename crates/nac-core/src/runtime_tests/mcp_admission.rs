use super::*;
use crate::mcp::recording_server::{RecordingMcpServer, TestHome};
use crate::mcp::McpRuntimeManager;

const ECHO: &str = "mcp__recorded__echo";

fn run_options(root: &Path, store_path: &Path) -> RunOptions {
    RunOptions {
        workspace_cwd: root.to_path_buf(),
        config_cwd: Some(root.to_path_buf()),
        worker_executable: None,
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
async fn disconnect_refuses_mounted_direct_child_and_worker_sessions() {
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

    let direct = build_run_config_for_project_with_behavior(
        run_options(&root, &store_path),
        &NacConfig::default(),
        None,
        sessions::SessionBehavior::Direct,
    )
    .await
    .unwrap();
    let session_id = direct.session.session_id().unwrap().to_string();
    // Traditional children and reattached sessions run through the resume builder.
    let resumed = build_resume_config_for_session(
        store_path.clone(),
        &session_id,
        &NacConfig::default(),
        root.clone(),
        None,
        ResumeModelOptions::default(),
    )
    .await
    .unwrap();
    // Orchestrator workers, including those of managed orchestrators, mount here.
    let worker = build_managed_worker_config(
        ManagedWorkerOptions {
            workspace_cwd: root.clone(),
            config_cwd: None,
            dispatch: WorkerDispatchOptions {
                session_id: session_id.clone(),
                thread_name: "impl".to_string(),
                dispatch_id: "test-dispatch".to_string(),
                action: "use the echo tool".to_string(),
                source_threads: Vec::new(),
                skills: Vec::new(),
            },
            store: StoreOptions {
                store_path: Some(store_path.clone()),
            },
            model: test_openai_model_options(),
            sandbox: SandboxOptions::default(),
            ssh: SshOptions::default(),
        },
        &NacConfig::default(),
    )
    .await
    .unwrap();

    let captures = [&direct.agent, &resumed.agent, &worker.agent].map(|agent| {
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

    let after = build_run_config_for_project_with_behavior(
        run_options(&root, &store_path),
        &NacConfig::default(),
        None,
        sessions::SessionBehavior::Direct,
    )
    .await
    .unwrap();
    assert!(after
        .agent
        .tool_definitions_for_test()
        .iter()
        .all(|definition| definition.function.name != ECHO));

    drop((direct, resumed, worker, after));
    restore_env("OPENAI_API_KEY", original_api_key);
}
