//! Two serving owners must share one continuous preparation lease.
use super::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fresh_git_handoff_keeps_peer_retry_from_failing_the_initial_input() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::fs::canonicalize(temp_root("fresh_peer_handoff")).unwrap();
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(
        home.join("config.toml"),
        "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
    )
    .unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("fixture-key"));
    let (endpoint, count, provider) = counted_provider().await;
    let (first, occurrence, now) = seed_occurrence(&root, &endpoint).await;
    let second = owned(&root).await;
    let before_source = source(&root);
    let reserved = store::reserve_fresh_heartbeat_launch(
        &first.inner.store_path,
        &occurrence.occurrence_id,
        occurrence.revision,
        now,
    )
    .unwrap()
    .unwrap();
    let handoff = Arc::new(CreationProjectionGate::default());
    let source_gate = Arc::new(CreationProjectionGate::default());
    let published = Arc::new(CreationProjectionGate::default());
    *first
        .inner
        .task_preparations
        .scheduled_handoff
        .lock()
        .unwrap() = Some(handoff.clone());
    *first
        .inner
        .task_preparations
        .initial_input_wake
        .lock()
        .unwrap() = Some(published.clone());
    *second
        .inner
        .task_preparations
        .source_resolution
        .lock()
        .unwrap() = Some(source_gate.clone());
    let original = reserved.clone();
    let owner = first.clone();
    let mut preparing = Some(tokio::spawn(async move {
        TaskLaunchApplication::new(&owner).prepare(original).await
    }));
    let mut retry = None;
    let mut schedulers = Vec::new();
    let primary = catch_fixture_panic(async {
        tokio::time::timeout(Duration::from_secs(10), handoff.reached.notified())
            .await
            .unwrap();
        let peer = second.clone();
        let intent = reserved.clone();
        retry = Some(tokio::spawn(async move {
            TaskLaunchApplication::new(&peer).prepare(intent).await
        }));
        tokio::select! {
            result = retry.as_mut().unwrap() => {
                result.unwrap().unwrap();
                retry.take();
            }
            _ = source_gate.reached.notified() => {
                panic!("peer entered source resolution while the accepted handoff was held");
            }
            _ = tokio::time::sleep(Duration::from_secs(10)) => {
                panic!("peer did not defer its duplicate preparation");
            }
        }
        let before = prepared(&first, &occurrence.occurrence_id).await;
        assert!(before.receipt().first_input_id.is_none());
        assert!(before.receipt().initial_outcome.is_none());
        assert!(store::load_task_launch(
            &first.inner.store_path,
            &reserved.receipt().request.request_id
        )
        .unwrap()
        .is_none());
        handoff.resume.notify_one();
        tokio::time::timeout(Duration::from_secs(10), published.reached.notified())
            .await
            .unwrap();
        // Repeat the same peer retry after the exact input has been published,
        // while the original owner still holds preparation before its wake.
        tokio::time::timeout(
            Duration::from_secs(10),
            TaskLaunchApplication::new(&second).prepare(reserved.clone()),
        )
        .await
        .unwrap()
        .unwrap();
        let snapshot = fresh_projection_for_handoff(&first, &occurrence.occurrence_id).await;
        assert_eq!(snapshot["state"], "admitted");
        assert_eq!(snapshot["schedule"], "active");
        assert_eq!(snapshot["starts"], 1);
        assert_eq!(snapshot["inputs"].as_array().unwrap().len(), 1);
        assert_eq!(snapshot["inputs"][0]["status"], "pending");
        assert!(snapshot["run"].is_null() && snapshot["outcome"].is_null());
        assert_eq!(count.load(Ordering::SeqCst), 0);
        published.resume.notify_one();
        tokio::time::timeout(Duration::from_secs(10), preparing.as_mut().unwrap())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        preparing.take();
        schedulers.push(HeartbeatScheduler::start(&first));
        schedulers.push(HeartbeatScheduler::start(&second));
        let receipt = settled(&first, &occurrence.occurrence_id).await.unwrap();
        let after = boundary_snapshot(&root, &occurrence.occurrence_id);
        assert_eq!(receipt.request, reserved.receipt().request);
        assert_eq!(receipt.session_id, reserved.receipt().session_id);
        assert_eq!(after["sessions"], 1);
        assert_eq!(after["runs"], 1);
        assert_eq!(after["inputs"].as_array().unwrap().len(), 1);
        assert_eq!(after["inputs"][0]["status"], "delivered");
        assert_eq!(after["inputs"][0]["id"], after["input"]);
        assert_eq!(after["inputs"][0]["run"], after["run"]);
        assert_eq!(count.load(Ordering::SeqCst), 1);
        assert_eq!(source(&root), before_source);
    })
    .await;
    // Release every original waiter before retiring either store owner, on RED
    // as well as GREEN. Never detach a fixture's accepted preparation.
    handoff.resume.notify_one();
    source_gate.resume.notify_one();
    published.resume.notify_one();
    *first
        .inner
        .task_preparations
        .scheduled_handoff
        .lock()
        .unwrap() = None;
    *first
        .inner
        .task_preparations
        .initial_input_wake
        .lock()
        .unwrap() = None;
    *second
        .inner
        .task_preparations
        .source_resolution
        .lock()
        .unwrap() = None;
    let mut cleanup = Vec::new();
    for mut task in [preparing, retry].into_iter().flatten() {
        match tokio::time::timeout(Duration::from_secs(15), &mut task).await {
            Ok(joined) => cleanup.push((joined.is_ok(), false)),
            Err(_) => {
                first.stop_local_run_admission().await;
                second.stop_local_run_admission().await;
                // Keep and join the original handle after cooperative Stop;
                // consuming it in timeout would detach an accepted operation.
                cleanup.push((task.await.is_ok(), true));
            }
        }
    }
    for scheduler in schedulers {
        scheduler.stop().await;
    }
    let first_cleanup = retire(first).await;
    let second_cleanup = retire(second).await;
    provider.abort();
    let provider_closed = provider.await;
    assert!(
        cleanup
            .iter()
            .all(|(joined, timed_out)| *joined && !timed_out),
        "preparation cleanup unresolved: {cleanup:?}"
    );
    first_cleanup.unwrap();
    second_cleanup.unwrap();
    assert!(provider_closed.unwrap_err().is_cancelled());
    if let Err(panic) = primary {
        std::panic::resume_unwind(panic);
    }
    std::fs::remove_dir_all(root).unwrap();
}

async fn fresh_projection_for_handoff(manager: &SessionManager, id: &str) -> serde_json::Value {
    let current = prepared(manager, id).await;
    let receipt = current.receipt();
    let path = &manager.inner.store_path;
    let owner = format!("project:{}", receipt.destination.project_id);
    let schedule = store::read_heartbeat(path, &owner, &receipt.schedule_id).unwrap();
    let history = store::heartbeat_history(path, &owner, &receipt.schedule_id).unwrap();
    serde_json::json!({
        "state": history[0].state, "schedule": schedule.state,
        "starts": schedule.starts, "run": receipt.initial_run_id,
        "outcome": receipt.initial_outcome,
        "inputs": store::list_session_inbox(path, &receipt.session_id).unwrap(),
    })
}
