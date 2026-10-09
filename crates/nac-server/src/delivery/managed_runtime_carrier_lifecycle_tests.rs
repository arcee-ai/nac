//! Deterministic retained-owner failure boundaries against actual SQLite waits.
use super::*;

async fn executing(store: &StoreCoordinator) {
    tokio::time::timeout(Duration::from_secs(2), async {
        while store.stats().executing == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}
async fn poll_wait<F: Future>(future: std::pin::Pin<&mut F>) {
    let mut future = future;
    std::future::poll_fn(|cx| {
        assert!(future.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
}

#[tokio::test]
async fn source_change_across_store_wait_denies_delivered_fresh_and_never_challenges() {
    let mut f = Fixture::new(true).await;
    let gate = Connection::open(&f.path).unwrap();
    gate.execute_batch("BEGIN IMMEDIATE").unwrap();
    let store = Arc::clone(&f.store);
    let facts = Arc::clone(&f.facts);
    let mut future = Box::pin(f.carrier().reserve());
    poll_wait(future.as_mut()).await;
    executing(&store).await;
    facts
        .lock()
        .unwrap()
        .assignment
        .insert("pvc_uid".into(), Value::from("replacement"));
    gate.execute_batch("ROLLBACK").unwrap();
    assert!(future.await.is_err());
    assert!(f.peer.check_live().is_err());
    assert_eq!(f.rows(), (1, Some("reserved".into())));
    assert!(f.carrier().challenge().await.is_err());
    f.finish().await;
}

#[tokio::test]
async fn cancelled_challenge_future_closes_retained_owner_even_after_lost_store_ack() {
    let mut f = Fixture::new(true).await;
    f.carrier().reserve().await.unwrap();
    let binding = f.carrier().binding.clone();
    let gate = Connection::open(&f.path).unwrap();
    gate.execute_batch("BEGIN IMMEDIATE").unwrap();
    let store = Arc::clone(&f.store);
    let mut future = Box::pin(f.carrier().challenge());
    poll_wait(future.as_mut()).await;
    executing(&store).await;
    drop(future); // adapter aborts but still retains the carrier object
    assert!(f.peer.check_live().is_err());
    gate.execute_batch("ROLLBACK").unwrap();
    let before = store.stats().acknowledgements_lost;
    assert!(matches!(
        store
            .reserve_managed_runtime_lease(binding, RuntimeLeaseClock::capture().unwrap())
            .await
            .unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    assert!(store.stats().acknowledgements_lost >= before);
    assert_eq!(f.rows(), (1, Some("challenged".into())));
    assert!(f.carrier().claim_submission().await.is_err());
    f.finish().await;
}

#[tokio::test]
async fn actual_eof_during_wait_denies_old_owner_and_replacement_cannot_adopt_pending() {
    let mut f = Fixture::new(true).await;
    f.carrier().reserve().await.unwrap();
    f.carrier().challenge().await.unwrap();
    let gate = Connection::open(&f.path).unwrap();
    gate.execute_batch("BEGIN IMMEDIATE").unwrap();
    let store = Arc::clone(&f.store);
    let mut socket = f.socket.take().unwrap();
    let mut future = Box::pin(f.carrier().claim_submission());
    poll_wait(future.as_mut()).await;
    executing(&store).await;
    socket.shutdown().await.unwrap();
    assert!(tokio::time::timeout(Duration::from_secs(2), future)
        .await
        .unwrap()
        .is_err());
    assert!(f.peer.check_live().is_err());
    let replacement = Fixture::new(true).await;
    assert!(!Arc::ptr_eq(&f.peer.channel, &replacement.peer.channel));
    assert!(f.carrier().challenge().await.is_err());
    gate.execute_batch("ROLLBACK").unwrap();
    replacement.finish().await;
    f.finish().await;
}

#[tokio::test]
async fn lost_consume_ack_restart_and_duplicate_never_reconstruct_active() {
    let mut f = Fixture::new(true).await;
    f.carrier().reserve().await.unwrap();
    f.carrier().challenge().await.unwrap();
    f.carrier().claim_submission().await.unwrap();
    let raw = f.response();
    let binding = f.carrier().binding.clone();
    let gate = Connection::open(&f.path).unwrap();
    gate.execute_batch("BEGIN IMMEDIATE").unwrap();
    let store = Arc::clone(&f.store);
    let mut future = Box::pin(f.carrier().consume(&raw));
    poll_wait(future.as_mut()).await;
    executing(&store).await;
    drop(future);
    gate.execute_batch("ROLLBACK").unwrap();
    assert!(matches!(
        store
            .reserve_managed_runtime_lease(binding.clone(), RuntimeLeaseClock::capture().unwrap())
            .await
            .unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    assert_eq!(
        f.rows(),
        (1, Some("active".into())),
        "commit can outlive dropped acknowledgment"
    );
    assert!(matches!(f.carrier().stage, Stage::Denied));
    assert!(f.carrier().consume(&raw).await.is_err());
    f.carrier().settle_denial().await.unwrap();
    drop(f.carrier.take());
    store.shutdown().await.unwrap();
    let reopened = StoreCoordinator::acquire(&f.path).unwrap();
    assert!(matches!(
        reopened
            .reserve_managed_runtime_lease(binding, RuntimeLeaseClock::capture().unwrap())
            .await
            .unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    assert_eq!(f.rows(), (1, Some("terminal".into())));
    reopened.shutdown().await.unwrap();
    if let Some(mut socket) = f.socket.take() {
        socket.shutdown().await.unwrap();
    }
    if let Some(io) = f.io.take() {
        assert_eq!(io.await.unwrap().unwrap(), 0);
    }
    std::fs::remove_dir_all(&f.root).unwrap();
    assert!(!f.root.exists());
}

#[tokio::test]
async fn exact_headers_body_response_and_selected_store_cannot_be_substituted() {
    for variant in 0..5 {
        let mut f = Fixture::new(true).await;
        match variant {
            0 => {
                let headers = &mut f.carrier().original.parts.headers;
                let value = headers["x-arcee-managed-operation-id"].clone();
                headers.append("x-arcee-managed-operation-id", value);
            }
            1 => f.carrier().original.body.push(b' '),
            2 => {
                f.carrier().original.parts.uri =
                    "/api/sessions/fixture/runs?stream=true&model=fixture"
                        .parse()
                        .unwrap()
            }
            3 => f.carrier().last_wall_ms = i64::MAX,
            _ => f.carrier().deadline = Instant::now(),
        }
        assert!(f.carrier().reserve().await.is_err());
        assert_eq!(f.rows(), (0, None));
        f.finish().await;
    }
    let mut f = Fixture::new(true).await;
    let other = Fixture::new(true).await;
    let selected = Arc::clone(&f.store);
    f.carrier().store = Arc::clone(&other.store);
    assert!(f.carrier().reserve().await.is_err());
    assert_eq!(f.rows(), (0, None));
    assert_eq!(other.rows(), (0, None));
    f.carrier().store = selected;
    assert!(f.carrier().reserve().await.is_err());
    f.finish().await;
    other.finish().await;

    let mut f = Fixture::new(true).await;
    f.carrier().reserve().await.unwrap();
    f.carrier().challenge().await.unwrap();
    f.carrier().claim_submission().await.unwrap();
    let mut raw: Value = serde_json::from_slice(&f.response()).unwrap();
    raw["beneficiary_user_id"] = Value::from(Uuid::new_v4().to_string());
    assert!(f
        .carrier()
        .consume(&serde_json::to_vec(&raw).unwrap())
        .await
        .is_err());
    assert_eq!(f.rows(), (1, Some("challenged".into())));
    f.finish().await;
}
