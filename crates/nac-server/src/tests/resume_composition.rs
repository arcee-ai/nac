//! Successful cold reconstruction after ordinary work, using the real router and store owner.
use super::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn completed_direct_reopens_after_owner_restart_without_replay() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("completed-direct-owner-restart");
    let _env = ScopedModelEnv::isolated(&root.join("home"), Some("restart-test-key"));
    let requests = Arc::new(StdMutex::new(Vec::<serde_json::Value>::new()));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let handler = {
        let requests = requests.clone();
        move |Json(request): Json<serde_json::Value>| {
            let requests = requests.clone();
            async move {
                let turn = {
                    let mut requests = requests.lock().unwrap();
                    requests.push(request);
                    requests.len()
                };
                Json(serde_json::json!({
                    "status":"completed",
                    "output":[{"type":"message","content":[{"type":"output_text","text":format!("ordinary result {turn}")}]}],
                    "usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}
                }))
            }
        }
    };
    let provider = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route("/responses", axum::routing::post(handler)),
        )
        .await
        .unwrap();
    });
    seed_direct_session_with_base_url(&root, "completed", base);
    let path = root.join("store.db");
    let baseline = nac_core::store::read_completion_page(&path, None)
        .unwrap()
        .cursor;
    let manager = owned_test_manager(&root).unwrap();
    let app = router(manager.clone());
    let service = manager.attach_session("completed").await.unwrap();
    let mut run_ids = Vec::new();
    for prompt in ["ordinary first turn", "ordinary second turn"] {
        let response = post_json(
            app.clone(),
            "/sessions/completed/runs",
            serde_json::json!({"prompt":prompt}),
        )
        .await;
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        run_ids.push(
            response_json(response).await["run_id"]
                .as_str()
                .unwrap()
                .to_owned(),
        );
        tokio::time::timeout(Duration::from_secs(5), async {
            while service.has_active_operation() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("ordinary run did not settle");
    }
    assert_ne!(run_ids[0], run_ids[1]);
    let before = manager.snapshot("completed").await.unwrap();
    let messages = serde_json::to_value(&before.messages).unwrap();
    assert!(messages.to_string().contains("ordinary result 2"));
    let transcript = serde_json::to_value(
        nac_core::store::TranscriptLogWriter::new(&path)
            .unwrap()
            .read_tail_from("completed", 0)
            .unwrap(),
    )
    .unwrap();
    let completions = nac_core::store::read_completion_page(&path, Some(&baseline)).unwrap();
    assert_eq!(completions.items.len(), 2);
    assert_eq!(
        completions
            .items
            .iter()
            .map(|item| &item.run_id)
            .collect::<Vec<_>>(),
        run_ids.iter().collect::<Vec<_>>()
    );
    assert_eq!(requests.lock().unwrap().len(), 2);
    drop(service);
    drop(app);
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);

    // A real serving-store lease must be released, not merely an active cache entry.
    let replacement = owned_test_manager(&root).expect("original owner did not release store");
    assert!(replacement.inner.active_sessions.read().await.is_empty());
    let app = router(replacement.clone());
    for _ in 0..2 {
        let response = get_response(
            app.clone(),
            "/sessions/completed?include_sessions=false",
            None,
        )
        .await;
        let status = response.status();
        let body = response_body(response).await;
        assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
        let snapshot: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(snapshot["metadata"]["session_id"], "completed");
        assert_eq!(snapshot["messages"], messages);
    }
    let context = crate::ProductContextApplication::new(replacement.clone())
        .read(Some("completed"))
        .await
        .unwrap();
    assert_eq!(context.session.unwrap().session_id, "completed");
    assert_eq!(
        serde_json::to_value(
            nac_core::store::TranscriptLogWriter::new(&path)
                .unwrap()
                .read_tail_from("completed", 0)
                .unwrap()
        )
        .unwrap(),
        transcript
    );
    assert_eq!(
        nac_core::store::read_completion_page(&path, Some(&baseline)).unwrap(),
        completions
    );
    assert_eq!(
        requests.lock().unwrap().len(),
        2,
        "cold reads called the model"
    );
    drop(app);
    replacement.quiesce_persistence_callers().await;
    replacement.drain_persistence().await.unwrap();
    drop(replacement);
    provider.abort();
    assert!(provider.await.unwrap_err().is_cancelled());
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn primary_topologies_cold_attach_and_explicit_resume_keep_scoped_context() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("primary-resume-context");
    let _env = ScopedModelEnv::isolated(&root.join("home"), Some("resume-test-key"));
    seed_direct_session(&root, "direct");
    seed_editable_session(&root, "orchestrator");
    seed_direct_with_orchestrator_session_with_base_url(
        &root,
        "delegating",
        "https://api.openai.com/v1".into(),
    );
    let manager = owned_test_manager(&root).unwrap();
    let app = router(manager.clone());
    for (id, behavior) in [
        ("direct", sessions::SessionBehavior::Direct),
        ("orchestrator", sessions::SessionBehavior::Orchestrator),
        (
            "delegating",
            sessions::SessionBehavior::DirectWithOrchestrator,
        ),
    ] {
        let response = get_response(
            app.clone(),
            &format!("/sessions/{id}?include_sessions=false"),
            None,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        manager.inner.active_sessions.write().await.clear();
        let service = manager.resume_session(id, None).await.unwrap();
        assert!(!service.has_active_operation());
        let context = crate::ProductContextApplication::new(manager.clone())
            .read(Some(id))
            .await
            .unwrap();
        let session = context.session.unwrap();
        assert_eq!(session.session_id, id);
        assert_eq!(session.behavior, behavior);
        drop(service);
    }
    drop(app);
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}
