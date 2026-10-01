use super::*;
use crate::model::ModelClient;
use crate::session_service::tests::test_direct_active_service;

#[tokio::test(flavor = "current_thread")]
async fn queued_inbox_and_cancellation_do_not_block_runtime_timers() {
    let (parts, path) =
        test_direct_active_service("owned_cancel_gate", "session", ModelClient::new_for_test());
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let service = parts.service.clone();
    let run = service
        .coordinate_local(|service| service.try_begin_run(None, "hold run"))
        .await
        .unwrap()
        .unwrap();
    service.stop_run_admission().await.unwrap();
    let (pending, release, _) = crate::store::coordinator::block_executor(&owner);
    let input_service = service.clone();
    let input = tokio::spawn(async move {
        input_service
            .enqueue_direct_input_unchecked(
                crate::store::InboxDelivery::Steer,
                "retain input",
                None,
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(1), async {
        while service.active_operation.try_lock().is_ok() || owner.stats().queued == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let cancelling_service = service.clone();
    let id = run.run_id.clone();
    let cancelling = tokio::spawn(async move { cancelling_service.request_cancel(&id).await });
    tokio::time::timeout(
        Duration::from_secs(1),
        tokio::time::sleep(Duration::from_millis(10)),
    )
    .await
    .unwrap();
    assert!(!cancelling.is_finished());
    release.send(()).unwrap();
    pending.acknowledge().await.unwrap();
    let item = input.await.unwrap().unwrap();
    assert_eq!(item.target_run_id.as_deref(), Some(run.run_id.as_str()));
    cancelling.await.unwrap().unwrap();
    tokio::time::timeout(Duration::from_secs(1), async {
        while service.has_active_operation() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        owner
            .list_session_inbox("session".into())
            .await
            .unwrap()
            .len(),
        1
    );
    owner.shutdown().await.unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn shutdown_closes_admission_before_waiting_for_caller_capacity() {
    let (parts, path) = test_direct_active_service(
        "owned_shutdown_admission_saturation",
        "session",
        ModelClient::new_for_test(),
    );
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let service = parts.service.clone();
    let saturation = crate::store::reject_callers_for_test();
    let stopping_service = service.clone();
    let stopping = tokio::spawn(async move { stopping_service.stop_run_admission().await });
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert!(!stopping.is_finished());
    assert!(matches!(
        service.try_submit_prompt("must not start".to_owned()),
        Err(SessionSubmitError::Coordination { .. })
    ));
    drop(saturation);
    stopping.await.unwrap().unwrap();
    owner.shutdown().await.unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn compaction_lifecycle_waits_off_runtime_behind_durable_publication() {
    let (parts, path) = test_direct_active_service(
        "owned_compaction_event_gate",
        "session",
        ModelClient::new_for_test(),
    );
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let (pending, release, _) = crate::store::coordinator::block_executor(&owner);
    let sink = EventSink::bus(parts.service.event_bus.clone());
    let publication_sink = sink.clone();
    let publication = tokio::spawn(async move {
        publication_sink
            .try_emit_async(AgentEvent::ThreadStarted {
                name: "worker".into(),
                action: "work".into(),
                source_threads: Vec::new(),
            })
            .await
    });
    tokio::time::timeout(Duration::from_secs(1), async {
        while owner.stats().queued == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let lifecycle = tokio::spawn(async move {
        let lifecycle = crate::agent::CompactionLifecycle::start_async(
            sink,
            uuid::Uuid::new_v4(),
            crate::events::CompactionReason::Auto,
        )
        .await;
        drop(lifecycle);
    });
    tokio::time::timeout(
        Duration::from_secs(1),
        tokio::time::sleep(Duration::from_millis(10)),
    )
    .await
    .unwrap();
    assert!(!lifecycle.is_finished());
    release.send(()).unwrap();
    pending.acknowledge().await.unwrap();
    publication.await.unwrap().unwrap();
    lifecycle.await.unwrap();
    // Cleanup is an owned off-loop publication obligation.
    tokio::time::sleep(Duration::from_millis(10)).await;
    owner.shutdown().await.unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn lifecycle_overload_retries_do_not_open_replay_gaps() {
    let (parts, path) = test_direct_active_service(
        "owned_lifecycle_retry_sequence",
        "session",
        ModelClient::new_for_test(),
    );
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let first = parts.service.event_bus.emit(SessionEvent::RunCancelled);
    let saturation = crate::store::reject_callers_for_test();
    let sink = EventSink::bus(parts.service.event_bus.clone());
    let publication = tokio::spawn(async move {
        sink.emit_lifecycle_async(AgentEvent::ThreadStarted {
            name: "worker".into(),
            action: "work".into(),
            source_threads: Vec::new(),
        })
        .await;
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(!publication.is_finished());
    drop(saturation);
    publication.await.unwrap();
    let next = parts.service.event_bus.emit(SessionEvent::RunCancelled);
    assert_eq!(next.sequence_id, first.sequence_id + 2);
    owner.shutdown().await.unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn selected_compaction_terminal_survives_cancelled_publication_wait() {
    let (parts, path) = test_direct_active_service(
        "owned_compaction_terminal_cancel",
        "session",
        ModelClient::new_for_test(),
    );
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let id = uuid::Uuid::new_v4();
    let mut lifecycle = crate::agent::CompactionLifecycle::start_async(
        EventSink::bus(parts.service.event_bus.clone()),
        id,
        crate::events::CompactionReason::Auto,
    )
    .await;
    let saturation = crate::store::reject_callers_for_test();
    let task = tokio::spawn(async move {
        lifecycle
            .finish(&Ok(crate::agent::CompactionResult::Compacted {
                compaction_id: id,
                projected_context: 256,
            }))
            .await;
    });
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert!(!task.is_finished());
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    drop(saturation);
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            let events = parts.service.recent_events(None, 64).1;
            if events.iter().any(|e| {
                matches!(e.event, SessionEvent::Agent {
                event: AgentEvent::OrchestratorCompactionCompleted { compaction_id, .. }
            } if compaction_id == id)
            }) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(10)).await;
    let events = parts.service.recent_events(None, 64).1;
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(e.event, SessionEvent::Agent {
        event: AgentEvent::OrchestratorCompactionCompleted { compaction_id, .. }
            | AgentEvent::OrchestratorCompactionFailed { compaction_id, .. }
    } if compaction_id == id))
            .count(),
        1
    );
    owner.shutdown().await.unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn committed_compaction_drop_cannot_publish_cancelled() {
    let (parts, path) = test_direct_active_service(
        "owned_committed_compaction_drop",
        "session",
        ModelClient::new_for_test(),
    );
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let id = uuid::Uuid::new_v4();
    let lifecycle = crate::agent::CompactionLifecycle::start_async(
        EventSink::bus(parts.service.event_bus.clone()),
        id,
        crate::events::CompactionReason::Auto,
    )
    .await;
    lifecycle
        .commit_marker()
        .record(crate::agent::CompactionResult::Compacted {
            compaction_id: id,
            projected_context: 256,
        });
    let task = tokio::spawn(async move {
        let _lifecycle = lifecycle;
        std::future::pending::<()>().await;
    });
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());

    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            let events = parts.service.recent_events(None, 64).1;
            if events.iter().any(|event| {
                matches!(event.event, SessionEvent::Agent {
                    event: AgentEvent::OrchestratorCompactionCompleted { compaction_id, .. }
                } if compaction_id == id)
            }) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let events = parts.service.recent_events(None, 64).1;
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event.event, SessionEvent::Agent {
                event: AgentEvent::OrchestratorCompactionCompleted { compaction_id, .. }
                    | AgentEvent::OrchestratorCompactionFailed { compaction_id, .. }
            } if compaction_id == id))
            .count(),
        1
    );
    assert!(!events
        .iter()
        .any(|event| matches!(event.event, SessionEvent::Agent {
        event: AgentEvent::OrchestratorCompactionFailed {
            compaction_id,
            failure: crate::events::CompactionFailure::Cancelled,
            ..
        }
    } if compaction_id == id)));
    owner.shutdown().await.unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn cancellation_drop_restores_local_run_during_caller_saturation() {
    let (parts, path) = test_direct_active_service(
        "owned_cancel_restore_saturation",
        "session",
        ModelClient::new_for_test(),
    );
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let service = parts.service.clone();
    let run = service
        .coordinate_local(|service| service.try_begin_run(None, "hold run"))
        .await
        .unwrap()
        .unwrap();
    let task = tokio::spawn(std::future::pending::<()>());
    service.set_run_task(&run.run_id, task);
    let id = run.run_id.clone();
    let cancellation = service
        .coordinate_local(move |service| service.mark_run_cancelling(&id))
        .await
        .unwrap()
        .unwrap();
    let saturation = crate::store::reject_callers_for_test();
    drop(cancellation);
    assert!(matches!(
        service.lock_active_operation().as_ref(),
        Some(ActiveSessionOperation::Run(active)) if !active.finishing && active.task.is_some()
    ));
    drop(saturation);
    owner.shutdown().await.unwrap();
    let mut operation = service.lock_active_operation();
    if let Some(ActiveSessionOperation::Run(active)) = operation.as_mut() {
        active.task.take().unwrap().abort();
        assert_eq!(active.snapshot.run_id, run.run_id);
    }
    *operation = None;
}
