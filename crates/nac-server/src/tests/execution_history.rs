use super::*;
use nac_core::session_service::{ShellCommandRequest, ShellCommandSnapshot, ShellCommandState};

async fn history(app: &Router, session: &str) -> serde_json::Value {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/sessions/{session}/executions/history"))
                .header(header::HOST, "localhost")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    serde_json::from_slice(&to_bytes(response.into_body(), 1_000_000).await.unwrap()).unwrap()
}

#[tokio::test]
async fn history_route_preserves_canonical_result_after_process_local_owner_loss() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("history_route");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("server-test-key"));
    seed_direct_session(&root, "session");
    seed_direct_session(&root, "other");
    let manager = test_manager(&root);
    let app = router(manager.clone());
    assert_eq!(
        history(&app, "session").await["history"]["entries"],
        serde_json::json!([])
    );
    assert!(manager.inner.active_sessions.read().await.is_empty());
    let service = manager.attach_session("session").await.unwrap();
    service
        .submit_shell_command(ShellCommandRequest {
            request_id: "known".into(),
            command: "printf preserved; exit 7".into(),
            timeout_ms: None,
        })
        .await
        .unwrap();
    let first = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let page = history(&app, "session").await;
            if page["history"]["entries"][0]["command"]["state"] == "completed"
                && !service.has_active_operation()
            {
                break page;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let entry = &first["history"]["entries"][0];
    assert_eq!(entry["id"], "command-known");
    assert_eq!(entry["command"]["stdout"], "preserved");
    assert_eq!(entry["command"]["exit_code"], 7);
    assert!(entry["command"]["output_id"].is_null());
    let old_id = entry["execution"]["id"].as_str().unwrap().to_owned();
    manager
        .inner
        .active_sessions
        .write()
        .await
        .remove("session");
    drop(service);
    let lost = history(&app, "session").await;
    let restored = &lost["history"]["entries"][0];
    assert_eq!(restored["id"], entry["id"]);
    assert_eq!(restored["command"], entry["command"]);
    assert_eq!(
        restored["output"]["availability"],
        "process_local_unavailable"
    );
    assert!(restored["execution"].is_null());
    assert!(
        manager.inner.active_sessions.read().await.is_empty(),
        "history cannot reattach"
    );
    assert_eq!(
        history(&app, "other").await["history"]["entries"],
        serde_json::json!([])
    );
    assert!(manager
        .session_terminals()
        .attach_execution("session", &old_id, 64)
        .await
        .is_err());
    assert!(manager
        .session_terminals()
        .attach_execution("other", &old_id, 64)
        .await
        .is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn history_route_does_not_recover_unfinished_journal_or_create_executor() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("history_orphan_route");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("server-test-key"));
    seed_direct_session(&root, "session");
    let manager = test_manager(&root);
    let command = ShellCommandSnapshot {
        request_id: "orphan".into(),
        operation_id: uuid::Uuid::new_v4().to_string(),
        command: "touch must-not-run".into(),
        timeout_ms: 30_000,
        state: ShellCommandState::Started,
        accepted_at_epoch_ms: 1,
        finished_at_epoch_ms: None,
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        diagnostic: None,
        output_id: None,
        transcript_index: None,
    };
    let connection = rusqlite::Connection::open(root.join("store.db")).unwrap();
    connection
        .execute(
            "INSERT INTO human_shell_operations VALUES (?1,?2,?3,?4,?5,?6)",
            rusqlite::params![
                "session",
                command.request_id,
                "digest",
                command.operation_id,
                "started",
                serde_json::to_string(&command).unwrap()
            ],
        )
        .unwrap();
    drop(connection);
    let app = router(manager.clone());
    for _ in 0..3 {
        let page = history(&app, "session").await;
        assert_eq!(page["history"]["entries"][0]["command"]["state"], "started");
        assert!(page["history"]["entries"][0]["execution"].is_null());
        assert!(manager.inner.active_sessions.read().await.is_empty());
    }
    assert_eq!(
        nac_core::store::recent_shell_commands(&root.join("store.db"), "session", 1).unwrap(),
        vec![command]
    );
    assert!(
        nac_core::store::TranscriptLogWriter::new(&root.join("store.db"))
            .unwrap()
            .read_from("session", 0)
            .unwrap()
            .is_empty()
    );
    assert!(!root.join("must-not-run").exists());
    std::fs::remove_dir_all(root).unwrap();
}
