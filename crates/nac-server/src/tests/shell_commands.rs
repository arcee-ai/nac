use super::*;
use nac_core::session_service::{ShellCommandSnapshot, ShellCommandState};

fn seed_direct(root: &std::path::Path) {
    let mut snapshot = sessions::new_snapshot(
        "session".into(),
        root.into(),
        "model-a".into(),
        "https://api.openai.com/v1".into(),
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        Some("OPENAI_API_KEY".into()),
        BTreeMap::new(),
    );
    snapshot.behavior = sessions::SessionBehavior::Direct;
    sessions::create_session(&root.join("store.db"), &snapshot).unwrap();
}

async fn body(response: Response) -> ShellCommandSnapshot {
    serde_json::from_slice(&to_bytes(response.into_body(), 1_000_000).await.unwrap()).unwrap()
}

async fn get_command(app: Router, id: &str) -> Response {
    app.oneshot(
        Request::builder()
            .uri(format!("/sessions/session/user-commands/{id}"))
            .body(Body::empty())
            .unwrap(),
    )
    .await
    .unwrap()
}

async fn wait_command(app: Router, id: &str) -> ShellCommandSnapshot {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let command = body(get_command(app.clone(), id).await).await;
            if command.state.is_terminal() {
                return command;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn human_shell_routes_reconcile_two_clients_and_lost_acceptance_response() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("human_shell_http");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("server-test-key"));
    seed_direct(&root);
    let manager = owned_test_manager(&root).unwrap();
    let app = router(manager.clone());
    let payload =
        serde_json::json!({"request_id":"same", "command":"  printf 'route-result'; exit 9\n"});
    let (first, second) = tokio::join!(
        post_json(
            app.clone(),
            "/sessions/session/user-commands",
            payload.clone()
        ),
        post_json(
            app.clone(),
            "/sessions/session/user-commands",
            payload.clone()
        )
    );
    let statuses = [first.status(), second.status()];
    assert!(statuses.contains(&StatusCode::ACCEPTED));
    assert!(statuses.contains(&StatusCode::OK));
    // Deliberately discard the response bodies, then recover the identity.
    drop(first);
    drop(second);
    let result = wait_command(app.clone(), "same").await;
    assert_eq!(result.state, ShellCommandState::Completed);
    assert_eq!(result.exit_code, Some(9));
    assert_eq!(result.stdout, "route-result");
    let replay = post_json(app.clone(), "/sessions/session/user-commands", payload).await;
    assert_eq!(replay.status(), StatusCode::OK);
    assert_eq!(body(replay).await.operation_id, result.operation_id);
    let conflict = post_json(
        app.clone(),
        "/sessions/session/user-commands",
        serde_json::json!({"request_id":"same", "command":"echo changed"}),
    )
    .await;
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    let snapshot = manager.snapshot("session").await.unwrap();
    assert_eq!(snapshot.messages.len(), 1);
    assert_eq!(snapshot.shell_commands.len(), 1);
    assert!(snapshot.active_run.is_none());
    let output = app
        .oneshot(
            Request::builder()
                .uri("/sessions/session/user-commands/same/output?limit=1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(output.status(), StatusCode::OK);
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
}

#[tokio::test]
async fn human_shell_routes_keep_busy_rejection_and_shutdown_cancellation() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("human_shell_shutdown");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("server-test-key"));
    seed_direct(&root);
    let manager = owned_test_manager(&root).unwrap();
    let app = router(manager.clone());
    let accepted = post_json(
        app.clone(),
        "/sessions/session/user-commands",
        serde_json::json!({"request_id":"long", "command":"sleep 30"}),
    )
    .await;
    assert_eq!(accepted.status(), StatusCode::ACCEPTED);
    let busy = post_json(
        app.clone(),
        "/sessions/session/user-commands",
        serde_json::json!({"request_id":"busy", "command":"echo forbidden"}),
    )
    .await;
    assert_eq!(busy.status(), StatusCode::CONFLICT);
    manager.stop_local_run_admission().await;
    manager.quiesce_persistence_callers().await;
    assert_eq!(
        wait_command(app.clone(), "long").await.state,
        ShellCommandState::Cancelled
    );
    assert_eq!(
        get_command(app, "busy").await.status(),
        StatusCode::NOT_FOUND
    );
    manager.drain_persistence().await.unwrap();
}

#[tokio::test]
async fn human_shell_routes_reject_unsupported_and_invalid_requests() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("human_shell_validation");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("server-test-key"));
    seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
    let app = router(test_manager(&root));
    for payload in [
        serde_json::json!({"request_id":"unsupported","command":"echo denied"}),
        serde_json::json!({"request_id":"blank","command":" "}),
        serde_json::json!({"request_id":"timeout","command":"echo denied", "timeout_ms":0}),
    ] {
        let response = post_json(app.clone(), "/sessions/session/user-commands", payload).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}
