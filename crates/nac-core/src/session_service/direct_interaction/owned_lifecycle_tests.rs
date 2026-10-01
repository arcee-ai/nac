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
