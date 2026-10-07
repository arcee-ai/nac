use super::*;
use std::sync::{Arc, Barrier};

fn fixture() -> PathBuf {
    let path = std::env::temp_dir()
        .join(format!("nac-runtime-journal-{}", Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    path
}

fn identity() -> ManagedRuntimeOperationIdentity {
    ManagedRuntimeOperationIdentity {
        operation_id: Uuid::new_v4(),
        full_input_sha256: [7; 32],
    }
}

fn remove_fixture(path: &Path) {
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn exact_retry_and_reopen_are_observational_and_changed_input_conflicts() {
    let path = fixture();
    let operation = identity();
    assert!(read_managed_runtime_operation(&path, &operation)
        .unwrap()
        .is_none());
    assert_eq!(
        record_managed_runtime_operation(&path, &operation).unwrap(),
        ManagedRuntimeRecordOutcome::NewlyRecorded
    );
    let snapshot = ManagedRuntimeOperationSnapshot {
        identity: operation.clone(),
        observation: None,
    };
    assert_eq!(
        record_managed_runtime_operation(&path, &operation).unwrap(),
        ManagedRuntimeRecordOutcome::AlreadyRecorded(snapshot.clone())
    );
    assert_eq!(
        read_managed_runtime_operation(&path, &operation).unwrap(),
        Some(snapshot)
    );
    let mut changed = operation.clone();
    changed.full_input_sha256[0] ^= 1;
    assert!(matches!(
        record_managed_runtime_operation(&path, &changed),
        Err(ManagedRuntimeJournalError::BindingConflict)
    ));
    assert!(read_managed_runtime_operation(&path, &changed).is_err());
    assert!(acknowledge_managed_runtime_operation(
        &path,
        &changed,
        &ManagedRuntimeObservation::NotAdmitted
    )
    .is_err());
    remove_fixture(&path);
}

#[test]
fn lost_commit_response_retains_uncertainty_and_cannot_reopen_dispatch() {
    let path = fixture();
    let operation = identity();
    let mut connection = open_runtime_connection(&path).unwrap();
    assert!(
        record_with_connection(&mut connection, &operation, || Err(anyhow!(
            "fixture lost response after commit"
        )))
        .is_err()
    );
    drop(connection);
    let snapshot = read_managed_runtime_operation(&path, &operation)
        .unwrap()
        .unwrap();
    assert_eq!(snapshot.observation, None);
    assert_eq!(
        record_managed_runtime_operation(&path, &operation).unwrap(),
        ManagedRuntimeRecordOutcome::AlreadyRecorded(snapshot)
    );
    remove_fixture(&path);
}

#[test]
fn concurrent_connections_record_only_one_first_admission() {
    let path = fixture();
    let operation = identity();
    let start = Arc::new(Barrier::new(8));
    let workers = (0..8)
        .map(|_| {
            let path = path.clone();
            let operation = operation.clone();
            let start = Arc::clone(&start);
            std::thread::spawn(move || {
                start.wait();
                record_managed_runtime_operation(&path, &operation).unwrap()
            })
        })
        .collect::<Vec<_>>();
    let results = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, ManagedRuntimeRecordOutcome::NewlyRecorded))
            .count(),
        1
    );
    remove_fixture(&path);
}

#[test]
fn native_acknowledgment_is_immutable_and_does_not_reopen_dispatch() {
    let path = fixture();
    for observation in [
        ManagedRuntimeObservation::NotAdmitted,
        ManagedRuntimeObservation::Session {
            session_id: Uuid::new_v4(),
        },
        ManagedRuntimeObservation::Run {
            session_id: Uuid::new_v4(),
            run_id: Uuid::new_v4(),
        },
    ] {
        let operation = identity();
        assert!(acknowledge_managed_runtime_operation(&path, &operation, &observation).is_err());
        record_managed_runtime_operation(&path, &operation).unwrap();
        let snapshot =
            acknowledge_managed_runtime_operation(&path, &operation, &observation).unwrap();
        assert_eq!(snapshot.observation, Some(observation.clone()));
        assert_eq!(
            acknowledge_managed_runtime_operation(&path, &operation, &observation).unwrap(),
            snapshot
        );
        assert_eq!(
            record_managed_runtime_operation(&path, &operation).unwrap(),
            ManagedRuntimeRecordOutcome::AlreadyRecorded(snapshot)
        );
        let changed = ManagedRuntimeObservation::Run {
            session_id: Uuid::new_v4(),
            run_id: Uuid::new_v4(),
        };
        assert!(acknowledge_managed_runtime_operation(&path, &operation, &changed).is_err());
    }
    remove_fixture(&path);
}

#[test]
fn database_guards_preserve_identity_and_history_after_session_deletion() {
    let path = fixture();
    let operation = identity();
    record_managed_runtime_operation(&path, &operation).unwrap();
    let connection = open_runtime_connection(&path).unwrap();
    for sql in [
        "DELETE FROM managed_runtime_operations",
        "UPDATE managed_runtime_operations SET operation_id = 'replacement'",
        "UPDATE managed_runtime_operations SET full_input_sha256 = printf('%064d', 0)",
        "UPDATE managed_runtime_operations SET recorded_at = 'replacement'",
        "UPDATE managed_runtime_operations SET session_id = 'unexpected'",
        "UPDATE managed_runtime_operations SET observation_kind = 'run'",
    ] {
        assert!(connection.execute(sql, []).is_err(), "guard accepted {sql}");
    }
    drop(connection);
    let session_id = Uuid::new_v4();
    super::super::insert_test_session(&path, &session_id.to_string());
    let observation = ManagedRuntimeObservation::Session { session_id };
    acknowledge_managed_runtime_operation(&path, &operation, &observation).unwrap();
    let connection = open_runtime_connection(&path).unwrap();
    connection
        .execute(
            "DELETE FROM sessions WHERE session_id = ?1",
            [session_id.to_string()],
        )
        .unwrap();
    assert!(connection
        .execute(
            "UPDATE managed_runtime_operations SET observation_kind = NULL, session_id = NULL",
            []
        )
        .is_err());
    drop(connection);
    assert_eq!(
        read_managed_runtime_operation(&path, &operation)
            .unwrap()
            .unwrap()
            .observation,
        Some(observation)
    );
    remove_fixture(&path);
}

#[test]
fn v32_forward_migration_preserves_existing_sessions_and_adds_empty_journal() {
    let path = fixture();
    super::super::insert_test_session(&path, "retained-session");
    let connection = Connection::open(&path).unwrap();
    let before: String = connection
        .query_row(
            "SELECT messages_json FROM sessions WHERE session_id = 'retained-session'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    connection
        .execute_batch(
            "DROP TRIGGER managed_runtime_operations_no_delete;
        DROP TRIGGER managed_runtime_operations_immutable;
        DROP TABLE managed_runtime_operations;
        PRAGMA user_version = 32;",
        )
        .unwrap();
    drop(connection);
    initialize(&path).unwrap();
    initialize(&path).unwrap();
    let connection = Connection::open(&path).unwrap();
    let after: String = connection
        .query_row(
            "SELECT messages_json FROM sessions WHERE session_id = 'retained-session'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(before, after);
    assert_eq!(
        connection
            .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        schema::schema_version()
    );
    assert_eq!(
        connection
            .query_row::<i64, _, _>(
                "SELECT COUNT(*) FROM managed_runtime_operations",
                [],
                |row| row.get(0)
            )
            .unwrap(),
        0
    );
    drop(connection);
    remove_fixture(&path);
}

#[test]
fn readback_never_creates_a_missing_store() {
    let path = std::env::temp_dir()
        .join(format!("nac-runtime-missing-{}", Uuid::new_v4()))
        .join("store.db");
    assert!(read_managed_runtime_operation(&path, &identity()).is_err());
    assert!(!path.parent().unwrap().exists());
}

#[test]
fn managed_runtime_journal_process_helper() {
    let Some(path) = std::env::var_os("NAC_TEST_RUNTIME_JOURNAL_PATH") else {
        return;
    };
    let operation = ManagedRuntimeOperationIdentity {
        operation_id: Uuid::parse_str(
            &std::env::var("NAC_TEST_RUNTIME_JOURNAL_OPERATION").unwrap(),
        )
        .unwrap(),
        full_input_sha256: [7; 32],
    };
    let result = record_managed_runtime_operation(Path::new(&path), &operation).unwrap();
    println!(
        "RUNTIME_JOURNAL_NEW={}",
        matches!(result, ManagedRuntimeRecordOutcome::NewlyRecorded)
    );
}

#[test]
fn separate_processes_and_process_restart_cannot_repeat_first_admission() {
    let path = fixture();
    let operation = identity();
    let spawn = || {
        std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "store::managed_runtime_admission::tests::managed_runtime_journal_process_helper",
                "--nocapture",
            ])
            .env("NAC_TEST_RUNTIME_JOURNAL_PATH", &path)
            .env(
                "NAC_TEST_RUNTIME_JOURNAL_OPERATION",
                operation.operation_id.to_string(),
            )
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap()
    };
    let children = (0..4).map(|_| spawn()).collect::<Vec<_>>();
    let results = children
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
        .collect::<Vec<_>>();
    assert_eq!(
        results
            .iter()
            .filter(|result| result.contains("RUNTIME_JOURNAL_NEW=true"))
            .count(),
        1
    );
    let restarted = spawn().wait_with_output().unwrap();
    assert!(restarted.status.success());
    assert!(String::from_utf8(restarted.stdout)
        .unwrap()
        .contains("RUNTIME_JOURNAL_NEW=false"));
    remove_fixture(&path);
}

#[tokio::test]
async fn serving_coordinator_lost_ack_keeps_a_committed_barrier() {
    struct GatedRecord {
        identity: ManagedRuntimeOperationIdentity,
        committed: std::sync::mpsc::SyncSender<()>,
        release: std::sync::mpsc::Receiver<()>,
    }
    impl super::super::coordinator::PersistenceCommand for GatedRecord {
        type Output = std::result::Result<ManagedRuntimeRecordOutcome, ManagedRuntimeJournalError>;
        fn correlation(&self) -> crate::telemetry::Correlation {
            crate::telemetry::Correlation::default()
        }
        fn outcome(output: &Self::Output) -> crate::telemetry::TelemetryOutcome {
            if output.is_ok() {
                crate::telemetry::TelemetryOutcome::Ok
            } else {
                crate::telemetry::TelemetryOutcome::Error
            }
        }
        fn error_identity(_output: &Self::Output) -> Option<crate::telemetry::StoreErrorIdentity> {
            None
        }
        fn execute(self, path: &Path) -> Result<Self::Output> {
            let mut connection = open_runtime_connection(path)?;
            Ok(record_with_connection(
                &mut connection,
                &self.identity,
                || {
                    self.committed.send(())?;
                    self.release.recv()?;
                    Ok(())
                },
            ))
        }
    }
    let path = fixture();
    let operation = identity();
    let owner = StoreCoordinator::acquire(&path).unwrap();
    let (committed_tx, committed_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    let pending = owner
        .submit(GatedRecord {
            identity: operation.clone(),
            committed: committed_tx,
            release: release_rx,
        })
        .unwrap();
    tokio::task::spawn_blocking(move || committed_rx.recv().unwrap())
        .await
        .unwrap();
    // Drop only after the real transaction committed; a queued cancellation
    // before execution would correctly leave no barrier and is a different case.
    drop(pending);
    release_tx.send(()).unwrap();
    let snapshot = owner
        .read_managed_runtime_operation(operation.clone())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(snapshot.observation, None);
    assert_eq!(
        owner
            .record_managed_runtime_operation(operation.clone())
            .await
            .unwrap(),
        ManagedRuntimeRecordOutcome::AlreadyRecorded(snapshot)
    );
    let observed = ManagedRuntimeObservation::Run {
        session_id: Uuid::new_v4(),
        run_id: Uuid::new_v4(),
    };
    assert_eq!(
        owner
            .acknowledge_managed_runtime_operation(operation.clone(), observed.clone())
            .await
            .unwrap()
            .observation,
        Some(observed)
    );
    assert_eq!(owner.stats().acknowledgements_lost, 1);
    owner.shutdown().await.unwrap();
    drop(owner);
    remove_fixture(&path);
}
