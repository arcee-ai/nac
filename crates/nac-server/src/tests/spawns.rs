use super::*;

#[tokio::test]
async fn spawn_list_unifies_agent_and_nac_assignments() {
    let root = temp_root("spawn_list");
    seed_direct_with_orchestrator_session_with_base_url(
        &root,
        "direct",
        "https://api.openai.com/v1".to_string(),
    );
    seed_direct_session(&root, "child");
    seed_editable_session(&root, "orchestrator-child");
    seed_editable_session(&root, "orchestrator");
    let store = root.join("store.db");
    nac_core::store::create_traditional_child_relationship(
        &store,
        "direct",
        "child",
        nac_core::store::GENERAL_CHILD_PROFILE,
        "review store",
    )
    .unwrap();
    nac_core::store::create_managed_orchestrator_relationship(
        &store,
        "direct",
        "orchestrator-child",
        "plan the work",
    )
    .unwrap();
    let app = router(test_manager(&root));

    let listed = get_response(app.clone(), "/sessions/direct/spawns", None).await;
    assert_eq!(listed.status(), StatusCode::OK);
    let body = response_json(listed).await;
    let rows = body.as_array().expect("spawn list");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["child_session_id"], "child");
    assert_eq!(rows[0]["child_behavior"], "direct");
    assert_eq!(rows[0]["status"], "idle");
    assert_eq!(rows[1]["child_session_id"], "orchestrator-child");
    assert_eq!(rows[1]["child_behavior"], "orchestrator");

    let one = get_response(app.clone(), "/sessions/direct/spawns/child", None).await;
    assert_eq!(one.status(), StatusCode::OK);
    assert_eq!(response_json(one).await["assignment_id"], "asgn_child");

    let rejected = get_response(app, "/sessions/orchestrator/spawns", None).await;
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(rejected).await["error"],
        sessions::NAC_CANNOT_CREATE_SESSIONS
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn nac_parent_cannot_create_spawns() {
    let root = temp_root("nac_parent_spawns");
    seed_editable_session(&root, "orchestrator");
    let app = router(test_manager(&root));

    let rejected = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/orchestrator/spawns")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"behavior":"direct","description":"forbidden spawn","prompt":"do not create a session","child_session_id":null,"background":true}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(rejected).await["error"],
        sessions::NAC_CANNOT_CREATE_SESSIONS
    );
    let _ = std::fs::remove_dir_all(root);
}
