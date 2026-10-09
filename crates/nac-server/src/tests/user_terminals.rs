use super::*;
use nac_core::permissions::PermissionApprovalMode;

fn terminal_request(method: &str, uri: &str, body: serde_json::Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header(header::HOST, "localhost")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

async fn terminal_json(
    app: &Router,
    method: &str,
    uri: &str,
    body: serde_json::Value,
) -> serde_json::Value {
    let response = app
        .clone()
        .oneshot(terminal_request(method, uri, body))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap()).unwrap()
}

#[tokio::test]
async fn user_terminal_http_protocol_rejects_invalid_requests_and_cross_origin_acknowledgements() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("user_terminal_protocol_validation");
    let home = root.join("nac-home");
    let _env =
        ScopedModelEnv::with_config_home(Some(&home), None, Some(&home), Some("server-test-key"));
    seed_direct_session(&root, "session");
    let manager = test_manager(&root);
    let service = manager.attach_session("session").await.unwrap();
    service
        .set_permission_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
    let app = router(manager);
    let launch_id = uuid::Uuid::new_v4().to_string();
    let open = serde_json::json!({"protocol_version":1,"launch_id":launch_id,"cols":80,"rows":24});
    for (field, value) in [
        ("protocol_version", serde_json::json!(2)),
        ("launch_id", serde_json::json!("invalid")),
        ("cols", serde_json::json!(1)),
        ("cols", serde_json::json!(501)),
        ("rows", serde_json::json!(0)),
        ("rows", serde_json::json!(301)),
        ("extra", serde_json::json!(true)),
    ] {
        let mut invalid = open.clone();
        invalid[field] = value;
        assert_eq!(
            app.clone()
                .oneshot(terminal_request(
                    "POST",
                    "/sessions/session/user-terminals",
                    invalid
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    assert!(service.list_user_terminals().await.unwrap().is_empty());
    let terminal = terminal_json(
        &app,
        "POST",
        "/sessions/session/user-terminals",
        open.clone(),
    )
    .await;
    let retry = terminal_json(&app, "POST", "/sessions/session/user-terminals", open).await;
    assert_eq!(terminal["terminal_id"], retry["terminal_id"]);
    let id = terminal["terminal_id"].as_str().unwrap();
    let base = format!("/sessions/session/user-terminals/{id}");
    for limit in [0, 65537] {
        assert_eq!(
            app.clone()
                .oneshot(terminal_request(
                    "POST",
                    &format!("{base}/observers"),
                    serde_json::json!({"protocol_version":1,"page_limit":limit})
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    let observer = terminal_json(
        &app,
        "POST",
        &format!("{base}/observers"),
        serde_json::json!({"protocol_version":1,"page_limit":8}),
    )
    .await;
    let observation = format!(
        "{base}/observers/{}",
        observer["observer_id"].as_str().unwrap()
    );
    let read = format!("{observation}/read");
    for body in [
        serde_json::json!({"protocol_version":1,"acknowledge_reset":false,"wait_ms":1001}),
        serde_json::json!({"protocol_version":1,"acknowledge_reset":true,"wait_ms":0}),
        serde_json::json!({"protocol_version":1,"acknowledge_offset":"18446744073709551616","acknowledge_reset":false,"wait_ms":0}),
        serde_json::json!({"protocol_version":1,"acknowledge_offset":"NaN","acknowledge_reset":false,"wait_ms":0}),
        serde_json::json!({"protocol_version":1,"acknowledge_offset":"+0","acknowledge_reset":false,"wait_ms":0}),
        serde_json::json!({"protocol_version":1,"acknowledge_offset":"00","acknowledge_reset":false,"wait_ms":0}),
        serde_json::json!({"protocol_version":1,"acknowledge_offset":"","acknowledge_reset":false,"wait_ms":0}),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(terminal_request("POST", &read, body))
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    let mut forged = terminal_request(
        "POST",
        &read,
        serde_json::json!({"protocol_version":1,"acknowledge_reset":false,"wait_ms":0}),
    );
    forged
        .headers_mut()
        .insert(header::ORIGIN, "https://attacker.example".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(forged).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let mut metadata_forged = terminal_request(
        "POST",
        &read,
        serde_json::json!({"protocol_version":1,"acknowledge_reset":false,"wait_ms":0}),
    );
    metadata_forged
        .headers_mut()
        .insert("sec-fetch-site", "cross-site".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(metadata_forged).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let mut valid = terminal_request(
        "POST",
        &read,
        serde_json::json!({"protocol_version":1,"acknowledge_reset":false,"wait_ms":0}),
    );
    valid
        .headers_mut()
        .insert(header::ORIGIN, "http://localhost".parse().unwrap());
    assert_eq!(
        app.clone().oneshot(valid).await.unwrap().status(),
        StatusCode::OK
    );
    for (path, body) in [
        (
            format!("{base}/input"),
            serde_json::json!({"protocol_version":1,"bytes":vec![0u8;16385]}),
        ),
        (
            format!("{base}/resize"),
            serde_json::json!({"protocol_version":1,"cols":501,"rows":24}),
        ),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(terminal_request("POST", &path, body))
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    for (path, body) in [
        (
            format!("{base}/resize"),
            serde_json::json!({"protocol_version":1,"cols":91,"rows":31}),
        ),
        (
            format!("{base}/input"),
            serde_json::json!({"protocol_version":1,"bytes":b"printf ROUTE-MARKER\\n\r".to_vec()}),
        ),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(terminal_request("POST", &path, body))
                .await
                .unwrap()
                .status(),
            StatusCode::NO_CONTENT
        );
    }
    let status = terminal_json(&app, "GET", &base, serde_json::Value::Null).await;
    assert_eq!(status["cols"], 91);
    assert_eq!(status["rows"], 31);
    let frame = terminal_json(
        &app,
        "POST",
        &read,
        serde_json::json!({"protocol_version":1,"acknowledge_reset":false,"wait_ms":1000}),
    )
    .await;
    assert!(frame["offset"].as_str().unwrap().parse::<u64>().is_ok());
    assert!(frame["next_offset"]
        .as_str()
        .unwrap()
        .parse::<u64>()
        .is_ok());
    assert!(frame["bytes"].as_array().unwrap().len() <= 8);
    assert!(frame["bytes"]
        .as_array()
        .unwrap()
        .iter()
        .all(|value| value.as_u64().is_some_and(|byte| byte <= 255)));
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let page = service
                .read_user_terminal_output(id, 0, 65536)
                .await
                .unwrap();
            if page
                .bytes
                .windows(b"ROUTE-MARKER".len())
                .any(|bytes| bytes == b"ROUTE-MARKER")
            {
                break;
            }
            service
                .wait_for_user_terminal_output(id, page.retained_end, 1000)
                .await
                .unwrap();
        }
    })
    .await
    .unwrap();
    for _ in 0..2 {
        assert_eq!(
            app.clone()
                .oneshot(terminal_request(
                    "DELETE",
                    &observation,
                    serde_json::Value::Null
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::NO_CONTENT
        );
    }
    assert!(service.user_terminal_status(id).await.unwrap().alive);
    service.terminate_user_terminal(id).await.unwrap();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn user_terminal_http_handles_are_session_scoped_and_restart_opaque() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("user_terminal_protocol_scope");
    let home = root.join("nac-home");
    let _env =
        ScopedModelEnv::with_config_home(Some(&home), None, Some(&home), Some("server-test-key"));
    seed_direct_session(&root, "owner");
    seed_direct_session(&root, "foreign");
    let manager = test_manager(&root);
    let service = manager.attach_session("owner").await.unwrap();
    service
        .set_permission_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
    let app = router(manager);
    let terminal = terminal_json(&app, "POST", "/sessions/owner/user-terminals", serde_json::json!({"protocol_version":1,"launch_id":uuid::Uuid::new_v4().to_string(),"cols":80,"rows":24})).await;
    let id = terminal["terminal_id"].as_str().unwrap();
    let owner = format!("/sessions/owner/user-terminals/{id}");
    let foreign = format!("/sessions/foreign/user-terminals/{id}");
    let observer = terminal_json(
        &app,
        "POST",
        &format!("{owner}/observers"),
        serde_json::json!({"protocol_version":1,"page_limit":1024}),
    )
    .await;
    let observer_id = observer["observer_id"].as_str().unwrap();
    for (method, path, body) in [
        ("GET", foreign.clone(), serde_json::Value::Null),
        (
            "POST",
            format!("{foreign}/input"),
            serde_json::json!({"protocol_version":1,"bytes":[120]}),
        ),
        (
            "POST",
            format!("{foreign}/observers"),
            serde_json::json!({"protocol_version":1,"page_limit":1024}),
        ),
        (
            "POST",
            format!("{foreign}/observers/{observer_id}/read"),
            serde_json::json!({"protocol_version":1,"acknowledge_reset":false,"wait_ms":0}),
        ),
    ] {
        assert_eq!(
            app.clone()
                .oneshot(terminal_request(method, &path, body))
                .await
                .unwrap()
                .status(),
            StatusCode::CONFLICT
        );
    }
    assert_eq!(
        app.clone()
            .oneshot(terminal_request(
                "GET",
                "/sessions/missing/user-terminals",
                serde_json::Value::Null
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        app.clone()
            .oneshot(terminal_request(
                "DELETE",
                &format!("{foreign}/observers/{observer_id}"),
                serde_json::Value::Null
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::NO_CONTENT
    );
    let body = serde_json::json!({"protocol_version":1,"acknowledge_reset":false,"wait_ms":0});
    assert_eq!(
        app.clone()
            .oneshot(terminal_request(
                "POST",
                &format!("{owner}/observers/{observer_id}/read"),
                body.clone()
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    service.terminate_user_terminal(id).await.unwrap();
    drop(app);
    drop(service);
    let restarted = router(test_manager(&root));
    assert_eq!(
        restarted
            .clone()
            .oneshot(terminal_request("GET", &owner, serde_json::Value::Null))
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        restarted
            .oneshot(terminal_request(
                "POST",
                &format!("{owner}/observers/{observer_id}/read"),
                body
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    let _ = std::fs::remove_dir_all(root);
}
