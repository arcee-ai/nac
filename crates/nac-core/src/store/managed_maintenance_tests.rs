use super::*;
use std::sync::{Arc, Barrier};

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
        "DROP TABLE managed_control_attempts;
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
fn accepted_release_fences_old_process_and_same_schema_restart() {
    let path = path("accepted-release-fence");
    initialize(&path).unwrap();
    let binding = binding("operation-fence", 'n');
    prepare_managed_upgrade(
        &path,
        "jti-fence",
        &binding,
        ManagedControlAttemptAction::Prepare,
        expires_at(),
        Vec::new(),
    )
    .unwrap();
    let accepted = accepted_identity(&binding);
    let preflight = preflight_managed_forward_start(
        &path,
        &accepted.target,
        Some((
            accepted.managed_host_id.as_str(),
            accepted.host_incarnation_id.as_str(),
        )),
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
            preflight_managed_forward_start(&path, &accepted.target, configured),
            Err(ManagedMaintenanceError::MaintenanceConflict)
        ));
    }
    assert!(accept_managed_forward_start(&path, &accepted).unwrap());

    let mut old = accepted.clone();
    old.operation_id.clear();
    old.target.source_sha = "0".repeat(40);
    assert!(try_admit_managed_work_for_identity(&path, &old).is_err());
    assert!(matches!(
        preflight_managed_forward_start(
            &path,
            &old.target,
            Some((
                old.managed_host_id.as_str(),
                old.host_incarnation_id.as_str()
            )),
        ),
        Err(ManagedMaintenanceError::MaintenanceConflict)
    ));
    drop(try_admit_managed_work_for_identity(&path, &accepted).unwrap());
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
