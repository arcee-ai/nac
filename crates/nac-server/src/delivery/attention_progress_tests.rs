//! Lazy HTTP polling is independent from current-projection wakeups.
use super::*;
use nac_core::sessions;

fn commit_request(path: &std::path::Path, run: &str) {
    // Canonical admission/terminal transaction, not a model-production claim.
    TranscriptLogWriter::new(path)
        .unwrap()
        .append_run_prompt(
            "session",
            0,
            &Message::User {
                content: "transport fixture".into(),
            },
            run,
        )
        .unwrap();
    sessions::save_session_run_state(
        path,
        &sessions::SessionRunStateUpdate {
            session_id: "session".into(),
            ssh: None,
            sandbox_spec: None,
            run_state: sessions::SessionRunState::default(),
            finished_run_id: Some(run.into()),
            finished_run_disposition: Some(store::RunTerminalDisposition::Completed),
            failed_run_id: None,
            failed_run_failure: None,
            goal_settlement: None,
            heartbeat_settlement: None,
            finished_run_result: Some("transport result".into()),
            updated_at: "now".into(),
        },
    )
    .unwrap();
}

async fn finish(manager: SessionManager, root: PathBuf) {
    manager.inner.attention.stop();
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn lazy_post_baseline_committed_completion_precedes_unrelated_wait() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = root();
    let _env = ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
    let manager = test_manager(&root);
    seed_direct_session(&root, "session");
    manager
        .inner
        .attention
        .configure_native(uuid::Uuid::new_v4(), "127.0.0.1:12345".into());
    let app = crate::router(manager.clone());
    let mut body = app
        .clone()
        .oneshot(request(&[("x-nac-completion-cursor", "new")]))
        .await
        .unwrap()
        .into_body()
        .into_data_stream();
    let cutoff = data(&next(&mut body).await.unwrap().unwrap());
    assert_eq!(cutoff["kind"], "completions");
    assert!(cutoff["page"]["baseline"].as_bool().unwrap());
    assert_eq!(
        data(&next(&mut body).await.unwrap().unwrap())["kind"],
        "baseline"
    );
    // Deliberately do not poll the lazy body while canonical A commits.
    let path = root.join("store.db");
    commit_request(&path, "canonical-A");
    let after = store::CompletionCursor {
        store: cutoff["page"]["store_id"].as_str().unwrap().into(),
        sequence: cutoff["page"]["cursor"].as_i64().unwrap(),
    };
    let canonical = store::read_completion_page(&path, Some(&after)).unwrap();
    assert_eq!(canonical.items.len(), 1);
    assert_eq!(canonical.items[0].run_id, "canonical-A");
    eprintln!(
        "semantic-progress-characterization {}",
        serde_json::json!({"stage":"canonical-A-before-postbaseline-poll","page":canonical})
    );
    assert_eq!(
        app.oneshot(request(&[])).await.unwrap().status(),
        StatusCode::CONFLICT
    );
    let resumed = tokio::time::timeout(Duration::from_millis(250), next(&mut body)).await;
    let page = resumed.ok().flatten().map(|bytes| data(&bytes.unwrap()));
    drop(body);
    finish(manager, root).await;
    assert!(
        page.is_some(),
        "S2_LAZY_BACKLOG_EXPECTED: committed A waited for unrelated current event/fallback"
    );
    let page = page.unwrap();
    assert_eq!(page["kind"], "completions");
    assert_eq!(page["page"]["items"][0]["run_id"], "canonical-A");
    assert_eq!(page["page"]["items"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn retired_observer_reset_precedes_committed_history_on_resume() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = root();
    let _env = ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
    let manager = test_manager(&root);
    seed_direct_session(&root, "session");
    manager
        .inner
        .attention
        .configure_native(uuid::Uuid::new_v4(), "127.0.0.1:12345".into());
    let mut body = crate::router(manager.clone())
        .oneshot(request(&[("x-nac-completion-cursor", "new")]))
        .await
        .unwrap()
        .into_body()
        .into_data_stream();
    next(&mut body).await.unwrap().unwrap();
    next(&mut body).await.unwrap().unwrap();
    commit_request(&root.join("store.db"), "retired-A");
    manager.inner.attention.stop();
    let reset = tokio::time::timeout(Duration::from_millis(250), next(&mut body))
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(data(&reset)["kind"], "reset");
    assert!(next(&mut body).await.is_none());
    drop(body);
    finish(manager, root).await;
}

#[tokio::test]
async fn empty_semantic_page_waits_and_current_record_still_precedes_history() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = root();
    let _env = ScopedModelEnv::isolated(&root.join("home"), Some("test-key"));
    let manager = test_manager(&root);
    seed_direct_session(&root, "session");
    manager
        .inner
        .attention
        .configure_native(uuid::Uuid::new_v4(), "127.0.0.1:12345".into());
    let mut body = crate::router(manager.clone())
        .oneshot(request(&[("x-nac-completion-cursor", "new")]))
        .await
        .unwrap()
        .into_body()
        .into_data_stream();
    next(&mut body).await.unwrap().unwrap();
    next(&mut body).await.unwrap().unwrap();
    assert!(
        tokio::time::timeout(Duration::from_millis(30), next(&mut body))
            .await
            .is_err()
    );
    // Retirement is a ready current-plane control; no five-second wait or
    // historical frame can hide it even after an empty semantic read.
    manager.inner.attention.stop();
    assert_eq!(
        data(&next(&mut body).await.unwrap().unwrap())["kind"],
        "reset"
    );
    assert!(next(&mut body).await.is_none());
    drop(body);
    finish(manager, root).await;
}
