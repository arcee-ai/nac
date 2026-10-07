use super::*;
use std::sync::{Arc, Barrier};

#[path = "managed_runtime_pending_tests.rs"]
mod pending_tests;

struct Fixture {
    path: PathBuf,
    binding: RuntimeLeaseBinding,
    clock: RuntimeLeaseClock,
}
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir()
            .join(format!("nac-runtime-lease-{}", Uuid::new_v4()))
            .join("store.db");
        initialize(&path).unwrap();
        Self {
            path,
            binding: RuntimeLeaseBinding {
                identity: ManagedRuntimeOperationIdentity {
                    operation_id: Uuid::new_v4(),
                    full_input_sha256: [4; 32],
                },
                assignment_sha256: [5; 32],
                serving_lifetime_id: Uuid::new_v4(),
                original_expires_ms: 120_000,
            },
            clock: RuntimeLeaseClock::fixed(100_000, Instant::now()),
        }
    }
    fn at(&self, elapsed: u64) -> RuntimeLeaseClock {
        RuntimeLeaseClock::fixed(
            self.clock.wall_ms + i64::try_from(elapsed).unwrap(),
            self.clock.monotonic + Duration::from_millis(elapsed),
        )
    }
    fn fresh(&self) -> FreshRuntimeReservation {
        match reserve_managed_runtime_lease(&self.path, &self.binding, self.clock).unwrap() {
            RuntimeLeaseReservationOutcome::Fresh(fresh) => fresh,
            RuntimeLeaseReservationOutcome::Readback(_) => {
                panic!("fixture requires a fresh reservation")
            }
        }
    }
    fn challenge(&self, issued: u64, expires: u64) -> RuntimeChallengeSpec {
        RuntimeChallengeSpec {
            channel_id: Uuid::new_v4(),
            challenge_sha256: [6; 32],
            expires_ms: self.at(issued + expires).wall_ms,
        }
    }
    fn pending(&self) -> PendingRuntimeChallenge {
        challenge_managed_runtime_initial(
            &self.path,
            self.fresh(),
            &self.challenge(0, 10_000),
            self.clock,
        )
        .unwrap()
    }
    fn response(&self, pending: &PendingRuntimeChallenge, expires: u64) -> RuntimeLeaseResponse {
        RuntimeLeaseResponse {
            channel_id: pending.challenge.channel_id,
            challenge_sha256: pending.challenge.challenge_sha256,
            lease: RuntimeLeaseSnapshot {
                lease_id: pending
                    .prior
                    .as_ref()
                    .map_or_else(Uuid::new_v4, |lease| lease.lease_id),
                sequence: pending.prior.as_ref().map_or(1, |lease| lease.sequence + 1),
                expires_ms: self.at(expires).wall_ms,
            },
            observed_ms: self.clock.wall_ms,
        }
    }
    fn active(&self) -> ActiveRuntimeLease {
        let pending = self.pending();
        let response = self.response(&pending, 20_000);
        consume_managed_runtime_challenge(&self.path, pending, &response, self.at(1_000)).unwrap()
    }
    fn native(&self) -> ManagedRuntimeObservation {
        let native = ManagedRuntimeObservation::Run {
            session_id: Uuid::new_v4(),
            run_id: Uuid::new_v4(),
        };
        acknowledge_managed_runtime_operation(&self.path, &self.binding.identity, &native).unwrap();
        native
    }
    fn phase(&self) -> String {
        Connection::open(&self.path)
            .unwrap()
            .query_row(
                "SELECT phase FROM managed_runtime_leases WHERE operation_id = ?1",
                [self.binding.identity.operation_id.to_string()],
                |row| row.get(0),
            )
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(self.path.parent().unwrap()).unwrap();
    }
}

// Adversarial test-only reconstruction proves the durable CAS, independently
// of the public API's non-cloneable/non-deserializable pending capability.
fn duplicate_pending(pending: &PendingRuntimeChallenge) -> PendingRuntimeChallenge {
    PendingRuntimeChallenge {
        binding: pending.binding.clone(),
        reservation_id: pending.reservation_id,
        challenge: pending.challenge.clone(),
        prior: pending.prior.clone(),
        issued_ms: pending.issued_ms,
        original_admission_deadline: pending.original_admission_deadline,
        monotonic_deadline: pending.monotonic_deadline,
    }
}

#[test]
fn concurrent_duplicate_response_consumes_exactly_one_durable_challenge() {
    let fixture = Fixture::new();
    let pending = fixture.pending();
    let response = fixture.response(&pending, 20_000);
    let start = Arc::new(Barrier::new(4));
    let workers: Vec<_> = (0..4)
        .map(|_| {
            let path = fixture.path.clone();
            let pending = duplicate_pending(&pending);
            let response = response.clone();
            let clock = fixture.at(1_000);
            let start = start.clone();
            std::thread::spawn(move || {
                start.wait();
                consume_managed_runtime_challenge(&path, pending, &response, clock)
            })
        })
        .collect();
    let outcomes: Vec<_> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect();
    assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
    assert!(consume_managed_runtime_challenge(
        &fixture.path,
        pending,
        &response,
        fixture.at(1_000)
    )
    .is_err());
}

#[test]
fn managed_runtime_lease_process_helper() {
    let Ok(path) = std::env::var("NAC_TEST_RUNTIME_LEASE_PATH") else {
        return;
    };
    let binding = RuntimeLeaseBinding {
        identity: ManagedRuntimeOperationIdentity {
            operation_id: Uuid::parse_str(
                &std::env::var("NAC_TEST_RUNTIME_LEASE_OPERATION").unwrap(),
            )
            .unwrap(),
            full_input_sha256: [4; 32],
        },
        assignment_sha256: [5; 32],
        serving_lifetime_id: Uuid::parse_str(
            &std::env::var("NAC_TEST_RUNTIME_LEASE_LIFETIME").unwrap(),
        )
        .unwrap(),
        original_expires_ms: 120_000,
    };
    let outcome = reserve_managed_runtime_lease(
        Path::new(&path),
        &binding,
        RuntimeLeaseClock::fixed(100_000, Instant::now()),
    )
    .unwrap();
    println!(
        "RUNTIME_LEASE_FRESH={}",
        matches!(outcome, RuntimeLeaseReservationOutcome::Fresh(_))
    );
}

#[test]
fn separate_processes_and_process_restart_never_reopen_a_fresh_reservation() {
    let fixture = Fixture::new();
    let spawn = || {
        std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "store::managed_runtime_leases::tests::managed_runtime_lease_process_helper",
                "--nocapture",
            ])
            .env("NAC_TEST_RUNTIME_LEASE_PATH", &fixture.path)
            .env(
                "NAC_TEST_RUNTIME_LEASE_OPERATION",
                fixture.binding.identity.operation_id.to_string(),
            )
            .env(
                "NAC_TEST_RUNTIME_LEASE_LIFETIME",
                fixture.binding.serving_lifetime_id.to_string(),
            )
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap()
    };
    let children: Vec<_> = (0..4).map(|_| spawn()).collect();
    let outputs: Vec<_> = children
        .into_iter()
        .map(|child| {
            let output = child.wait_with_output().unwrap();
            assert!(
                output.status.success(),
                "child failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8(output.stdout).unwrap()
        })
        .collect();
    assert_eq!(
        outputs
            .iter()
            .filter(|output| output.contains("RUNTIME_LEASE_FRESH=true"))
            .count(),
        1
    );
    let restarted = spawn().wait_with_output().unwrap();
    assert!(restarted.status.success());
    assert!(String::from_utf8(restarted.stdout)
        .unwrap()
        .contains("RUNTIME_LEASE_FRESH=false"));
}

#[test]
fn live_sql_history_rejects_identity_rewind_and_partial_nullable_state() {
    let fixture = Fixture::new();
    let _active = fixture.active();
    let connection = Connection::open(&fixture.path).unwrap();
    for sql in [
        "UPDATE managed_runtime_leases SET lease_id = 'replacement'",
        "UPDATE managed_runtime_leases SET lease_sequence = 0",
        "UPDATE managed_runtime_leases SET lease_sequence = NULL",
        "UPDATE managed_runtime_leases SET lease_expires_ms = lease_expires_ms + 1",
        "UPDATE managed_runtime_leases SET lease_sequence = 2, lease_expires_ms = NULL",
        "UPDATE managed_runtime_leases SET phase = 'reserved'",
        "UPDATE managed_runtime_leases SET channel_id = 'replacement'",
        "UPDATE managed_runtime_leases SET last_wall_ms = 0",
        "UPDATE managed_runtime_leases SET original_expires_ms = 999999",
        "UPDATE managed_runtime_leases SET assignment_sha256 = printf('%064d', 1)",
    ] {
        assert!(
            connection.execute(sql, []).is_err(),
            "live history rejects {sql}"
        );
    }
}

#[tokio::test]
async fn coordinator_lost_lease_ack_does_not_return_an_execution_capability_on_retry() {
    let fixture = Fixture::new();
    let pending = fixture.pending();
    let response = fixture.response(&pending, 20_000);
    let replay = duplicate_pending(&pending);
    let owner = StoreCoordinator::acquire(&fixture.path).unwrap();
    let queued = owner
        .submit(ConsumeManagedRuntimeChallengeCommand {
            pending,
            response: response.clone(),
            clock: fixture.at(1_000),
        })
        .unwrap();
    tokio::time::timeout(Duration::from_secs(3), async {
        while owner.stats().completed == 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    drop(queued);
    assert!(owner
        .consume_managed_runtime_challenge(replay, response, fixture.at(1_000))
        .await
        .is_err());
    assert!(matches!(
        owner
            .reserve_managed_runtime_lease(fixture.binding.clone(), fixture.clock)
            .await
            .unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    owner.shutdown().await.unwrap();
    assert_eq!(fixture.phase(), "active");
}

#[test]
fn only_new_reservation_can_issue_initial_challenge_and_retries_are_observational() {
    let fixture = Fixture::new();
    let fresh = fixture.fresh();
    assert!(matches!(
        reserve_managed_runtime_lease(&fixture.path, &fixture.binding, fixture.clock).unwrap(),
        RuntimeLeaseReservationOutcome::Readback(ManagedRuntimeOperationSnapshot {
            observation: None,
            ..
        })
    ));
    let pending = challenge_managed_runtime_initial(
        &fixture.path,
        fresh,
        &fixture.challenge(0, 10_000),
        fixture.clock,
    )
    .unwrap();
    assert_eq!(fixture.phase(), "challenged");
    let response = fixture.response(&pending, 20_000);
    let active =
        consume_managed_runtime_challenge(&fixture.path, pending, &response, fixture.at(1_000))
            .unwrap();
    assert!(check_managed_runtime_lease(&fixture.path, &active, fixture.at(19_999)).unwrap());
    assert!(!check_managed_runtime_lease(&fixture.path, &active, fixture.at(20_000)).unwrap());
    assert_eq!(fixture.phase(), "terminal");
    assert!(!check_managed_runtime_lease(&fixture.path, &active, fixture.at(1_001)).unwrap());
    assert!(matches!(
        reserve_managed_runtime_lease(&fixture.path, &fixture.binding, fixture.clock).unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
}

#[test]
fn lost_reservation_commit_ack_and_legacy_uncertainty_never_return_fresh_capability() {
    let fixture = Fixture::new();
    let mut connection = open_runtime_connection(&fixture.path).unwrap();
    assert!(
        reserve_with_connection(&mut connection, &fixture.binding, fixture.clock, || Err(
            anyhow!("fixture loses commit acknowledgment")
        ))
        .is_err()
    );
    drop(connection);
    assert!(matches!(
        reserve_managed_runtime_lease(&fixture.path, &fixture.binding, fixture.clock).unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    let legacy = Fixture::new();
    record_managed_runtime_operation(&legacy.path, &legacy.binding.identity).unwrap();
    assert!(matches!(
        reserve_managed_runtime_lease(&legacy.path, &legacy.binding, legacy.clock).unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    assert_eq!(
        Connection::open(&legacy.path)
            .unwrap()
            .query_row::<i64, _, _>("SELECT COUNT(*) FROM managed_runtime_leases", [], |row| row
                .get(0))
            .unwrap(),
        0
    );
}

#[test]
fn concurrent_connections_commit_exactly_one_fresh_reservation() {
    let fixture = Fixture::new();
    let start = Arc::new(Barrier::new(8));
    let workers: Vec<_> = (0..8)
        .map(|_| {
            let path = fixture.path.clone();
            let binding = fixture.binding.clone();
            let clock = fixture.clock;
            let start = start.clone();
            std::thread::spawn(move || {
                start.wait();
                reserve_managed_runtime_lease(&path, &binding, clock).unwrap()
            })
        })
        .collect();
    let outcomes: Vec<_> = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect();
    assert_eq!(
        outcomes
            .iter()
            .filter(|outcome| matches!(outcome, RuntimeLeaseReservationOutcome::Fresh(_)))
            .count(),
        1
    );
}

#[test]
fn challenge_timeout_and_monotonic_expiry_are_terminal_without_clock_extension() {
    for monotonic_only in [false, true] {
        let fixture = Fixture::new();
        let pending = fixture.pending();
        let response = fixture.response(&pending, 20_000);
        let mut clock = fixture.at(10_000);
        if monotonic_only {
            clock.wall_ms = fixture.clock.wall_ms + 1;
        }
        assert!(
            consume_managed_runtime_challenge(&fixture.path, pending, &response, clock).is_err()
        );
        assert_eq!(fixture.phase(), "terminal");
    }
    let fixture = Fixture::new();
    let active = fixture.active();
    let mut clock = fixture.at(20_000);
    clock.wall_ms = fixture.clock.wall_ms + 1_001;
    assert!(!check_managed_runtime_lease(&fixture.path, &active, clock).unwrap());
    assert_eq!(fixture.phase(), "terminal");
}

#[test]
fn wall_clock_rollback_is_terminal_and_cannot_recover_when_clock_catches_up() {
    let fixture = Fixture::new();
    let active = fixture.active();
    assert!(check_managed_runtime_lease(&fixture.path, &active, fixture.at(2_000)).unwrap());
    assert!(!check_managed_runtime_lease(&fixture.path, &active, fixture.at(1_999)).unwrap());
    assert!(!check_managed_runtime_lease(&fixture.path, &active, fixture.at(2_001)).unwrap());
    assert_eq!(fixture.phase(), "terminal");
}

#[test]
fn receipt_uses_remaining_absolute_lifetime_and_does_not_grant_a_new_sixty_seconds() {
    let fixture = Fixture::new();
    let pending = fixture.pending();
    let response = fixture.response(&pending, 20_000);
    let active =
        consume_managed_runtime_challenge(&fixture.path, pending, &response, fixture.at(9_000))
            .unwrap();
    assert_eq!(active.monotonic_deadline, fixture.at(20_000).monotonic);
    assert!(!check_managed_runtime_lease(&fixture.path, &active, fixture.at(20_000)).unwrap());
}

#[test]
fn substitutions_invalid_lifetimes_and_noninitial_sequences_do_not_accept() {
    for variant in 0..8 {
        let fixture = Fixture::new();
        let pending = fixture.pending();
        let mut response = fixture.response(&pending, 20_000);
        match variant {
            0 => response.channel_id = Uuid::new_v4(),
            1 => response.challenge_sha256[0] ^= 1,
            2 => response.lease.sequence = 2,
            3 => response.observed_ms = fixture.clock.wall_ms + 2_000,
            4 => response.observed_ms = -1,
            5 => response.lease.expires_ms = fixture.at(60_001).wall_ms,
            6 => response.lease.expires_ms = fixture.at(20_001).wall_ms,
            _ => response.lease.expires_ms = fixture.at(1_000).wall_ms,
        }
        assert!(
            consume_managed_runtime_challenge(&fixture.path, pending, &response, fixture.at(1_000))
                .is_err(),
            "substitution {variant}"
        );
        assert_eq!(fixture.phase(), "challenged");
    }
}

#[test]
fn stable_lease_renewal_requires_actual_retained_native_ack_and_increasing_sequence() {
    let fixture = Fixture::new();
    let old = fixture.active();
    let native = fixture.native();
    let wrong = ManagedRuntimeObservation::Run {
        session_id: Uuid::new_v4(),
        run_id: Uuid::new_v4(),
    };
    assert!(challenge_managed_runtime_renewal(
        &fixture.path,
        &old,
        &wrong,
        &fixture.challenge(10_000, 5_000),
        fixture.at(10_000)
    )
    .is_err());
    let pending = challenge_managed_runtime_renewal(
        &fixture.path,
        &old,
        &native,
        &fixture.challenge(10_000, 5_000),
        fixture.at(10_000),
    )
    .unwrap();
    assert!(check_managed_runtime_lease(&fixture.path, &old, fixture.at(10_001)).unwrap());
    let mut response = fixture.response(&pending, 60_000);
    response.observed_ms = fixture.at(10_001).wall_ms;
    response.lease.sequence = 4;
    let renewed =
        consume_managed_runtime_challenge(&fixture.path, pending, &response, fixture.at(11_000))
            .unwrap();
    assert_eq!(renewed.snapshot.lease_id, old.snapshot.lease_id);
    assert_eq!(renewed.snapshot.sequence, 4);
    assert!(!check_managed_runtime_lease(&fixture.path, &old, fixture.at(11_001)).unwrap());
    assert!(check_managed_runtime_lease(&fixture.path, &renewed, fixture.at(59_999)).unwrap());
    assert_eq!(
        fixture.phase(),
        "active",
        "stale capability must not revoke the renewed operation"
    );
}

#[test]
fn renewal_cannot_change_lease_or_sequence_or_extend_an_expired_old_lease() {
    for variant in 0..4 {
        let fixture = Fixture::new();
        let old = fixture.active();
        let native = fixture.native();
        let pending = challenge_managed_runtime_renewal(
            &fixture.path,
            &old,
            &native,
            &fixture.challenge(15_000, 5_000),
            fixture.at(15_000),
        )
        .unwrap();
        let mut response = fixture.response(&pending, 60_000);
        response.observed_ms = fixture.at(15_000).wall_ms;
        let clock = match variant {
            0 => {
                response.lease.lease_id = Uuid::new_v4();
                fixture.at(16_000)
            }
            1 => {
                response.lease.sequence = old.snapshot.sequence;
                fixture.at(16_000)
            }
            2 => fixture.at(20_000),
            _ => {
                let mut clock = fixture.at(20_000);
                clock.wall_ms = fixture.at(16_000).wall_ms;
                clock
            }
        };
        assert!(
            consume_managed_runtime_challenge(&fixture.path, pending, &response, clock).is_err()
        );
        if variant >= 2 {
            assert_eq!(fixture.phase(), "terminal");
        }
    }
}

#[test]
fn lost_lease_commit_response_keeps_consumed_challenge_and_cannot_dispatch_again() {
    let fixture = Fixture::new();
    let pending = fixture.pending();
    let response = fixture.response(&pending, 20_000);
    let mut connection = open_runtime_connection(&fixture.path).unwrap();
    assert!(consume_with_connection(
        &mut connection,
        pending,
        &response,
        fixture.at(1_000),
        || Err(anyhow!("fixture loses lease commit response"))
    )
    .is_err());
    drop(connection);
    assert_eq!(fixture.phase(), "active");
    let connection = Connection::open(&fixture.path).unwrap();
    let challenge: Option<String> = connection
        .query_row(
            "SELECT challenge_sha256 FROM managed_runtime_leases",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(challenge, None);
    assert!(matches!(
        reserve_managed_runtime_lease(&fixture.path, &fixture.binding, fixture.clock).unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
}

#[test]
fn binding_and_store_replacement_cannot_transfer_capabilities_or_revive_after_restart() {
    let fixture = Fixture::new();
    let fresh = fixture.fresh();
    let mut other = Fixture::new();
    other.binding = fixture.binding.clone();
    let _other_fresh = other.fresh();
    assert!(challenge_managed_runtime_initial(
        &other.path,
        fresh,
        &fixture.challenge(0, 10_000),
        fixture.clock
    )
    .is_err());
    let fixture = Fixture::new();
    let _active = fixture.active();
    for variant in 0..4 {
        let mut changed = fixture.binding.clone();
        match variant {
            0 => changed.assignment_sha256[0] ^= 1,
            1 => changed.serving_lifetime_id = Uuid::new_v4(),
            2 => changed.original_expires_ms += 1,
            _ => changed.identity.full_input_sha256[0] ^= 1,
        }
        assert!(terminate_managed_runtime_lease(&fixture.path, &changed).is_err());
    }
    let mut restarted = fixture.binding.clone();
    restarted.serving_lifetime_id = Uuid::new_v4();
    assert!(matches!(
        reserve_managed_runtime_lease(&fixture.path, &restarted, fixture.clock).unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    assert_eq!(
        fixture.phase(),
        "active",
        "observational retries do not mutate old authority"
    );
}

#[test]
fn termination_is_idempotent_scoped_and_sql_state_cannot_rewind() {
    let fixture = Fixture::new();
    let active = fixture.active();
    let other = Fixture::new();
    let other_active = other.active();
    terminate_managed_runtime_lease(&fixture.path, &fixture.binding).unwrap();
    terminate_managed_runtime_lease(&fixture.path, &fixture.binding).unwrap();
    assert!(!check_managed_runtime_lease(&fixture.path, &active, fixture.at(2_000)).unwrap());
    assert!(check_managed_runtime_lease(&other.path, &other_active, other.at(2_000)).unwrap());
    let connection = Connection::open(&fixture.path).unwrap();
    for sql in [
        "DELETE FROM managed_runtime_leases",
        "UPDATE managed_runtime_leases SET phase = 'active'",
        "UPDATE managed_runtime_leases SET last_wall_ms = 0",
        "UPDATE managed_runtime_leases SET serving_lifetime_id = 'changed'",
        "UPDATE managed_runtime_leases SET lease_sequence = 99",
    ] {
        assert!(
            connection.execute(sql, []).is_err(),
            "terminal history rejects {sql}"
        );
    }
}

#[test]
fn v33_forward_migration_preserves_journal_and_existing_uncertainty() {
    let fixture = Fixture::new();
    record_managed_runtime_operation(&fixture.path, &fixture.binding.identity).unwrap();
    super::super::insert_test_session(&fixture.path, "retained-native-session");
    let connection = Connection::open(&fixture.path).unwrap();
    connection.execute_batch("DROP TRIGGER managed_runtime_leases_no_delete; DROP TRIGGER managed_runtime_leases_fenced;
        DROP TABLE managed_runtime_leases; PRAGMA user_version = 33;").unwrap();
    drop(connection);
    initialize(&fixture.path).unwrap();
    initialize(&fixture.path).unwrap();
    assert!(
        read_managed_runtime_operation(&fixture.path, &fixture.binding.identity)
            .unwrap()
            .is_some()
    );
    assert!(matches!(
        reserve_managed_runtime_lease(&fixture.path, &fixture.binding, fixture.clock).unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    let connection = Connection::open(&fixture.path).unwrap();
    assert_eq!(
        connection
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        35
    );
    assert_eq!(
        connection
            .query_row::<i64, _, _>(
                "SELECT COUNT(*) FROM sessions WHERE session_id = 'retained-native-session'",
                [],
                |row| row.get(0)
            )
            .unwrap(),
        1
    );
    assert_eq!(
        connection
            .query_row::<i64, _, _>("SELECT COUNT(*) FROM managed_runtime_leases", [], |row| row
                .get(0))
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn coordinator_retains_sealed_capabilities_and_loss_of_reservation_ack_is_readback_only() {
    let fixture = Fixture::new();
    let owner = StoreCoordinator::acquire(&fixture.path).unwrap();
    let pending = owner
        .submit(ReserveManagedRuntimeLeaseCommand {
            binding: fixture.binding.clone(),
            clock: fixture.clock,
        })
        .unwrap();
    while owner.stats().completed == 0 {
        tokio::task::yield_now().await;
    }
    drop(pending);
    assert!(matches!(
        owner
            .reserve_managed_runtime_lease(fixture.binding.clone(), fixture.clock)
            .await
            .unwrap(),
        RuntimeLeaseReservationOutcome::Readback(_)
    ));
    owner.shutdown().await.unwrap();
    let fixture = Fixture::new();
    let owner = StoreCoordinator::acquire(&fixture.path).unwrap();
    let RuntimeLeaseReservationOutcome::Fresh(fresh) = owner
        .reserve_managed_runtime_lease(fixture.binding.clone(), fixture.clock)
        .await
        .unwrap()
    else {
        panic!("new coordinator operation requires fresh reservation")
    };
    let pending = owner
        .challenge_managed_runtime_initial(fresh, fixture.challenge(0, 10_000), fixture.clock)
        .await
        .unwrap();
    let response = fixture.response(&pending, 20_000);
    let active = owner
        .consume_managed_runtime_challenge(pending, response, fixture.at(1_000))
        .await
        .unwrap();
    assert!(owner
        .check_managed_runtime_lease(&active, fixture.at(2_000))
        .await
        .unwrap());
    owner
        .terminate_managed_runtime_lease(fixture.binding.clone())
        .await
        .unwrap();
    assert!(!owner
        .check_managed_runtime_lease(&active, fixture.at(2_001))
        .await
        .unwrap());
    owner.shutdown().await.unwrap();
}

#[test]
fn fresh_active_renewal_can_cross_original_http_expiry_without_resetting_monotonic_ceiling() {
    let fixture = Fixture::new();
    let initial = fixture.active();
    assert!(initial.initial_admission_available_at(fixture.at(1_000)));
    let native = fixture.native();
    let pending = challenge_managed_runtime_renewal(
        &fixture.path,
        &initial,
        &native,
        &fixture.challenge(10_000, 5_000),
        fixture.at(10_000),
    )
    .unwrap();
    let mut response = fixture.response(&pending, 60_000);
    response.observed_ms = fixture.at(11_000).wall_ms;
    let active =
        consume_managed_runtime_challenge(&fixture.path, pending, &response, fixture.at(11_000))
            .unwrap();
    let admission_stalled_wall =
        RuntimeLeaseClock::fixed(fixture.at(11_000).wall_ms, fixture.at(21_000).monotonic);
    assert!(
        active.available_at(admission_stalled_wall),
        "active original lease can continue"
    );
    assert!(
        !active.initial_admission_available_at(admission_stalled_wall),
        "renewal cannot rebase the retained initial HTTP admission ceiling"
    );
    assert!(fixture.at(30_000).wall_ms > fixture.binding.original_expires_ms);
    let pending = challenge_managed_runtime_renewal(
        &fixture.path,
        &active,
        &native,
        &fixture.challenge(30_000, 5_000),
        fixture.at(30_000),
    )
    .unwrap();
    let mut response = fixture.response(&pending, 90_000);
    response.observed_ms = fixture.at(31_000).wall_ms;
    let renewed =
        consume_managed_runtime_challenge(&fixture.path, pending, &response, fixture.at(31_000))
            .unwrap();
    let stalled_wall =
        RuntimeLeaseClock::fixed(fixture.at(31_000).wall_ms, fixture.at(89_000).monotonic);
    assert_eq!(
        renewed.remaining_at(stalled_wall),
        Some(Duration::from_millis(1_000)),
        "stalled wall cannot restart the accepted native ceiling"
    );
    let expired_mono = RuntimeLeaseClock::fixed(stalled_wall.wall_ms, fixture.at(90_000).monotonic);
    assert_eq!(renewed.remaining_at(expired_mono), None);
    assert!(!check_managed_runtime_lease(&fixture.path, &renewed, expired_mono).unwrap());
    assert_eq!(fixture.phase(), "terminal");
    assert!(
        matches!(
            reserve_managed_runtime_lease(&fixture.path, &fixture.binding, fixture.at(30_000))
                .unwrap(),
            RuntimeLeaseReservationOutcome::Readback(_)
        ),
        "continued original work never permits fresh dispatch/replay"
    );
}
