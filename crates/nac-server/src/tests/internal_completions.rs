use super::*;

async fn send_json(app: Router, method: &str, uri: &str, body: serde_json::Value) -> Response {
    app.oneshot(
        Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
    .unwrap()
}

/// The public inbox reports who admitted each item, and its update/cancel
/// operations refuse an owned child result while a person's identical text
/// stays editable.
#[tokio::test]
async fn inbox_http_reports_origin_and_refuses_mutating_delegated_results() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("internal_completion_http");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("test-key"));
    seed_direct_session(&root, "parent");
    seed_direct_session(&root, "other");
    seed_direct_session(&root, "stranger");
    let store = root.join("store.db");
    nac_core::store::create_traditional_child_relationship(
        &store,
        "parent",
        "other",
        nac_core::store::GENERAL_CHILD_PROFILE,
        "background child",
    )
    .unwrap();
    let endpoint = point_session_at_hanging_endpoint(&root, "parent").await;
    let manager = test_manager(&root);
    let app = router(manager.clone());

    let busy = send_json(
        app.clone(),
        "POST",
        "/sessions/parent/inbox",
        serde_json::json!({"prompt": "hold the run open", "delivery": "queue"}),
    )
    .await;
    assert_eq!(busy.status(), StatusCode::ACCEPTED);
    tokio::time::timeout(Duration::from_secs(5), async {
        while nac_core::store::load_run_recovery(&store, "parent")
            .unwrap()
            .is_none()
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("parent run should commit its prompt");

    nac_core::store::begin_traditional_child_run(
        &store,
        "other",
        "child-run",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    let settled = nac_core::store::settle_traditional_child_run(
        &store,
        "other",
        "child-run",
        nac_core::store::TraditionalChildTerminal {
            status: nac_core::store::TraditionalChildStatus::Completed,
            report: Some("child result".into()),
            failure: None,
            change_summary: None,
            verification_summary: None,
        },
    )
    .unwrap();
    let internal_id = settled.child.completion_inbox_id.unwrap();
    let internal_text = nac_core::store::load_session_inbox_item(&store, "parent", internal_id)
        .unwrap()
        .content;
    let human = send_json(
        app.clone(),
        "POST",
        "/sessions/parent/inbox",
        serde_json::json!({"prompt": internal_text, "delivery": "queue"}),
    )
    .await;
    assert_eq!(human.status(), StatusCode::ACCEPTED);
    let human = response_json(human).await;
    assert_eq!(human["origin"], "input");

    let listed =
        response_json(get_response(app.clone(), "/sessions/parent/inbox", None).await).await;
    let items = listed.as_array().unwrap();
    let internal = items
        .iter()
        .find(|item| item["id"] == internal_id)
        .unwrap()
        .clone();
    assert_eq!(internal["origin"], "traditional_child");
    assert_eq!(internal["status"], "pending");
    assert_eq!(internal["delivery"], "steer");
    assert!(items
        .iter()
        .filter(|item| item["id"] != internal_id)
        .all(|item| item["origin"] == "input"));

    let item_uri = format!("/sessions/parent/inbox/{internal_id}");
    for (method, body) in [
        (
            "PATCH",
            serde_json::json!({"expected_version": internal["version"], "delivery": "queue"}),
        ),
        (
            "DELETE",
            serde_json::json!({"expected_version": internal["version"]}),
        ),
    ] {
        let refused = send_json(app.clone(), method, &item_uri, body).await;
        assert_eq!(refused.status(), StatusCode::CONFLICT, "{method}");
        assert_eq!(
            response_json(refused).await["error"],
            format!(
                "inbox item {internal_id} is a delegated result and cannot be changed or cancelled"
            )
        );
    }
    // Another session's route keeps the ordinary opaque not-found answer.
    let foreign = send_json(
        app.clone(),
        "DELETE",
        &format!("/sessions/stranger/inbox/{internal_id}"),
        serde_json::json!({"expected_version": 0}),
    )
    .await;
    assert_eq!(foreign.status(), StatusCode::NOT_FOUND);
    assert!(!response_json(foreign)
        .await
        .to_string()
        .contains("delegated result"));
    let unchanged =
        nac_core::store::load_session_inbox_item(&store, "parent", internal_id).unwrap();
    assert_eq!(unchanged.status, nac_core::store::InboxStatus::Pending);
    assert_eq!(unchanged.version, 0);

    let human_uri = format!("/sessions/parent/inbox/{}", human["id"]);
    let steered = send_json(
        app.clone(),
        "PATCH",
        &human_uri,
        serde_json::json!({"expected_version": human["version"], "delivery": "steer"}),
    )
    .await;
    assert_eq!(steered.status(), StatusCode::OK);
    let steered = response_json(steered).await;
    assert_eq!(steered["delivery"], "steer");
    let cancelled = send_json(
        app.clone(),
        "DELETE",
        &human_uri,
        serde_json::json!({"expected_version": steered["version"]}),
    )
    .await;
    assert_eq!(cancelled.status(), StatusCode::OK);
    assert_eq!(response_json(cancelled).await["status"], "cancelled");

    manager.cancel_active_run("parent").await.unwrap();
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}
