use super::*;
use nac_core::store::{self, FreshTaskRetainedAllowanceReceipt};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn human_host_allowance_http_is_revision_checked_idempotent_and_denial_preserving_without_agent_attachment(
) {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("fresh_host_allowance");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let config = home.join("config.toml");
    std::fs::write(
        &config,
        "[[permissions.rules]]\naction='*'\nresource='*'\neffect='ask'\n",
    )
    .unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("fixture-key"));
    let manager = test_manager(&root);
    let project = task_launches::fixture(&root, &manager).await.project_id;
    let app = router(manager.clone());
    let path = format!("/projects/{project}/task-schedules/retained-allowance");
    let change = serde_json::json!({"request_id":uuid::Uuid::new_v4().to_string(),"expected_revision":1,"retained_limit":2});
    let response = post_json(app.clone(), &path, change.clone()).await;
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&response_body(response).await)
    );
    let response = post_json(app.clone(), &path, change.clone()).await;
    assert_eq!(response.status(), StatusCode::OK);
    let replay: FreshTaskRetainedAllowanceReceipt =
        serde_json::from_slice(&response_body(response).await).unwrap();
    assert_eq!(replay.allowance.revision, 2);
    assert_eq!(replay.allowance.retained_limit, 2);
    let mut conflicting = change.clone();
    conflicting["retained_limit"] = serde_json::json!(3);
    assert_eq!(
        post_json(app.clone(), &path, conflicting).await.status(),
        StatusCode::CONFLICT
    );
    let mut forged = change;
    forged["human"] = serde_json::json!(true);
    assert_eq!(
        post_json(app.clone(), &path, forged).await.status(),
        StatusCode::BAD_REQUEST
    );
    std::fs::write(&config,"[[permissions.rules]]\naction='heartbeat_retained_manage'\nresource='host:local'\neffect='deny'\n").unwrap();
    let denied=post_json(app,&path,serde_json::json!({"request_id":uuid::Uuid::new_v4().to_string(),"expected_revision":2,"retained_limit":3})).await;
    assert_eq!(denied.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        store::fresh_heartbeat_retained_allowance(&manager.inner.store_path).unwrap(),
        replay.allowance
    );
    assert!(
        manager.inner.active_sessions.read().await.is_empty(),
        "human allowance management cannot attach an agent or request its approval"
    );
    assert!(
        store::list_permission_grants(&manager.inner.store_path, "missing-task")
            .unwrap()
            .is_empty()
    );
    assert!(
        store::fresh_heartbeat_inventory(&manager.inner.store_path, &project, None)
            .unwrap()
            .is_empty()
    );
}
