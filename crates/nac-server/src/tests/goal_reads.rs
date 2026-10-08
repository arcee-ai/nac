use super::*;

#[tokio::test]
async fn idle_goal_reads_and_branch_switches_do_not_require_a_store_writer() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("idle_goal_branch_switch");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("idle-goal-test-key"));
    for args in [
        vec!["init"],
        vec!["config", "user.name", "NAC Test"],
        vec!["config", "user.email", "nac@example.invalid"],
        vec!["commit", "--allow-empty", "-m", "base"],
    ] {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success(), "{:?}", output);
    }
    seed_direct_session(&root, "direct");
    let store_path = root.join("store.db");
    let manager = test_manager(&root);
    let app = router(manager.clone());

    // A WAL writer excludes reconciliation's UPDATE but permits projections.
    // Exercise both first attachment and the cached-service wake path.
    for branch in ["first-attachment", "cached-attachment"] {
        let writer = rusqlite::Connection::open(&store_path).unwrap();
        writer.execute_batch("BEGIN IMMEDIATE").unwrap();
        let result = tokio::time::timeout(Duration::from_secs(2), async {
            tokio::join!(
                get_response(app.clone(), "/sessions/direct/goal", None),
                post_json(
                    app.clone(),
                    "/sessions/direct/workspace/branches",
                    serde_json::json!({"name": branch, "create": true}),
                )
            )
        })
        .await;
        writer.execute_batch("ROLLBACK").unwrap();
        let (goal, switched) = result.expect("idle goal read must not wait for a store writer");
        assert_eq!(goal.status(), StatusCode::OK);
        assert_eq!(response_body(goal).await.as_ref(), b"null");
        assert_eq!(switched.status(), StatusCode::OK);
        assert_eq!(response_json(switched).await["current"], branch);
        assert!(!manager.inner.active_sessions.read().await["direct"].has_active_operation());
    }

    // Genuine operation contention remains an explicit conflict; a goal read
    // can still project the idle session while another mutation owns its lease.
    let lease = sessions::SessionOperationLease::try_acquire(&store_path, "direct").unwrap();
    let goal = get_response(app.clone(), "/sessions/direct/goal", None).await;
    assert_eq!(goal.status(), StatusCode::OK);
    let busy = post_json(
        app.clone(),
        "/sessions/direct/workspace/branches",
        serde_json::json!({"name": "after-mutation", "create": true}),
    )
    .await;
    assert_eq!(busy.status(), StatusCode::CONFLICT);
    drop(lease);
    let switched = post_json(
        app,
        "/sessions/direct/workspace/branches",
        serde_json::json!({"name": "after-mutation", "create": true}),
    )
    .await;
    assert_eq!(switched.status(), StatusCode::OK);
    let _ = std::fs::remove_dir_all(root);
}
