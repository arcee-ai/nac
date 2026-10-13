use super::*;
use nac_core::permissions::PermissionApprovalMode;

fn request(method: &str, uri: &str, body: serde_json::Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::HOST, "localhost")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn json(app: &Router, method: &str, uri: &str, body: serde_json::Value) -> serde_json::Value {
    let response = app
        .clone()
        .oneshot(request(method, uri, body))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap()).unwrap()
}

#[tokio::test]
async fn terminal_control_http_requires_exact_revision_and_never_enters_agent_approval() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("terminal_control");
    let home = root.join("nac-home");
    let _env =
        ScopedModelEnv::with_config_home(Some(&home), None, Some(&home), Some("server-test-key"));
    seed_direct_session(&root, "session");
    let manager = test_manager(&root);
    let service = manager.attach_session("session").await.unwrap();
    let app = router(manager);
    let terminal = service
        .open_user_terminal(uuid::Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    let base = format!("/sessions/session/executions/{}", terminal.id);
    let control = format!("{base}/input-control");
    let initial = json(&app, "GET", &control, serde_json::json!({})).await;
    assert_eq!(initial["controller"], "human");
    assert_eq!(initial["revision"], "1");
    let give = serde_json::json!({"protocol_version":1,"expected_revision":"1","controller":"agent","acknowledge_uncertainty":false});
    let handed = json(&app, "POST", &control, give.clone()).await;
    assert_eq!(handed["revision"], "2");
    assert_eq!(handed["controller"], "agent");
    assert_eq!(
        app.clone()
            .oneshot(request("POST", &control, give))
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    let input = serde_json::json!({"protocol_version":1,"expected_revision":"1","bytes":b"stale\n".to_vec()});
    assert_eq!(
        app.clone()
            .oneshot(request("POST", &format!("{base}/input"), input))
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    let reclaim = serde_json::json!({"protocol_version":1,"expected_revision":"2","controller":"human","acknowledge_uncertainty":false});
    let mut forged = request("POST", &control, reclaim.clone());
    forged
        .headers_mut()
        .insert(header::ORIGIN, "https://elsewhere.invalid".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(forged).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let reclaimed = json(&app, "POST", &control, reclaim).await;
    assert_eq!(reclaimed["revision"], "3");
    let receipt = json(&app, "POST", &format!("{base}/input"), serde_json::json!({"protocol_version":1,"expected_revision":"3","bytes":b"printf 'LITERAL:<RET>\\n'\n".to_vec()})).await;
    assert_eq!(receipt["outcome"], "written");
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let page = service
                .read_user_terminal_output(&terminal.id, 0, 65536)
                .await
                .unwrap();
            if String::from_utf8_lossy(&page.bytes).contains("LITERAL:<RET>\r\n") {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    for revision in ["00", "+3", "18446744073709551616"] {
        let body = serde_json::json!({"protocol_version":1,"expected_revision":revision,"controller":"human","acknowledge_uncertainty":false});
        assert_eq!(
            app.clone()
                .oneshot(request("POST", &control, body))
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    assert!(service.list_permission_requests().unwrap().is_empty());
    assert!(service.list_permission_grants().unwrap().is_empty());
    assert_eq!(
        service.permission_approval_mode().await.unwrap(),
        PermissionApprovalMode::Manual
    );
    service.terminate_user_terminal(&terminal.id).await.unwrap();
    assert_eq!(
        app.clone()
            .oneshot(request("GET", &control, serde_json::json!({})))
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    std::fs::remove_dir_all(root).unwrap();
}
