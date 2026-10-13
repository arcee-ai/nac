use super::*;
use nac_core::permissions::PermissionApprovalMode;
use nac_core::session_service::{ShellCommandError, ShellCommandRequest};

async fn read_json(
    app: &Router,
    method: &str,
    uri: &str,
    body: serde_json::Value,
) -> serde_json::Value {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .header(header::HOST, "localhost")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    serde_json::from_slice(&to_bytes(response.into_body(), 1_000_000).await.unwrap()).unwrap()
}

#[tokio::test]
async fn execution_catalog_never_attaches_and_observes_active_human_command_without_recovery() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("execution_catalog");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("server-test-key"));
    seed_direct_session(&root, "session");
    let manager = test_manager(&root);
    let app = router(manager.clone());
    let empty = read_json(
        &app,
        "GET",
        "/sessions/session/executions",
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(empty["executions"], serde_json::json!([]));
    assert!(!manager
        .inner
        .active_sessions
        .read()
        .await
        .contains_key("session"));
    let service = manager.attach_session("session").await.unwrap();
    service
        .set_permission_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
    let shell = service
        .open_user_terminal(uuid::Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    service
        .submit_shell_command(ShellCommandRequest {
            request_id: "live-command".into(),
            command: "printf ready; sleep 60".into(),
            timeout_ms: Some(60_000),
        })
        .await
        .unwrap();
    let entries = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let list = read_json(
                &app,
                "GET",
                "/sessions/session/executions",
                serde_json::Value::Null,
            )
            .await;
            if list["executions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["origin"] == "human_command")
            {
                break list;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let entries = entries["executions"].as_array().unwrap();
    assert_eq!(entries.len(), 2);
    assert!(entries
        .iter()
        .any(|entry| entry["id"] == shell.id && entry["origin"] == "human"));
    let command = entries
        .iter()
        .find(|entry| entry["origin"] == "human_command")
        .unwrap();
    assert_eq!(command["request_id"], "live-command");
    assert_eq!(command["representation"], "log");
    assert_eq!(command["input"], false);
    assert!(matches!(
        service
            .submit_shell_command(ShellCommandRequest {
                request_id: "busy".into(),
                command: "true".into(),
                timeout_ms: None
            })
            .await,
        Err(ShellCommandError::Busy)
    ));
    let id = command["id"].as_str().unwrap();
    let path = format!("/sessions/session/executions/{id}/observers");
    let first = read_json(
        &app,
        "POST",
        &path,
        serde_json::json!({"protocol_version":1,"page_limit":2}),
    )
    .await;
    let second = read_json(
        &app,
        "POST",
        &path,
        serde_json::json!({"protocol_version":1,"page_limit":2}),
    )
    .await;
    let read = format!("{path}/{}/read", first["observer_id"].as_str().unwrap());
    let frame = read_json(
        &app,
        "POST",
        &read,
        serde_json::json!({"protocol_version":1,"acknowledge_reset":false,"wait_ms":1000}),
    )
    .await;
    let replay = read_json(
        &app,
        "POST",
        &read,
        serde_json::json!({"protocol_version":1,"acknowledge_reset":false,"wait_ms":0}),
    )
    .await;
    assert_eq!(frame, replay);
    assert_eq!(frame["bytes"], serde_json::json!([114, 101]));
    let other = read_json(
        &app,
        "POST",
        &format!("{path}/{}/read", second["observer_id"].as_str().unwrap()),
        serde_json::json!({"protocol_version":1,"acknowledge_reset":false,"wait_ms":0}),
    )
    .await;
    assert_eq!(other["bytes"], frame["bytes"]);
    assert!(service.has_active_operation());
    manager
        .session_terminals()
        .stop_execution("session", id)
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        while service.has_active_operation() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(service.user_terminal_status(&shell.id).await.unwrap().alive);
    service.terminate_user_terminal(&shell.id).await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
