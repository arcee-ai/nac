//! Run capabilities and the final human-grant commit boundary. No commands run.
use super::*;
use crate::store::{permission_grant_test_gate, PermissionGrantTestPoint};

fn close_run(broker: &PermissionBroker) {
    let mut memory = broker.review.lock().unwrap();
    memory.run.record(PermissionReviewOutcome::Unavailable);
    memory.run.record(PermissionReviewOutcome::Unavailable);
}

async fn finish(task: tokio::task::JoinHandle<AuthorizationOutcome>) -> AuthorizationOutcome {
    tokio::time::timeout(Duration::from_secs(2), task)
        .await
        .unwrap()
        .unwrap()
}

async fn manual_pending(
    broker: &Arc<PermissionBroker>,
) -> (
    tokio::task::JoinHandle<AuthorizationOutcome>,
    PermissionRequest,
    crate::events::AssistantStreamDeltaReceiver,
) {
    let bus = crate::events::SessionEventBus::new(Some("session-a".into()));
    let interactive = bus.subscribe_assistant_deltas();
    let mut events = bus.subscribe();
    broker.attach_event_bus(bus);
    let task = spawn_authorize(
        broker,
        vec![PermissionResource::new("read", "/workspace/.env")
            .with_save_resource("/workspace/.env")],
    );
    let request = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let crate::events::SessionEvent::PermissionAsked { request } =
                events.recv().await.unwrap().event
            {
                break request;
            }
        }
    })
    .await
    .unwrap();
    (task, request, interactive)
}

fn outages() -> Arc<FakeReviewer> {
    FakeReviewer::answering((0..2).map(|_| {
        Err(ReviewUnavailable::new(
            PermissionReviewFailureReason::ServiceUnavailable,
            "synthetic outage",
        ))
    }))
}

async fn stop_with_siblings(broker: &Arc<PermissionBroker>) {
    broker.set_reviewer(outages());
    for cmd in ["command:[pwd]", "command:[date]"] {
        assert!(
            denied(authorize(broker, &[execute(cmd)]).await).contains("code=review_unavailable")
        );
    }
}

async fn writer_drained(path: &Path) {
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || {
        let connection = crate::store::open_runtime_connection(&path).unwrap();
        connection
            .execute_batch("BEGIN IMMEDIATE; ROLLBACK;")
            .unwrap();
    })
    .await
    .unwrap();
}

#[test]
fn taking_stop_diagnostic_never_reopens_the_run() {
    let mut memory = ReviewMemory::default();
    let old = memory.run.stop_signal();
    memory.run.record(PermissionReviewOutcome::Unavailable);
    memory.run.record(PermissionReviewOutcome::Unavailable);
    assert!(memory.run.take_stop().is_some());
    assert!(memory.run.take_stop().is_none());
    assert!(memory.run.stopped());
    let retired = memory.begin_run();
    assert!(old.is_closed() && retired.is_closed());
    assert!(!memory.run.stopped());
}

#[tokio::test]
async fn pending_manual_prompt_is_dismissed_and_late_always_has_no_authority() {
    let (path, broker) = review_broker(PermissionBackend::Local, outages()).await;
    let (manual, request, _interactive) = manual_pending(&broker).await;
    stop_with_siblings(&broker).await;
    assert!(denied(finish(manual).await).contains("code=review_stopped"));
    assert!(broker.pending().is_empty());
    assert!(broker.reply(&request.id, PermissionReply::Always).is_err());
    assert!(crate::store::list_permission_grants(&path, "session-a")
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn stopped_provider_wait_is_cancelled_without_releasing_the_provider() {
    let (_path, broker, reviewer, release) = gated_broker().await;
    let pending = spawn_authorize(&broker, vec![execute("command:[ls]")]);
    tokio::time::timeout(Duration::from_secs(2), reviewer.started.notified())
        .await
        .unwrap();
    stop_with_siblings(&broker).await;
    assert!(denied(finish(pending).await).contains("code=review_stopped"));
    assert!(
        release.send(ReviewVerdict::ApproveOnce).is_err(),
        "provider future must be dropped promptly"
    );
    assert!(broker
        .recent_reviews()
        .iter()
        .all(|r| r.outcome != Some(PermissionReviewOutcome::Approved)));
}

#[tokio::test]
async fn successor_run_cannot_revive_a_pending_provider_verdict() {
    let (_path, broker, reviewer, release) = gated_broker().await;
    let pending = spawn_authorize(&broker, vec![execute("command:[ls]")]);
    tokio::time::timeout(Duration::from_secs(2), reviewer.started.notified())
        .await
        .unwrap();
    broker.begin_review_run();
    assert!(denied(finish(pending).await).contains("code=review_stopped"));
    assert!(release.send(ReviewVerdict::ApproveOnce).is_err());
    broker.set_reviewer(FakeReviewer::answering([Ok(ReviewVerdict::ApproveOnce)]));
    assert_eq!(
        authorize(&broker, &[execute("command:[pwd]")]).await,
        AuthorizationOutcome::Allowed
    );
}

#[tokio::test]
async fn successor_run_cannot_adopt_an_invocation_waiting_on_its_first_await() {
    let reviewer = FakeReviewer::answering([Ok(ReviewVerdict::ApproveOnce)]);
    let (path, broker) = review_broker(PermissionBackend::Local, Arc::clone(&reviewer)).await;
    let (reached, release) = crate::permissions::broker::gate_grant_read_for_test(path);
    let pending = spawn_authorize(&broker, vec![execute("command:[ls]")]);
    reached.await.unwrap();
    broker.begin_review_run();
    release.send(()).unwrap();
    assert!(denied(finish(pending).await).contains("code=review_stopped"));
    assert!(
        reviewer.seen().is_empty(),
        "old invocation must keep the capability captured before awaiting"
    );
    assert_eq!(
        authorize(&broker, &[execute("command:[pwd]")]).await,
        AuthorizationOutcome::Allowed
    );
}

#[tokio::test]
async fn successor_run_cannot_revive_a_manual_waiter() {
    let (_path, broker) = review_broker(PermissionBackend::Local, outages()).await;
    let (manual, request, _interactive) = manual_pending(&broker).await;
    broker.begin_review_run();
    assert!(denied(finish(manual).await).contains("code=review_stopped"));
    assert!(broker.reply(&request.id, PermissionReply::Once).is_err());
    broker.set_reviewer(FakeReviewer::answering([Ok(ReviewVerdict::ApproveOnce)]));
    assert_eq!(
        authorize(&broker, &[execute("command:[pwd]")]).await,
        AuthorizationOutcome::Allowed
    );
}

#[tokio::test]
async fn queued_always_reply_cannot_win_a_stop_before_the_waiter_is_polled() {
    let (path, broker) = review_broker(PermissionBackend::Local, outages()).await;
    let (manual, request, _interactive) = manual_pending(&broker).await;
    // Synchronous close and reply, without yielding to the authorization task.
    close_run(&broker);
    broker.reply(&request.id, PermissionReply::Always).unwrap();
    assert!(denied(finish(manual).await).contains("code=review_stopped"));
    assert!(crate::store::list_permission_grants(&path, "session-a")
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn stop_before_final_commit_rolls_back_without_parking_the_runtime() {
    let (path, broker) = review_broker(PermissionBackend::Local, outages()).await;
    let (manual, request, _interactive) = manual_pending(&broker).await;
    let (reached, release) =
        permission_grant_test_gate(path.clone(), PermissionGrantTestPoint::BeforeCommit);
    broker.reply(&request.id, PermissionReply::Always).unwrap();
    tokio::time::timeout(Duration::from_secs(2), reached)
        .await
        .unwrap()
        .unwrap();
    // The SQL transaction is prepared, but has not acquired the final commit
    // fence or waiter lock. Stop must complete on this single-thread runtime.
    stop_with_siblings(&broker).await;
    assert!(denied(finish(manual).await).contains("code=review_stopped"));
    release.send(()).unwrap();
    writer_drained(&path).await;
    assert!(crate::store::list_permission_grants(&path, "session-a")
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn commit_admitted_before_stop_finishes_before_stop_is_reported() {
    let (path, broker) = review_broker(PermissionBackend::Local, outages()).await;
    let (manual, request, _interactive) = manual_pending(&broker).await;
    let (reached, release) =
        permission_grant_test_gate(path.clone(), PermissionGrantTestPoint::InsideCommit);
    broker.reply(&request.id, PermissionReply::Always).unwrap();
    tokio::time::timeout(Duration::from_secs(2), reached)
        .await
        .unwrap()
        .unwrap();
    let capability = broker.review.lock().unwrap().run.stop_signal();
    let siblings = {
        let broker = Arc::clone(&broker);
        tokio::spawn(async move { stop_with_siblings(&broker).await })
    };
    tokio::time::timeout(Duration::from_secs(2), capability.cancelled())
        .await
        .unwrap();
    // The runtime remains responsive while the store commit fence drains.
    tokio::task::yield_now().await;
    assert!(
        !siblings.is_finished(),
        "the triggering review must not report its terminal outcome before commit drains"
    );
    assert!(
        !manual.is_finished(),
        "the Always waiter must also drain the earlier admitted commit"
    );
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(2), siblings)
        .await
        .unwrap()
        .unwrap();
    assert!(denied(finish(manual).await).contains("code=review_stopped"));
    // The person's Always crossed the commit boundary before stop. Its grant
    // persists, while the invocation itself is denied after closure.
    assert_eq!(
        crate::store::list_permission_grants(&path, "session-a")
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn successor_reset_rejects_an_always_writer_waiting_for_sqlite() {
    let (path, broker) = review_broker(PermissionBackend::Local, outages()).await;
    let (manual, request, _interactive) = manual_pending(&broker).await;
    let connection = crate::store::open_runtime_connection(&path).unwrap();
    connection.execute_batch("BEGIN IMMEDIATE").unwrap();
    let (reached, release) =
        permission_grant_test_gate(path.clone(), PermissionGrantTestPoint::BeforeWriter);
    broker.reply(&request.id, PermissionReply::Always).unwrap();
    reached.await.unwrap();
    release.send(()).unwrap();
    broker.begin_review_run();
    assert!(denied(finish(manual).await).contains("code=review_stopped"));
    connection.execute_batch("ROLLBACK").unwrap();
    writer_drained(&path).await;
    assert!(crate::store::list_permission_grants(&path, "session-a")
        .unwrap()
        .is_empty());
    broker.set_reviewer(FakeReviewer::answering([Ok(ReviewVerdict::ApproveOnce)]));
    assert_eq!(
        authorize(&broker, &[execute("command:[pwd]")]).await,
        AuthorizationOutcome::Allowed
    );
}

#[tokio::test]
async fn aborting_the_outer_waiter_rejects_a_writer_waiting_for_sqlite() {
    let (path, broker) = review_broker(PermissionBackend::Local, outages()).await;
    let (manual, request, _interactive) = manual_pending(&broker).await;
    let connection = crate::store::open_runtime_connection(&path).unwrap();
    connection.execute_batch("BEGIN IMMEDIATE").unwrap();
    let (reached, release) =
        permission_grant_test_gate(path.clone(), PermissionGrantTestPoint::BeforeWriter);
    broker.reply(&request.id, PermissionReply::Always).unwrap();
    reached.await.unwrap();
    release.send(()).unwrap();
    manual.abort();
    assert!(tokio::time::timeout(Duration::from_secs(2), manual)
        .await
        .unwrap()
        .unwrap_err()
        .is_cancelled());
    connection.execute_batch("ROLLBACK").unwrap();
    writer_drained(&path).await;
    assert!(crate::store::list_permission_grants(&path, "session-a")
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn stopped_authorized_retry_is_restored_for_the_successor_run() {
    let rejecting =
        FakeReviewer::answering([Ok(ReviewVerdict::Reject(ReviewCategory::OutOfScope))]);
    let (_path, broker) = review_broker(PermissionBackend::Local, rejecting).await;
    let action = vec![execute("command:[ls]")];
    assert!(denied(authorize(&broker, &action).await).contains("code=review_rejected"));
    let blocked = broker.blocked_reviews().remove(0);
    broker.authorize_review_retry(&blocked.id).unwrap();
    let (reviewer, release) = GatedReviewer::new();
    broker.set_reviewer(Arc::clone(&reviewer) as Arc<dyn PermissionReviewer>);
    let pending = spawn_authorize(&broker, action.clone());
    tokio::time::timeout(Duration::from_secs(2), reviewer.started.notified())
        .await
        .unwrap();
    close_run(&broker);
    assert!(denied(finish(pending).await).contains("code=review_stopped"));
    assert!(release.send(ReviewVerdict::ApproveOnce).is_err());
    assert_eq!(broker.pending_retry_authorizations_for_test(), 1);
    broker.begin_review_run();
    let approving = FakeReviewer::answering([Ok(ReviewVerdict::ApproveOnce)]);
    broker.set_reviewer(Arc::clone(&approving) as Arc<dyn PermissionReviewer>);
    assert_eq!(
        authorize(&broker, &action).await,
        AuthorizationOutcome::Allowed
    );
    assert!(approving.seen()[0].user_authorized_retry);
    assert_eq!(broker.pending_retry_authorizations_for_test(), 0);
}

#[tokio::test]
async fn abort_inside_commit_never_parks_the_async_runtime() {
    let (path, broker) = review_broker(PermissionBackend::Local, outages()).await;
    let (manual, request, _interactive) = manual_pending(&broker).await;
    let (reached, release) =
        permission_grant_test_gate(path.clone(), PermissionGrantTestPoint::InsideCommit);
    broker.reply(&request.id, PermissionReply::Always).unwrap();
    reached.await.unwrap();
    // A watchdog releases the blocking writer even if a broken Drop parks this
    // sole runtime worker. A tick before that release proves runtime progress.
    let (tick, ticked) = std::sync::mpsc::channel();
    let watchdog = std::thread::spawn(move || {
        let responsive = ticked.recv_timeout(Duration::from_secs(2)).is_ok();
        let _ = release.send(());
        responsive
    });
    manual.abort();
    let cancelled = tokio::time::timeout(Duration::from_secs(1), manual).await;
    let _ = tick.send(());
    assert!(
        tokio::task::spawn_blocking(move || watchdog.join().unwrap())
            .await
            .unwrap(),
        "abort teardown must not wait for SQLite commit on the runtime worker"
    );
    assert!(cancelled.unwrap().unwrap_err().is_cancelled());
    writer_drained(&path).await;
    assert_eq!(
        crate::store::list_permission_grants(&path, "session-a")
            .unwrap()
            .len(),
        1,
        "the human Always already won commit admission before abort"
    );
}

#[tokio::test]
async fn abort_before_commit_admission_rolls_back_the_prepared_transaction() {
    let (path, broker) = review_broker(PermissionBackend::Local, outages()).await;
    let (manual, request, _interactive) = manual_pending(&broker).await;
    let (reached, release) =
        permission_grant_test_gate(path.clone(), PermissionGrantTestPoint::BeforeCommit);
    broker.reply(&request.id, PermissionReply::Always).unwrap();
    reached.await.unwrap();
    manual.abort();
    assert!(tokio::time::timeout(Duration::from_secs(2), manual)
        .await
        .unwrap()
        .unwrap_err()
        .is_cancelled());
    release.send(()).unwrap();
    writer_drained(&path).await;
    assert!(crate::store::list_permission_grants(&path, "session-a")
        .unwrap()
        .is_empty());
}
