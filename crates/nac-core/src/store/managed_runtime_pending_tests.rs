//! Observations borrow delivered capabilities and never recreate/consume one.
use super::*;

#[test]
fn initial_pending_repeated_observations_keep_exact_challenge_and_original_ceilings() {
    let fixture = Fixture::new();
    let pending = fixture.pending();
    let anchors = (
        pending.original_admission_deadline,
        pending.monotonic_deadline,
    );
    for elapsed in [1, 1_000, 2_000, 9_999] {
        assert!(check_managed_runtime_initial_pending(
            &fixture.path,
            &pending,
            fixture.at(elapsed)
        )
        .unwrap());
        assert_eq!(
            (
                pending.original_admission_deadline,
                pending.monotonic_deadline
            ),
            anchors
        );
        assert_eq!(fixture.phase(), "challenged");
        assert!(matches!(
            reserve_managed_runtime_lease(&fixture.path, &fixture.binding, fixture.at(elapsed))
                .unwrap(),
            RuntimeLeaseReservationOutcome::Readback(ManagedRuntimeOperationSnapshot {
                observation: None,
                ..
            })
        ));
    }
    assert!(
        !check_managed_runtime_initial_pending(&fixture.path, &pending, fixture.at(10_000))
            .unwrap()
    );
    assert_eq!(fixture.phase(), "terminal");
    assert!(
        !check_managed_runtime_initial_pending(&fixture.path, &pending, fixture.at(1_000)).unwrap()
    );
}

#[test]
fn initial_pending_observation_stops_after_consume_and_never_revokes_active_renewal() {
    let fixture = Fixture::new();
    let pending = fixture.pending();
    let old = duplicate_pending(&pending);
    let response = fixture.response(&pending, 20_000);
    assert!(
        check_managed_runtime_initial_pending(&fixture.path, &pending, fixture.at(1_000)).unwrap()
    );
    let active =
        consume_managed_runtime_challenge(&fixture.path, pending, &response, fixture.at(2_000))
            .unwrap();
    assert!(
        !check_managed_runtime_initial_pending(&fixture.path, &old, fixture.at(3_000)).unwrap()
    );
    assert!(check_managed_runtime_lease(&fixture.path, &active, fixture.at(3_000)).unwrap());
    let native = fixture.native();
    let renewal = challenge_managed_runtime_renewal(
        &fixture.path,
        &active,
        &native,
        &fixture.challenge(4_000, 5_000),
        fixture.at(4_000),
    )
    .unwrap();
    assert!(
        !check_managed_runtime_initial_pending(&fixture.path, &renewal, fixture.at(4_001)).unwrap()
    );
    assert_eq!(fixture.phase(), "active");
    let mut response = fixture.response(&renewal, 30_000);
    response.observed_ms = fixture.at(4_001).wall_ms;
    consume_managed_runtime_challenge(&fixture.path, renewal, &response, fixture.at(4_001))
        .unwrap();
    assert!(
        !check_managed_runtime_initial_pending(&fixture.path, &old, fixture.at(4_002)).unwrap()
    );
}

#[test]
fn initial_pending_wrong_selected_store_and_prior_uncertainty_supply_no_observation() {
    let fixture = Fixture::new();
    let pending = fixture.pending();
    let mut other = Fixture::new();
    assert!(check_managed_runtime_initial_pending(&other.path, &pending, fixture.at(1)).is_err());
    other.binding = fixture.binding.clone();
    let other_pending = other.pending();
    assert!(!check_managed_runtime_initial_pending(&other.path, &pending, fixture.at(1)).unwrap());
    assert!(
        check_managed_runtime_initial_pending(&other.path, &other_pending, other.at(1)).unwrap()
    );
    assert!(check_managed_runtime_initial_pending(&fixture.path, &pending, fixture.at(1)).unwrap());

    let legacy = Fixture::new();
    record_managed_runtime_operation(&legacy.path, &legacy.binding.identity).unwrap();
    assert!(matches!(
        reserve_managed_runtime_lease(&legacy.path, &legacy.binding, legacy.clock).unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    let lost = Fixture::new();
    let mut connection = open_runtime_connection(&lost.path).unwrap();
    assert!(
        reserve_with_connection(&mut connection, &lost.binding, lost.clock, || Err(anyhow!(
            "lost actual Fresh delivery"
        )))
        .is_err()
    );
    assert!(matches!(
        reserve_managed_runtime_lease(&lost.path, &lost.binding, lost.clock).unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    // Neither readback arm contains a Pending that could be passed to the checker.
}

#[test]
fn initial_pending_changed_challenge_acknowledgment_and_terminal_state_stay_closed() {
    for variant in 0..5 {
        let fixture = Fixture::new();
        let pending = fixture.pending();
        match variant {
            0 => {
                Connection::open(&fixture.path)
                    .unwrap()
                    .execute(
                        "UPDATE managed_runtime_leases SET channel_id = ?1",
                        [Uuid::new_v4().to_string()],
                    )
                    .unwrap();
            }
            1 => {
                Connection::open(&fixture.path)
                    .unwrap()
                    .execute(
                        "UPDATE managed_runtime_leases SET challenge_sha256 = ?1",
                        [digest_hex(&[9; 32])],
                    )
                    .unwrap();
            }
            2 => {
                Connection::open(&fixture.path).unwrap().execute(
                "UPDATE managed_runtime_leases SET challenge_expires_ms = challenge_expires_ms - 1", []).unwrap();
            }
            3 => {
                acknowledge_managed_runtime_operation(
                    &fixture.path,
                    &fixture.binding.identity,
                    &ManagedRuntimeObservation::NotAdmitted,
                )
                .unwrap();
            }
            _ => {
                terminate_managed_runtime_lease(&fixture.path, &fixture.binding).unwrap();
            }
        }
        assert!(
            !check_managed_runtime_initial_pending(&fixture.path, &pending, fixture.at(1)).unwrap()
        );
        assert_eq!(fixture.phase(), "terminal");
        assert!(consume_managed_runtime_challenge(
            &fixture.path,
            pending,
            &RuntimeLeaseResponse {
                channel_id: Uuid::new_v4(),
                challenge_sha256: [6; 32],
                lease: RuntimeLeaseSnapshot {
                    lease_id: Uuid::new_v4(),
                    sequence: 1,
                    expires_ms: 120_000
                },
                observed_ms: 100_000
            },
            fixture.at(1)
        )
        .is_err());
    }
}

#[test]
fn initial_pending_native_wall_rollback_and_monotonic_expiry_do_not_reopen() {
    for monotonic in [false, true] {
        let fixture = Fixture::new();
        let pending = fixture.pending();
        assert!(
            check_managed_runtime_initial_pending(&fixture.path, &pending, fixture.at(2_000))
                .unwrap()
        );
        let clock = if monotonic {
            RuntimeLeaseClock::fixed(fixture.at(2_001).wall_ms, fixture.at(10_000).monotonic)
        } else {
            fixture.at(1_999)
        };
        assert!(!check_managed_runtime_initial_pending(&fixture.path, &pending, clock).unwrap());
        assert_eq!(fixture.phase(), "terminal");
        assert!(
            !check_managed_runtime_initial_pending(&fixture.path, &pending, fixture.at(3_000))
                .unwrap()
        );
    }
}

#[tokio::test]
async fn initial_pending_queued_observation_rechecks_live_clock_after_executor_wait() {
    let mut fixture = Fixture::new();
    fixture.clock = RuntimeLeaseClock::capture().unwrap();
    fixture.binding.original_expires_ms = fixture.clock.wall_ms + 5_000;
    let fresh = fixture.fresh();
    let challenge = RuntimeChallengeSpec {
        channel_id: Uuid::new_v4(),
        challenge_sha256: [6; 32],
        expires_ms: fixture.clock.wall_ms + 1_000,
    };
    let pending =
        challenge_managed_runtime_initial(&fixture.path, fresh, &challenge, fixture.clock).unwrap();
    let owner = StoreCoordinator::acquire(&fixture.path).unwrap();
    let (gate, release, _) = crate::store::coordinator::block_executor(&owner);
    let queued = owner
        .submit(CheckManagedRuntimeInitialPendingCommand {
            pending: InitialPendingCheck::from(&pending),
            clock: fixture.clock,
        })
        .unwrap();
    tokio::time::sleep_until(
        tokio::time::Instant::from_std(pending.monotonic_deadline) + Duration::from_millis(10),
    )
    .await;
    release.send(()).unwrap();
    gate.acknowledge().await.unwrap();
    assert!(queued.acknowledge().await.unwrap().unwrap().is_none());
    assert_eq!(fixture.phase(), "terminal");
    assert!(!owner
        .check_managed_runtime_initial_pending(&pending, RuntimeLeaseClock::capture().unwrap())
        .await
        .unwrap());
    owner.shutdown().await.unwrap();
}

#[tokio::test]
async fn initial_pending_observer_cancellation_and_lost_delivery_preserve_actual_pending() {
    let fixture = Fixture::new();
    let pending = fixture.pending();
    let owner = StoreCoordinator::acquire(&fixture.path).unwrap();
    let (gate, release, _) = crate::store::coordinator::block_executor(&owner);
    let mut caller =
        Box::pin(owner.check_managed_runtime_initial_pending(&pending, fixture.at(1_000)));
    std::future::poll_fn(|cx| {
        assert!(std::future::Future::poll(caller.as_mut(), cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    drop(caller);
    release.send(()).unwrap();
    gate.acknowledge().await.unwrap();
    while owner.stats().cancelled_before_execution == 0 {
        tokio::task::yield_now().await;
    }
    assert_eq!(fixture.phase(), "challenged");
    assert!(
        owner
            .check_managed_runtime_initial_pending(&pending, fixture.at(500))
            .await
            .unwrap(),
        "cancelled queued observer never advances the rollback watermark"
    );
    let completed = owner.stats().completed;
    let delivered = owner
        .submit(CheckManagedRuntimeInitialPendingCommand {
            pending: InitialPendingCheck::from(&pending),
            clock: fixture.at(1_000),
        })
        .unwrap();
    while owner.stats().completed == completed {
        tokio::task::yield_now().await;
    }
    drop(delivered);
    assert!(owner
        .check_managed_runtime_initial_pending(&pending, fixture.at(1_001))
        .await
        .unwrap());
    let response = fixture.response(&pending, 20_000);
    owner
        .consume_managed_runtime_challenge(pending, response, fixture.at(2_000))
        .await
        .unwrap();
    assert_eq!(fixture.phase(), "active");
    owner.shutdown().await.unwrap();
}

#[test]
fn initial_pending_parallel_borrowed_observers_do_not_create_another_reservation() {
    let fixture = Fixture::new();
    let pending = Arc::new(fixture.pending());
    let start = Arc::new(Barrier::new(3));
    let readers = (0..2)
        .map(|_| {
            let pending = Arc::clone(&pending);
            let start = Arc::clone(&start);
            let path = fixture.path.clone();
            let clock = fixture.at(1_000);
            std::thread::spawn(move || {
                start.wait();
                check_managed_runtime_initial_pending(&path, &pending, clock).unwrap()
            })
        })
        .collect::<Vec<_>>();
    start.wait();
    assert!(readers.into_iter().all(|reader| reader.join().unwrap()));
    assert!(matches!(
        reserve_managed_runtime_lease(&fixture.path, &fixture.binding, fixture.at(1_000)).unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    let pending = Arc::try_unwrap(pending).unwrap();
    let response = fixture.response(&pending, 20_000);
    consume_managed_runtime_challenge(&fixture.path, pending, &response, fixture.at(1_001))
        .unwrap();
    assert_eq!(fixture.phase(), "active");
}

#[test]
fn initial_pending_delivery_uses_executor_clock_floor_and_stops_only_same_pending_owner() {
    for consumed in [false, true] {
        let fixture = Fixture::new();
        let pending = fixture.pending();
        let view = InitialPendingCheck::from(&pending);
        let checked = check_runtime_initial_pending_view(
            &fixture.path,
            InitialPendingCheck::from(&pending),
            fixture.at(2_000),
        )
        .unwrap()
        .unwrap();
        let received = fixture.at(1_999);
        assert!(
            view.available_at(received, fixture.at(500).wall_ms),
            "the earlier caller sample would miss rollback since execution"
        );
        assert!(
            !view.available_at(received, checked.wall_ms),
            "the privately delivered executor sample is the actual rollback floor"
        );
        if consumed {
            let response = fixture.response(&pending, 20_000);
            let active = consume_managed_runtime_challenge(
                &fixture.path,
                pending,
                &response,
                fixture.at(2_001),
            )
            .unwrap();
            stop_runtime_initial_pending_view(&fixture.path, view).unwrap();
            assert_eq!(fixture.phase(), "active");
            assert!(
                check_managed_runtime_lease(&fixture.path, &active, fixture.at(2_002)).unwrap()
            );
        } else {
            stop_runtime_initial_pending_view(&fixture.path, view).unwrap();
            assert_eq!(fixture.phase(), "terminal");
            assert!(!check_managed_runtime_initial_pending(
                &fixture.path,
                &pending,
                fixture.at(2_002)
            )
            .unwrap());
            let response = fixture.response(&pending, 20_000);
            assert!(consume_managed_runtime_challenge(
                &fixture.path,
                pending,
                &response,
                fixture.at(2_002),
            )
            .is_err());
        }
    }
}
