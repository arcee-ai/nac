use super::*;
use std::sync::{Arc, Barrier};

#[derive(Debug, PartialEq, Eq)]
struct SqliteFileSnapshot {
    bytes: Option<Vec<u8>>,
    sha256: Option<[u8; 32]>,
    created: Option<std::time::SystemTime>,
    modified: Option<std::time::SystemTime>,
}

fn sqlite_sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut sidecar = path.as_os_str().to_os_string();
    sidecar.push(suffix);
    PathBuf::from(sidecar)
}

fn snapshot_sqlite_file(path: &Path) -> SqliteFileSnapshot {
    use sha2::{Digest, Sha256};

    match std::fs::read(path) {
        Ok(bytes) => {
            let metadata = std::fs::metadata(path).unwrap();
            SqliteFileSnapshot {
                sha256: Some(Sha256::digest(&bytes).into()),
                bytes: Some(bytes),
                created: metadata.created().ok(),
                modified: Some(metadata.modified().unwrap()),
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => SqliteFileSnapshot {
            bytes: None,
            sha256: None,
            created: None,
            modified: None,
        },
        Err(error) => panic!("failed to snapshot {}: {error}", path.display()),
    }
}

fn snapshot_sqlite_files(path: &Path) -> [SqliteFileSnapshot; 3] {
    [
        snapshot_sqlite_file(path),
        snapshot_sqlite_file(&sqlite_sidecar(path, "-wal")),
        snapshot_sqlite_file(&sqlite_sidecar(path, "-shm")),
    ]
}

fn path(label: &str) -> PathBuf {
    std::env::temp_dir()
        .join(format!(
            "nac-managed-maintenance-{label}-{}",
            uuid::Uuid::new_v4()
        ))
        .join("store.db")
}

fn target(source: char) -> ManagedUpgradeTarget {
    ManagedUpgradeTarget {
        release_id: format!("beta-{source}"),
        source_sha: source.to_string().repeat(40),
        product_version: "0.2.0-beta.1".to_string(),
        schema_version: schema_version(),
        minimum_schema_version: 0,
    }
}

fn binding(operation: &str, source: char) -> ManagedOperationBinding {
    ManagedOperationBinding {
        managed_host_id: "host-123".to_string(),
        host_incarnation_id: "incarnation-456".to_string(),
        issuer: "https://controller.example.test".to_string(),
        audience: "urn:nac:managed-control:host-123:incarnation-456".to_string(),
        authority_origin: "https://controller.example.test".to_string(),
        operation_id: operation.to_string(),
        target: target(source),
        actor: "user:owner".to_string(),
        beneficiary: "tenant:host-owner".to_string(),
    }
}

fn accepted_identity(binding: &ManagedOperationBinding) -> ManagedAcceptedIdentity {
    ManagedAcceptedIdentity {
        managed_host_id: binding.managed_host_id.clone(),
        host_incarnation_id: binding.host_incarnation_id.clone(),
        operation_id: binding.operation_id.clone(),
        target: binding.target.clone(),
    }
}

fn supersession(
    previous: &ManagedOperationBinding,
    operation: ManagedOperationBinding,
) -> ManagedUpgradeSupersession {
    ManagedUpgradeSupersession {
        previous_operation_id: previous.operation_id.clone(),
        previous_target: previous.target.clone(),
        operation,
    }
}

fn expires_at() -> i64 {
    current_epoch_seconds().unwrap() + 60
}

fn cleanup(path: &Path) {
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn schema_24_fixture_migrates_without_losing_existing_rows() {
    let path = path("migration");
    initialize(&path).unwrap();
    insert_test_session(&path, "existing");
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(
        "DROP TABLE terminal_remote_cleanups;
         DROP TABLE managed_control_attempts;
         DROP TABLE managed_control_operations;
         DROP TABLE managed_host_maintenance;
         PRAGMA user_version = 24;",
    )
    .unwrap();
    drop(conn);

    initialize(&path).unwrap();
    assert!(crate::sessions::session_exists(&path, "existing").unwrap());
    assert_eq!(
        managed_maintenance_snapshot(&path).unwrap().state,
        ManagedMaintenanceState::Serving
    );
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        schema_version()
    );
    cleanup(&path);
}

#[test]
fn blockers_leave_admission_open_and_retry_can_prepare() {
    let path = path("blocked-retry");
    initialize(&path).unwrap();
    insert_test_session(&path, "root");
    let conn = Connection::open(&path).unwrap();
    conn.execute(
        "INSERT INTO threads (name, session_id, created_at, updated_at)
         VALUES ('main', 'root', 'created', 'created')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO thread_events (id, session_id, thread_name, event_json, created_at)
         VALUES (1, 'root', 'main', '{}', 'created')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO session_run_recovery
             (session_id, run_id, submitted_message_id, status)
         VALUES ('root', 'run-1', 1, 'active')",
        [],
    )
    .unwrap();
    drop(conn);

    let binding = binding("operation-1", 'a');
    let blocked = prepare_managed_upgrade(
        &path,
        "jti-1",
        &binding,
        ManagedControlAttemptAction::Prepare,
        expires_at(),
        Vec::new(),
    )
    .unwrap();
    let ManagedPrepareOutcome::Blocked { blockers } = blocked else {
        panic!("active run must block preparation");
    };
    assert!(blockers
        .iter()
        .any(|blocker| { blocker.kind == ManagedBlockerKind::ActiveRun && blocker.id == "run-1" }));
    assert_eq!(
        managed_maintenance_snapshot(&path).unwrap().state,
        ManagedMaintenanceState::Serving
    );

    let conn = Connection::open(&path).unwrap();
    conn.execute("DELETE FROM session_run_recovery", [])
        .unwrap();
    drop(conn);
    let prepared = prepare_managed_upgrade(
        &path,
        "jti-2",
        &binding,
        ManagedControlAttemptAction::Retry,
        expires_at(),
        Vec::new(),
    )
    .unwrap();
    assert!(matches!(prepared, ManagedPrepareOutcome::SafeToStop { .. }));
    assert_eq!(
        managed_maintenance_snapshot(&path).unwrap().state,
        ManagedMaintenanceState::Maintenance
    );
    assert!(managed_maintenance_snapshot(&path)
        .unwrap()
        .blockers
        .iter()
        .any(|blocker| blocker.kind == ManagedBlockerKind::MaintenanceOperation));
    cleanup(&path);
}

#[test]
fn lost_response_retry_is_exact_across_restart() {
    let path = path("lost-response");
    initialize(&path).unwrap();
    let binding = binding("operation-2", 'b');
    let first = prepare_managed_upgrade(
        &path,
        "jti-same",
        &binding,
        ManagedControlAttemptAction::Prepare,
        expires_at(),
        Vec::new(),
    )
    .unwrap();
    drop(Connection::open(&path).unwrap());
    let replay = prepare_managed_upgrade(
        &path,
        "jti-same",
        &binding,
        ManagedControlAttemptAction::Prepare,
        expires_at(),
        vec![ManagedUpgradeBlocker {
            kind: ManagedBlockerKind::TerminalProcess,
            id: "must-not-reprocess".to_string(),
            session_id: None,
            detail: "would change the response".to_string(),
        }],
    )
    .unwrap();
    assert_eq!(first, replay);
    cleanup(&path);
}

#[test]
fn jti_and_operation_bindings_fail_closed() {
    let path = path("binding");
    initialize(&path).unwrap();
    let first = binding("operation-3", 'c');
    let _ = record_managed_status(&path, "jti-conflict", &first, expires_at(), Vec::new()).unwrap();
    assert!(matches!(
        record_managed_status(
            &path,
            "jti-conflict",
            &binding("operation-4", 'd'),
            expires_at(),
            Vec::new()
        ),
        Err(ManagedMaintenanceError::ReplayConflict)
    ));
    assert!(matches!(
        record_managed_status(
            &path,
            "new-jti",
            &binding("operation-3", 'd'),
            expires_at(),
            Vec::new()
        ),
        Err(ManagedMaintenanceError::OperationBindingConflict)
    ));
    assert!(matches!(
        prepare_managed_upgrade(
            &path,
            "jti-conflict",
            &first,
            ManagedControlAttemptAction::Prepare,
            expires_at(),
            Vec::new()
        ),
        Err(ManagedMaintenanceError::ReplayConflict)
    ));
    let mut new_incarnation = first.clone();
    new_incarnation.host_incarnation_id = "incarnation-new".to_string();
    assert!(matches!(
        record_managed_status(
            &path,
            "new-incarnation-jti",
            &new_incarnation,
            expires_at(),
            Vec::new()
        ),
        Err(ManagedMaintenanceError::OperationBindingConflict)
    ));
    let mut rotated_authority = first;
    rotated_authority.issuer = "https://replacement-controller.example.test".to_string();
    rotated_authority.authority_origin = rotated_authority.issuer.clone();
    assert!(matches!(
        record_managed_status(
            &path,
            "rotated-authority-jti",
            &rotated_authority,
            expires_at(),
            Vec::new(),
        ),
        Err(ManagedMaintenanceError::OperationBindingConflict)
    ));
    cleanup(&path);
}

#[test]
fn completed_attempts_expire_but_operation_binding_remains_reserved() {
    let path = path("attempt-retention");
    initialize(&path).unwrap();
    let first = binding("operation-retained", 'r');
    record_managed_status(&path, "expired-jti", &first, expires_at(), Vec::new()).unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.execute(
        "UPDATE managed_control_attempts SET expires_at = 0 WHERE jti = 'expired-jti'",
        [],
    )
    .unwrap();
    drop(conn);

    record_managed_status(&path, "fresh-jti", &first, expires_at(), Vec::new()).unwrap();
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM managed_control_attempts WHERE jti = 'expired-jti'",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    let mut rebound = first;
    rebound.target.source_sha = "0".repeat(40);
    assert!(matches!(
        record_managed_status(&path, "rebind-jti", &rebound, expires_at(), Vec::new()),
        Err(ManagedMaintenanceError::OperationBindingConflict)
    ));
    cleanup(&path);
}

#[test]
fn retained_operation_capacity_is_explicitly_bounded_and_fail_closed() {
    assert!(operation_capacity_available(MAX_CONTROL_OPERATIONS - 1));
    assert!(!operation_capacity_available(MAX_CONTROL_OPERATIONS));
    assert!(!operation_capacity_available(MAX_CONTROL_OPERATIONS + 1));
    assert!(attempt_capacity_available(MAX_CONTROL_ATTEMPTS - 1));
    assert!(!attempt_capacity_available(MAX_CONTROL_ATTEMPTS));
    assert!(!attempt_capacity_available(MAX_CONTROL_ATTEMPTS + 1));
}

#[test]
fn control_attempt_lock_files_are_bounded_to_fixed_stripes() {
    let path = path("bounded-attempt-locks");
    initialize(&path).unwrap();
    let binding = binding("bounded-lock-operation", 'l');
    for index in 0..256 {
        record_managed_status(
            &path,
            &format!("fresh-jti-{index}"),
            &binding,
            expires_at(),
            Vec::new(),
        )
        .unwrap();
    }
    let lock_root = path.with_file_name("store.db.run-locks");
    let encoded_prefix = "managed-control-attempt"
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let attempt_locks = std::fs::read_dir(lock_root)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(&encoded_prefix)
        })
        .count();
    assert!(attempt_locks <= usize::from(CONTROL_ATTEMPT_LOCK_STRIPES));
    cleanup(&path);
}

#[test]
fn concurrent_same_jti_returns_one_deterministic_result() {
    let path = path("concurrent");
    initialize(&path).unwrap();
    let barrier = Arc::new(Barrier::new(3));
    let binding = Arc::new(binding("operation-5", 'e'));
    let mut workers = Vec::new();
    for _ in 0..2 {
        let barrier = Arc::clone(&barrier);
        let binding = Arc::clone(&binding);
        let path = path.clone();
        workers.push(std::thread::spawn(move || {
            barrier.wait();
            prepare_managed_upgrade(
                &path,
                "same-jti",
                &binding,
                ManagedControlAttemptAction::Prepare,
                expires_at(),
                Vec::new(),
            )
        }));
    }
    barrier.wait();
    let first = workers.remove(0).join().unwrap().unwrap();
    let second = workers.remove(0).join().unwrap().unwrap();
    assert_eq!(first, second);
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM managed_control_attempts WHERE jti = 'same-jti'",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    cleanup(&path);
}

#[test]
fn maintenance_survives_restart_and_only_exact_forward_start_clears_it() {
    let path = path("forward-start");
    initialize(&path).unwrap();
    let binding = binding("operation-6", 'f');
    let _ = prepare_managed_upgrade(
        &path,
        "jti-prepare",
        &binding,
        ManagedControlAttemptAction::Prepare,
        expires_at(),
        Vec::new(),
    )
    .unwrap();

    let mut wrong = accepted_identity(&binding);
    wrong.target.source_sha = "0".repeat(40);
    assert!(!accept_managed_forward_start(&path, &wrong).unwrap());
    let mut wrong_operation = accepted_identity(&binding);
    wrong_operation.operation_id = "different-operation".to_string();
    assert!(matches!(
        accept_managed_forward_start(&path, &wrong_operation),
        Err(ManagedMaintenanceError::MaintenanceConflict)
    ));
    assert_eq!(
        managed_maintenance_snapshot(&path).unwrap().state,
        ManagedMaintenanceState::Maintenance
    );
    let accepted = accepted_identity(&binding);
    assert!(accept_managed_forward_start(&path, &accepted).unwrap());
    let snapshot = managed_maintenance_snapshot(&path).unwrap();
    assert_eq!(snapshot.state, ManagedMaintenanceState::Serving);
    assert_eq!(snapshot.accepted_identity, Some(accepted));
    cleanup(&path);
}

#[test]
fn accepted_start_waits_for_maintenance_completion_admissions_to_drain() {
    let path = path("accepted-start-drain");
    initialize(&path).unwrap();
    let binding = binding("operation-drain", 'm');
    prepare_managed_upgrade(
        &path,
        "jti-drain",
        &binding,
        ManagedControlAttemptAction::Prepare,
        expires_at(),
        Vec::new(),
    )
    .unwrap();
    let accepted = accepted_identity(&binding);
    let completion = try_admit_managed_completion_for_identity(&path, &accepted).unwrap();
    let (finished, result) = std::sync::mpsc::channel();
    let accept_path = path.clone();
    let accept_identity = accepted.clone();
    let worker = std::thread::spawn(move || {
        let accepted = accept_managed_forward_start(&accept_path, &accept_identity);
        finished.send(accepted).unwrap();
    });
    assert!(result
        .recv_timeout(std::time::Duration::from_millis(50))
        .is_err());
    drop(completion);
    assert!(result
        .recv_timeout(std::time::Duration::from_secs(2))
        .unwrap()
        .unwrap());
    worker.join().unwrap();
    cleanup(&path);
}

#[test]
fn accepted_release_fences_old_process_and_same_schema_restart() {
    let path = path("accepted-release-fence");
    initialize(&path).unwrap();
    let accepted_binding = binding("operation-fence", 'n');
    prepare_managed_upgrade(
        &path,
        "jti-fence",
        &accepted_binding,
        ManagedControlAttemptAction::Prepare,
        expires_at(),
        Vec::new(),
    )
    .unwrap();
    let accepted = accepted_identity(&accepted_binding);
    let preflight = preflight_managed_forward_start(
        &path,
        &accepted.target,
        Some((
            accepted.managed_host_id.as_str(),
            accepted.host_incarnation_id.as_str(),
        )),
        None,
    )
    .unwrap();
    assert!(preflight.requires_accept);
    assert_eq!(preflight.accepted_identity.as_ref(), Some(&accepted));
    for configured in [
        None,
        Some(("wrong-host", accepted.host_incarnation_id.as_str())),
        Some((accepted.managed_host_id.as_str(), "wrong-incarnation")),
    ] {
        assert!(matches!(
            preflight_managed_forward_start(&path, &accepted.target, configured, None),
            Err(ManagedMaintenanceError::MaintenanceConflict)
        ));
    }
    assert!(accept_managed_forward_start(&path, &accepted).unwrap());

    let mut old = accepted.clone();
    old.operation_id.clear();
    old.target.source_sha = "0".repeat(40);
    assert!(try_admit_managed_work_for_identity(&path, &old).is_err());
    assert!(try_admit_managed_completion_for_identity(&path, &old).is_err());
    assert!(matches!(
        preflight_managed_forward_start(
            &path,
            &old.target,
            Some((
                old.managed_host_id.as_str(),
                old.host_incarnation_id.as_str()
            )),
            None,
        ),
        Err(ManagedMaintenanceError::MaintenanceConflict)
    ));
    drop(try_admit_managed_work_for_identity(&path, &accepted).unwrap());
    drop(try_admit_managed_completion_for_identity(&path, &accepted).unwrap());

    let next = binding("operation-after-fence", 'p');
    assert!(matches!(
        prepare_managed_upgrade_for_identity(
            &path,
            "stale-private-prepare",
            &next,
            ManagedControlAttemptAction::Prepare,
            expires_at(),
            Vec::new(),
            &old,
        ),
        Err(ManagedMaintenanceError::MaintenanceConflict)
    ));
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM managed_control_operations WHERE operation_id = ?1",
            [&next.operation_id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap(),
        0
    );
    cleanup(&path);
}

#[test]
fn attempt_capacity_is_enforced_after_age_pruning() {
    let path = path("attempt-capacity");
    initialize(&path).unwrap();
    let binding = binding("operation-capacity", 'q');
    record_managed_status(&path, "seed-jti", &binding, expires_at(), Vec::new()).unwrap();
    let binding_json = serde_json::to_string(&ManagedControlAttemptBinding {
        action: ManagedControlAttemptAction::Status,
        operation: &binding,
        previous_operation_id: None,
        previous_target: None,
    })
    .unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.execute(
        "WITH digits(value) AS (VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9))
         INSERT INTO managed_control_attempts
             (jti, operation_id, binding_json, outcome_json, expires_at, created_at)
         SELECT printf('capacity-%04d', a.value * 1000 + b.value * 100 + c.value * 10 + d.value),
                ?1, ?2, '{}', ?3, 'now'
         FROM digits a CROSS JOIN digits b CROSS JOIN digits c CROSS JOIN digits d
         WHERE a.value * 1000 + b.value * 100 + c.value * 10 + d.value < ?4 - 1",
        params![
            binding.operation_id,
            binding_json,
            expires_at(),
            MAX_CONTROL_ATTEMPTS
        ],
    )
    .unwrap();
    drop(conn);
    assert!(matches!(
        record_managed_status(&path, "over-capacity", &binding, expires_at(), Vec::new()),
        Err(ManagedMaintenanceError::AttemptCapacity)
    ));
    cleanup(&path);
}

#[test]
fn wrong_forward_binary_is_rejected_before_schema_migration() {
    let path = path("preflight-before-migration");
    initialize(&path).unwrap();
    let accepted = binding("operation-preflight", 'p');
    prepare_managed_upgrade(
        &path,
        "jti-preflight",
        &accepted,
        ManagedControlAttemptAction::Prepare,
        expires_at(),
        Vec::new(),
    )
    .unwrap();
    let conn = Connection::open(&path).unwrap();
    conn.pragma_update(None, "user_version", schema_version() - 1)
        .unwrap();
    drop(conn);

    let mut wrong = accepted.target.clone();
    wrong.release_id = "unaccepted-release".to_string();
    assert!(matches!(
        preflight_managed_forward_start(
            &path,
            &wrong,
            Some((
                accepted.managed_host_id.as_str(),
                accepted.host_incarnation_id.as_str(),
            )),
            None,
        ),
        Err(ManagedMaintenanceError::MaintenanceConflict)
    ));
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
            .unwrap(),
        schema_version() - 1
    );
    cleanup(&path);
}

#[test]
fn future_schema_preflight_preserves_main_wal_and_shm_exactly() {
    for with_sidecars in [false, true] {
        let path = path(&format!("future-schema-preflight-{with_sidecars}"));
        initialize(&path).unwrap();
        let connection = Connection::open(&path).unwrap();
        connection
            .pragma_update(
                None,
                "journal_mode",
                if with_sidecars { "WAL" } else { "DELETE" },
            )
            .unwrap();
        if with_sidecars {
            connection
                .pragma_update(None, "wal_autocheckpoint", 0)
                .unwrap();
            connection
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                .unwrap();
        }
        connection
            .pragma_update(None, "user_version", schema_version() + 1)
            .unwrap();
        let before = snapshot_sqlite_files(&path);

        assert!(matches!(
            preflight_managed_forward_start(
                &path,
                &target('f'),
                Some(("host-123", "incarnation-456")),
                None,
            ),
            Err(ManagedMaintenanceError::IncompatibleTarget)
        ));

        assert_eq!(
            snapshot_sqlite_files(&path),
            before,
            "managed preflight changed SQLite files with_sidecars={with_sidecars}"
        );
        drop(connection);
        cleanup(&path);
    }
}

#[test]
fn forward_only_schema_gate_runs_before_maintenance() {
    let path = path("schema-gate");
    initialize(&path).unwrap();
    let mut older = binding("operation-7", '7');
    older.target.schema_version = schema_version() - 1;
    assert!(matches!(
        prepare_managed_upgrade(
            &path,
            "jti-old",
            &older,
            ManagedControlAttemptAction::Prepare,
            expires_at(),
            Vec::new()
        ),
        Err(ManagedMaintenanceError::IncompatibleTarget)
    ));
    assert_eq!(
        managed_maintenance_snapshot(&path).unwrap().state,
        ManagedMaintenanceState::Serving
    );
    cleanup(&path);
}

#[test]
fn running_child_and_managed_orchestrator_are_distinct_blockers() {
    let path = path("topologies");
    initialize(&path).unwrap();
    for session in ["parent", "child", "orchestrator"] {
        insert_test_session(&path, session);
    }
    let conn = Connection::open(&path).unwrap();
    conn.execute(
        "INSERT INTO traditional_children
             (child_session_id, parent_session_id, root_session_id, profile, description,
              nesting_depth, status, generation, run_id, execution_mode, created_at, updated_at)
         VALUES ('child', 'parent', 'parent', 'general', 'child work', 1,
                 'running', 1, 'child-run', 'background', 'created', 'created')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO managed_orchestrators
             (orchestrator_session_id, parent_session_id, root_session_id, description,
              status, generation, run_id, execution_mode, created_at, updated_at)
         VALUES ('orchestrator', 'parent', 'parent', 'orchestrator work',
                 'running', 1, 'orchestrator-run', 'background', 'created', 'created')",
        [],
    )
    .unwrap();
    drop(conn);

    let ManagedPrepareOutcome::Blocked { blockers } = prepare_managed_upgrade(
        &path,
        "jti-topologies",
        &binding("operation-8", '8'),
        ManagedControlAttemptAction::Prepare,
        expires_at(),
        Vec::new(),
    )
    .unwrap() else {
        panic!("running relationships must block");
    };
    assert!(blockers
        .iter()
        .any(|blocker| blocker.kind == ManagedBlockerKind::TraditionalChild));
    assert!(blockers
        .iter()
        .any(|blocker| blocker.kind == ManagedBlockerKind::ManagedOrchestrator));
    cleanup(&path);
}

#[test]
fn live_supersession_is_durable_replay_safe_and_fences_the_failed_target() {
    let path = path("live-supersession");
    initialize(&path).unwrap();
    insert_test_session(&path, "retained-session");

    let mut serving = binding("operation-serving", 'a');
    serving.target.product_version = "0.2.0".to_string();
    prepare_managed_upgrade(
        &path,
        "jti-serving",
        &serving,
        ManagedControlAttemptAction::Prepare,
        expires_at(),
        Vec::new(),
    )
    .unwrap();
    let serving_identity = accepted_identity(&serving);
    assert!(accept_managed_forward_start(&path, &serving_identity).unwrap());

    let mut failed = binding("operation-failed-a", 'b');
    failed.target.product_version = "0.3.0+attempt.1".to_string();
    prepare_managed_upgrade_for_identity(
        &path,
        "jti-failed-a",
        &failed,
        ManagedControlAttemptAction::Prepare,
        expires_at(),
        Vec::new(),
        &serving_identity,
    )
    .unwrap();

    let mut corrected = binding("operation-corrected-b", 'c');
    corrected.target.product_version = "0.3.1+recovery.2".to_string();
    let request = supersession(&failed, corrected.clone());
    assert!(matches!(
        preflight_managed_forward_start(
            &path,
            &corrected.target,
            Some(("host-123", "incarnation-456")),
            None,
        ),
        Err(ManagedMaintenanceError::MaintenanceConflict)
    ));

    let first = supersede_managed_upgrade_for_identity(
        &path,
        "jti-supersede",
        &request,
        expires_at(),
        &serving_identity,
    )
    .unwrap();
    drop(Connection::open(&path).unwrap());
    let replay = supersede_managed_upgrade_for_identity(
        &path,
        "jti-supersede",
        &request,
        expires_at(),
        &serving_identity,
    )
    .unwrap();
    assert_eq!(first, replay);
    assert!(crate::sessions::session_exists(&path, "retained-session").unwrap());

    let snapshot = managed_maintenance_snapshot(&path).unwrap();
    assert_eq!(snapshot.state, ManagedMaintenanceState::Maintenance);
    assert_eq!(
        snapshot.operation_id.as_deref(),
        Some("operation-corrected-b")
    );
    assert_eq!(snapshot.target.as_ref(), Some(&corrected.target));
    assert!(try_admit_managed_work_for_identity(&path, &serving_identity).is_err());
    assert!(matches!(
        preflight_managed_forward_start(
            &path,
            &failed.target,
            Some(("host-123", "incarnation-456")),
            None,
        ),
        Err(ManagedMaintenanceError::MaintenanceConflict)
    ));

    let preflight = preflight_managed_forward_start(
        &path,
        &corrected.target,
        Some(("host-123", "incarnation-456")),
        None,
    )
    .unwrap();
    let corrected_identity = preflight.accepted_identity.unwrap();
    assert!(preflight.requires_accept);
    assert!(accept_managed_forward_start(&path, &corrected_identity).unwrap());
    assert!(try_admit_managed_work_for_identity(&path, &serving_identity).is_err());

    let conn = Connection::open(&path).unwrap();
    let old_outcome: String = conn
        .query_row(
            "SELECT latest_outcome_json FROM managed_control_operations WHERE operation_id = ?1",
            [&failed.operation_id],
            |row| row.get(0),
        )
        .unwrap();
    assert!(old_outcome.contains("superseded"));
    assert_eq!(
        conn.query_row(
            "SELECT COUNT(*) FROM managed_control_operations WHERE operation_id IN (?1, ?2)",
            params![failed.operation_id, corrected.operation_id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap(),
        2
    );
    cleanup(&path);
}

#[test]
fn supersession_rejects_wrong_prior_and_forward_downgrades_without_leaving_maintenance() {
    let path = path("supersession-downgrades");
    initialize(&path).unwrap();
    let mut prior = binding("operation-prior", 'd');
    prior.target.product_version = "2.4.0+failed.1".to_string();
    prepare_managed_upgrade(
        &path,
        "jti-prior",
        &prior,
        ManagedControlAttemptAction::Prepare,
        expires_at(),
        Vec::new(),
    )
    .unwrap();

    let mut next = binding("operation-next", 'e');
    next.target.product_version = "2.3.9".to_string();
    let mut request = supersession(&prior, next);
    let expected = ManagedAcceptedIdentity {
        managed_host_id: prior.managed_host_id.clone(),
        host_incarnation_id: prior.host_incarnation_id.clone(),
        operation_id: String::new(),
        target: target('z'),
    };

    // Startup recovery exercises the same monotonic transition without requiring
    // a live process identity from an earlier accepted release.
    assert!(matches!(
        preflight_managed_forward_start(
            &path,
            &request.operation.target,
            Some(("host-123", "incarnation-456")),
            Some(&request),
        ),
        Err(ManagedMaintenanceError::IncompatibleTarget)
    ));
    request.operation.target.product_version = "2.4.1".to_string();
    request.operation.target.schema_version = prior.target.schema_version - 1;
    assert!(matches!(
        preflight_managed_forward_start(
            &path,
            &request.operation.target,
            Some(("host-123", "incarnation-456")),
            Some(&request),
        ),
        Err(ManagedMaintenanceError::IncompatibleTarget)
    ));
    request.operation.target.schema_version = prior.target.schema_version;
    request.previous_target.source_sha = "f".repeat(40);
    assert!(matches!(
        preflight_managed_forward_start(
            &path,
            &request.operation.target,
            Some(("host-123", "incarnation-456")),
            Some(&request),
        ),
        Err(ManagedMaintenanceError::OperationBindingConflict)
    ));
    let snapshot = managed_maintenance_snapshot(&path).unwrap();
    assert_eq!(snapshot.state, ManagedMaintenanceState::Maintenance);
    assert_eq!(
        snapshot.operation_id.as_deref(),
        Some(prior.operation_id.as_str())
    );
    assert!(try_admit_managed_work_for_identity(&path, &expected).is_err());
    cleanup(&path);
}

#[test]
fn concurrent_supersessions_from_one_prior_have_one_winner() {
    let path = path("concurrent-supersession");
    initialize(&path).unwrap();
    let prior = binding("operation-race-a", 'g');
    prepare_managed_upgrade(
        &path,
        "jti-race-a",
        &prior,
        ManagedControlAttemptAction::Prepare,
        expires_at(),
        Vec::new(),
    )
    .unwrap();
    let mut next_b = binding("operation-race-b", 'h');
    next_b.target.product_version = "0.2.1".to_string();
    let mut next_c = binding("operation-race-c", 'i');
    next_c.target.product_version = "0.2.2".to_string();
    let requests = [supersession(&prior, next_b), supersession(&prior, next_c)];
    let barrier = Arc::new(Barrier::new(3));
    let mut workers = Vec::new();
    for request in requests {
        let path = path.clone();
        let barrier = Arc::clone(&barrier);
        workers.push(std::thread::spawn(move || {
            barrier.wait();
            preflight_managed_forward_start(
                &path,
                &request.operation.target,
                Some(("host-123", "incarnation-456")),
                Some(&request),
            )
        }));
    }
    barrier.wait();
    let outcomes = workers
        .into_iter()
        .map(|worker| worker.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(outcomes.iter().filter(|outcome| outcome.is_ok()).count(), 1);
    assert_eq!(
        outcomes
            .iter()
            .filter(|outcome| matches!(outcome, Err(ManagedMaintenanceError::MaintenanceConflict)))
            .count(),
        1
    );
    assert_eq!(
        managed_maintenance_snapshot(&path).unwrap().state,
        ManagedMaintenanceState::Maintenance
    );
    cleanup(&path);
}

#[test]
fn startup_supersession_recovers_both_suspended_serving_and_failed_maintenance() {
    for failed_in_maintenance in [false, true] {
        let path = path(&format!("startup-supersession-{failed_in_maintenance}"));
        initialize(&path).unwrap();
        let mut serving = binding("operation-startup-a", 'j');
        serving.target.product_version = "1.0.0".to_string();
        prepare_managed_upgrade(
            &path,
            "jti-startup-a",
            &serving,
            ManagedControlAttemptAction::Prepare,
            expires_at(),
            Vec::new(),
        )
        .unwrap();
        let serving_identity = accepted_identity(&serving);
        assert!(accept_managed_forward_start(&path, &serving_identity).unwrap());

        let previous = if failed_in_maintenance {
            let mut failed = binding("operation-startup-failed", 'k');
            failed.target.product_version = "1.1.0".to_string();
            prepare_managed_upgrade_for_identity(
                &path,
                "jti-startup-failed",
                &failed,
                ManagedControlAttemptAction::Prepare,
                expires_at(),
                Vec::new(),
                &serving_identity,
            )
            .unwrap();
            failed
        } else {
            serving
        };
        let mut corrected = binding("operation-startup-b", 'l');
        corrected.target.product_version = "1.2.0+recovery.1".to_string();
        let request = supersession(&previous, corrected.clone());

        assert!(matches!(
            preflight_managed_forward_start(
                &path,
                &corrected.target,
                Some(("host-123", "incarnation-456")),
                None,
            ),
            Err(ManagedMaintenanceError::MaintenanceConflict)
        ));
        let first = preflight_managed_forward_start(
            &path,
            &corrected.target,
            Some(("host-123", "incarnation-456")),
            Some(&request),
        )
        .unwrap();
        assert!(first.requires_accept);
        let corrected_identity = first.accepted_identity.unwrap();
        let replay = preflight_managed_forward_start(
            &path,
            &corrected.target,
            Some(("host-123", "incarnation-456")),
            Some(&request),
        )
        .unwrap();
        assert_eq!(replay.accepted_identity.as_ref(), Some(&corrected_identity));
        assert!(replay.requires_accept);
        assert!(accept_managed_forward_start(&path, &corrected_identity).unwrap());
        assert!(try_admit_managed_work_for_identity(&path, &serving_identity).is_err());
        cleanup(&path);
    }
}
