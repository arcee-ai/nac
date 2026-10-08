use std::collections::HashSet;
use std::sync::{Arc, Barrier, Condvar, Mutex};
use std::time::{Duration, Instant};

use crate::telemetry::*;

fn runtime() -> RuntimeMetadata {
    RuntimeMetadata::sqlite(
        "build-test",
        "revision-test",
        crate::store::schema_version(),
        Some("host-sensitive-identity"),
        Some("four-orchestrator"),
    )
}

fn telemetry_test_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::LazyLock<Mutex<()>> = std::sync::LazyLock::new(|| Mutex::new(()));
    LOCK.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn wait_for_events(exporter: &InMemoryExporter, count: usize) -> Vec<TelemetryEvent> {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let events = exporter.events();
        if events.len() >= count {
            return events;
        }
        assert!(
            Instant::now() < deadline,
            "telemetry exporter did not drain"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn in_memory_exporter_redacts_content_and_correlates_four_orchestrators() {
    let _lock = telemetry_test_lock();
    let exporter = Arc::new(InMemoryExporter::default());
    let recorder = TelemetryRecorder::bounded(exporter.clone(), runtime(), 4_096);
    let _guard = install_test_recorder(recorder.clone());
    let canaries = [
        "PROMPT-CANARY",
        "TRANSCRIPT-CANARY",
        "TOOL-RESULT-CANARY",
        "CREDENTIAL-CANARY",
        "REPOSITORY-CANARY",
        "SELECT secret FROM credentials WHERE value='SQL-CANARY'",
    ];
    let root =
        std::env::temp_dir().join(format!("nac_telemetry_redaction_{}", uuid::Uuid::new_v4()));
    let store_path = root.join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, canaries[0]);
    crate::store::append_thread_event(&store_path, canaries[0], "worker", canaries[2]).unwrap();
    crate::store::append_episode(&store_path, canaries[0], "worker", canaries[3], canaries[4])
        .unwrap();
    crate::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .append(
            canaries[0],
            0,
            &crate::types::Message::User {
                content: canaries[1].to_string(),
            },
        )
        .unwrap();
    let barrier = Arc::new(Barrier::new(5));
    std::thread::scope(|scope| {
        for generation in 1_u64..=4 {
            let barrier = Arc::clone(&barrier);
            scope.spawn(move || {
                let _test_thread = register_test_recorder_thread();
                let session = format!("session-{generation}-{}", canaries[0]);
                let run = format!("run-{generation}-{}", canaries[1]);
                let correlation = Correlation::session(Some(&session))
                    .with_run(Some(&run))
                    .with_generation(generation);
                barrier.wait();
                let _orchestrator =
                    RuntimeActivityGuard::start(RuntimeActivity::Orchestrator, correlation.clone());
                barrier.wait();
                emit_store_duration(
                    StoreOperation::ManagedMonitorPoll,
                    correlation.clone(),
                    Duration::from_millis(generation),
                    TelemetryOutcome::Ok,
                    None,
                );
                emit_http_duration(
                    "/readyz",
                    correlation.clone(),
                    Duration::from_millis(generation * 2),
                    TelemetryOutcome::Ok,
                );
                emit_resource_sample(correlation, None);
            });
        }
        barrier.wait();
        barrier.wait();
    });
    let deadline = Instant::now() + Duration::from_secs(2);
    while recorder.stats().exported < recorder.stats().accepted {
        assert!(
            Instant::now() < deadline,
            "telemetry exporter did not drain"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    let events = exporter.events();
    let generations = events
        .iter()
        .filter_map(|event| event.correlation.generation)
        .collect::<HashSet<_>>();
    assert_eq!(generations, HashSet::from([1, 2, 3, 4]));
    assert!(events.iter().any(|event| {
        event.activity == Some(RuntimeActivity::Orchestrator) && event.value == Some(4)
    }));
    let encoded = serde_json::to_string(&events).unwrap();
    for canary in canaries {
        assert!(!encoded.contains(canary), "telemetry leaked {canary}");
    }
    assert!(events.iter().all(|event| {
        event
            .correlation
            .session
            .as_deref()
            .is_none_or(|value| value.len() == 16)
            && event
                .correlation
                .run
                .as_deref()
                .is_none_or(|value| value.len() == 16)
    }));
    let operations = events
        .iter()
        .filter_map(|event| event.operation)
        .collect::<HashSet<_>>();
    assert!(operations.contains(&StoreOperation::TranscriptAppend));
    assert!(operations.contains(&StoreOperation::EventPersistence));
    assert!(operations.contains(&StoreOperation::WorkerEpisodeCommit));
    assert!(operations.contains(&StoreOperation::ConnectionAcquire));
    assert!(operations.contains(&StoreOperation::Transaction));
    assert!(operations.contains(&StoreOperation::Commit));
    let _ = std::fs::remove_dir_all(root);
}

struct StalledExporter {
    release: Arc<(Mutex<bool>, Condvar)>,
}

impl TelemetryExporter for StalledExporter {
    fn export(&self, _event: &TelemetryEvent) -> Result<(), TelemetryExportError> {
        let (released, ready) = &*self.release;
        let mut released = released
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        while !*released {
            released = ready
                .wait(released)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        Ok(())
    }
}

#[test]
fn stalled_exporter_drops_at_the_bound_without_stalling_producers() {
    let _lock = telemetry_test_lock();
    let release = Arc::new((Mutex::new(false), Condvar::new()));
    let recorder = TelemetryRecorder::bounded(
        Arc::new(StalledExporter {
            release: Arc::clone(&release),
        }),
        runtime(),
        4,
    );
    let _guard = install_test_recorder(recorder.clone());
    let started = Instant::now();
    for _ in 0..10_000 {
        emit_http_duration(
            "/healthz",
            Correlation::default(),
            Duration::from_micros(10),
            TelemetryOutcome::Ok,
        );
    }
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "stalled exporter affected the request path"
    );
    assert!(recorder.stats().dropped > 0);
    let (released, ready) = &*release;
    *released
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = true;
    ready.notify_all();
}

struct FailedExporter;

impl TelemetryExporter for FailedExporter {
    fn export(&self, _event: &TelemetryEvent) -> Result<(), TelemetryExportError> {
        Err(TelemetryExportError)
    }
}

#[test]
fn exporter_failure_is_fail_open_and_disabled_overhead_is_bounded() {
    let _lock = telemetry_test_lock();
    let failing = TelemetryRecorder::bounded(Arc::new(FailedExporter), runtime(), 16);
    {
        let _guard = install_test_recorder(failing.clone());
        emit_store_duration(
            StoreOperation::TranscriptAppend,
            Correlation::default(),
            Duration::from_micros(10),
            TelemetryOutcome::Ok,
            None,
        );
        let deadline = Instant::now() + Duration::from_secs(2);
        while failing.stats().failures == 0 {
            assert!(Instant::now() < deadline, "failed exporter did not run");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    let _guard = install_test_recorder(TelemetryRecorder::disabled());
    let started = Instant::now();
    for _ in 0..20_000 {
        observe_store(
            StoreOperation::EventPersistence,
            Correlation::default(),
            || Ok::<_, anyhow::Error>(()),
        )
        .unwrap();
    }
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "disabled telemetry exceeded the 100us/event overhead budget"
    );
}

#[test]
fn disabled_exporter_preserves_store_results() {
    let _lock = telemetry_test_lock();
    let exercise = |path: &std::path::Path| {
        crate::store::initialize(path).unwrap();
        crate::store::insert_test_session(path, "session-correctness");
        crate::store::append_episode(
            path,
            "session-correctness",
            "worker",
            "inspect",
            "durable result",
        )
        .unwrap();
        let episodes = crate::store::thread_read(path, "session-correctness", "worker").unwrap();
        (
            episodes.len(),
            episodes[0].thread_name.clone(),
            episodes[0].action.clone(),
            episodes[0].content.clone(),
            episodes[0].status.clone(),
        )
    };
    let root = std::env::temp_dir().join(format!(
        "nac_telemetry_correctness_{}",
        uuid::Uuid::new_v4()
    ));
    let disabled = {
        let _guard = install_test_recorder(TelemetryRecorder::disabled());
        exercise(&root.join("disabled.db"))
    };
    let enabled = {
        let recorder =
            TelemetryRecorder::bounded(Arc::new(InMemoryExporter::default()), runtime(), 64);
        let _guard = install_test_recorder(recorder);
        exercise(&root.join("enabled.db"))
    };
    assert_eq!(disabled, enabled);
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn metric_series_cardinality_excludes_correlations_and_raw_pids() {
    let _lock = telemetry_test_lock();
    let exporter = Arc::new(InMemoryExporter::default());
    let recorder = TelemetryRecorder::bounded(exporter.clone(), runtime(), 256);
    let _guard = install_test_recorder(recorder);
    for index in 0..64 {
        let correlation = Correlation::session(Some(&format!("session-{index}")))
            .with_run(Some(&format!("run-{index}")));
        emit_http_duration(
            "/sessions/{session_id}",
            correlation,
            Duration::from_millis(1),
            TelemetryOutcome::Ok,
        );
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    let events = loop {
        let events = exporter
            .events()
            .into_iter()
            .filter(|event| {
                event.name == TelemetryName::HttpRequestDuration
                    && event.route.as_deref() == Some("/sessions/{session_id}")
            })
            .collect::<Vec<_>>();
        if events.len() >= 64 {
            break events;
        }
        assert!(
            Instant::now() < deadline,
            "cardinality events did not drain"
        );
        std::thread::sleep(Duration::from_millis(5));
    };
    let series = events
        .iter()
        .map(TelemetryEvent::series_key)
        .collect::<HashSet<_>>();
    assert_eq!(series.len(), 1);
}

#[test]
fn sqlite_profile_classifies_only_fixed_statement_kinds() {
    let _lock = telemetry_test_lock();
    let exporter = Arc::new(InMemoryExporter::default());
    let recorder = TelemetryRecorder::bounded(exporter.clone(), runtime(), 16);
    let _guard = install_test_recorder(recorder);
    sqlite_profile("BEGIN IMMEDIATE", Duration::from_micros(1));
    sqlite_profile("COMMIT", Duration::from_micros(2));
    sqlite_profile("PRAGMA wal_checkpoint(PASSIVE)", Duration::from_micros(3));
    sqlite_profile(
        "INSERT INTO secrets VALUES ('SQL-PARAMETER-CANARY')",
        Duration::from_micros(4),
    );
    let events = wait_for_events(&exporter, 3);
    assert_eq!(events.len(), 3);
    assert_eq!(
        events
            .iter()
            .filter_map(|event| event.operation)
            .collect::<Vec<_>>(),
        vec![
            StoreOperation::TransactionBegin,
            StoreOperation::Commit,
            StoreOperation::Checkpoint
        ]
    );
    assert!(!serde_json::to_string(&events)
        .unwrap()
        .contains("SQL-PARAMETER-CANARY"));
}

#[test]
fn sqlite_primary_and_extended_error_identity_are_retained_without_message() {
    let error = rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(522), None);
    let identity = store_error_identity(&error).unwrap();
    assert_eq!(identity.engine, "sqlite");
    assert_eq!(identity.primary_code, 10);
    assert_eq!(identity.extended_code, 522);
    assert!(!serde_json::to_string(&identity)
        .unwrap()
        .contains("file truncated"));
}

struct TransactionTestDirectory(std::path::PathBuf);

impl TransactionTestDirectory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "nac_transaction_observation_{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TransactionTestDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn transaction_test_connection(path: &std::path::Path) -> crate::store::StoreConnection {
    crate::store::open_runtime_connection(path).unwrap()
}

struct OutstandingNativeStatement {
    database: *mut rusqlite::ffi::sqlite3,
    statement: *mut rusqlite::ffi::sqlite3_stmt,
    owns_database: bool,
}

impl OutstandingNativeStatement {
    fn new(connection: &rusqlite::Connection) -> Self {
        let mut statement = std::ptr::null_mut();
        // SAFETY: the live connection owns the database. This guard finalizes
        // its intentionally outstanding native statement before cleanup.
        let database = unsafe { connection.handle() };
        let code = unsafe {
            rusqlite::ffi::sqlite3_prepare_v2(
                database,
                c"SELECT 1".as_ptr(),
                -1,
                &mut statement,
                std::ptr::null_mut(),
            )
        };
        assert_eq!(code, rusqlite::ffi::SQLITE_OK);
        Self {
            database,
            statement,
            owns_database: false,
        }
    }
}

impl Drop for OutstandingNativeStatement {
    fn drop(&mut self) {
        // SAFETY: the statement prevents native close while outstanding. If
        // the Rust owner was dropped, this guard now owns the surviving handle.
        // Defensively clear callbacks before cleanup, including assertion failure.
        unsafe {
            if self.owns_database {
                rusqlite::ffi::sqlite3_trace_v2(self.database, 0, None, std::ptr::null_mut());
                rusqlite::ffi::sqlite3_rollback_hook(self.database, None, std::ptr::null_mut());
            }
            rusqlite::ffi::sqlite3_finalize(self.statement);
            if self.owns_database {
                rusqlite::ffi::sqlite3_close(self.database);
            }
        }
    }
}

#[test]
fn rejected_native_close_keeps_transaction_observation_open() {
    let _lock = telemetry_test_lock();
    let dir = TransactionTestDirectory::new();
    let path = dir.path().join("store.db");
    crate::store::initialize(&path).unwrap();
    let exporter = Arc::new(InMemoryExporter::default());
    let recorder = TelemetryRecorder::bounded(exporter.clone(), runtime(), 128);
    let _guard = install_test_recorder(recorder.clone());
    let conn = transaction_test_connection(&path);
    conn.execute_batch("BEGIN").unwrap();
    let native = OutstandingNativeStatement::new(&conn);
    // SAFETY: this close must reject the outstanding statement and leave the
    // database valid; no successful raw close may bypass the Rust owner.
    assert_eq!(
        unsafe { rusqlite::ffi::sqlite3_close(native.database) },
        rusqlite::ffi::SQLITE_BUSY
    );
    assert!(!conn.is_autocommit());
    let before_commit = wait_for_events(&exporter, recorder.stats().accepted as usize);
    assert!(!before_commit
        .iter()
        .any(|event| event.operation == Some(StoreOperation::Transaction)));
    conn.execute_batch("COMMIT").unwrap();
    let events = wait_for_events(&exporter, recorder.stats().accepted as usize);
    let transactions = events
        .iter()
        .filter(|event| event.operation == Some(StoreOperation::Transaction))
        .collect::<Vec<_>>();
    assert_eq!(transactions.len(), 1);
    assert_eq!(transactions[0].outcome, Some(TelemetryOutcome::Ok));
}

#[test]
fn connection_owner_drop_detaches_callbacks_when_native_close_is_busy() {
    let _lock = telemetry_test_lock();
    let dir = TransactionTestDirectory::new();
    let path = dir.path().join("store.db");
    crate::store::initialize(&path).unwrap();
    let exporter = Arc::new(InMemoryExporter::default());
    let recorder = TelemetryRecorder::bounded(exporter.clone(), runtime(), 128);
    let _guard = install_test_recorder(recorder.clone());
    let conn = transaction_test_connection(&path);
    conn.execute_batch("BEGIN").unwrap();
    let mut native = OutstandingNativeStatement::new(&conn);
    native.owns_database = true;
    drop(conn);
    let accepted_after_drop = recorder.stats().accepted;
    let events = wait_for_events(&exporter, accepted_after_drop as usize);
    let transactions = events
        .iter()
        .filter(|event| event.operation == Some(StoreOperation::Transaction))
        .collect::<Vec<_>>();
    assert_eq!(transactions.len(), 1);
    assert_eq!(transactions[0].outcome, Some(TelemetryOutcome::Error));
    // SAFETY: the outstanding statement kept this database alive when the Rust
    // owner tried to close it. The hook API returns the prior context without
    // dereferencing it, so this assertion detects a stale rollback registration.
    let previous_context = unsafe {
        rusqlite::ffi::sqlite3_rollback_hook(native.database, None, std::ptr::null_mut())
    };
    assert!(previous_context.is_null());
    // Exercise STMT/PROFILE and rollback after the observation Box was freed.
    // Neither callback may run or export another event on the surviving handle.
    unsafe {
        assert_eq!(
            rusqlite::ffi::sqlite3_step(native.statement),
            rusqlite::ffi::SQLITE_ROW
        );
        assert_eq!(
            rusqlite::ffi::sqlite3_step(native.statement),
            rusqlite::ffi::SQLITE_DONE
        );
        assert_eq!(
            rusqlite::ffi::sqlite3_exec(
                native.database,
                c"ROLLBACK".as_ptr(),
                None,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            ),
            rusqlite::ffi::SQLITE_OK
        );
    }
    drop(native);
    assert_eq!(recorder.stats().accepted, accepted_after_drop);
}

#[test]
fn transaction_lifetime_includes_body_and_commit_once() {
    let _lock = telemetry_test_lock();
    let dir = TransactionTestDirectory::new();
    let path = dir.path().join("store.db");
    crate::store::initialize(&path).unwrap();
    let exporter = Arc::new(InMemoryExporter::default());
    let recorder = TelemetryRecorder::bounded(exporter.clone(), runtime(), 128);
    let _guard = install_test_recorder(recorder.clone());
    let mut conn = transaction_test_connection(&path);
    let correlation = Correlation::session(Some("transaction-session"));
    in_store_command(correlation.clone(), || {
        let transaction = conn.transaction().unwrap();
        transaction
            .execute_batch("CREATE TABLE observation_test(value TEXT)")
            .unwrap();
        transaction
            .execute("INSERT INTO observation_test VALUES (?1)", ["SQL-CANARY"])
            .unwrap();
        // Only a lower bound: scheduler delays cannot make this assertion flaky.
        std::thread::sleep(Duration::from_millis(20));
        transaction.commit().unwrap();
    });
    let events = wait_for_events(&exporter, recorder.stats().accepted as usize);
    let transactions = events
        .iter()
        .filter(|e| e.operation == Some(StoreOperation::Transaction))
        .collect::<Vec<_>>();
    assert_eq!(transactions.len(), 1);
    assert_eq!(transactions[0].outcome, Some(TelemetryOutcome::Ok));
    assert_eq!(transactions[0].correlation.session, correlation.session);
    assert!(transactions[0].duration_us.unwrap() >= 20_000);
    assert_eq!(
        events
            .iter()
            .filter(|e| e.operation == Some(StoreOperation::TransactionBegin))
            .count(),
        1
    );
    assert_eq!(
        events
            .iter()
            .filter(|e| e.operation == Some(StoreOperation::Commit))
            .count(),
        1
    );
    assert!(!serde_json::to_string(&events)
        .unwrap()
        .contains("SQL-CANARY"));
}

#[test]
fn transaction_observation_keeps_interleaved_connections_separate() {
    let _lock = telemetry_test_lock();
    let dir = TransactionTestDirectory::new();
    let a_path = dir.path().join("a.db");
    let b_path = dir.path().join("b.db");
    crate::store::initialize(&a_path).unwrap();
    crate::store::initialize(&b_path).unwrap();
    let exporter = Arc::new(InMemoryExporter::default());
    let recorder = TelemetryRecorder::bounded(exporter.clone(), runtime(), 128);
    let _guard = install_test_recorder(recorder.clone());
    let a = transaction_test_connection(&a_path);
    let b = transaction_test_connection(&b_path);
    a.execute_batch("/* leading comment */ BEGIN").unwrap();
    std::thread::sleep(Duration::from_millis(20));
    b.execute_batch("BEGIN; COMMIT").unwrap();
    a.execute_batch("END").unwrap();
    let transactions = wait_for_events(&exporter, recorder.stats().accepted as usize)
        .into_iter()
        .filter(|e| e.operation == Some(StoreOperation::Transaction))
        .collect::<Vec<_>>();
    assert_eq!(transactions.len(), 2);
    assert!(transactions[1].duration_us.unwrap() >= 20_000);
    assert!(transactions[1].duration_us.unwrap() > transactions[0].duration_us.unwrap());
    assert!(transactions
        .iter()
        .all(|e| e.outcome == Some(TelemetryOutcome::Ok)));
}

#[test]
fn transaction_observation_distinguishes_commit_failure_rollback_and_close() {
    let _lock = telemetry_test_lock();
    let dir = TransactionTestDirectory::new();
    let path = dir.path().join("store.db");
    crate::store::initialize(&path).unwrap();
    let exporter = Arc::new(InMemoryExporter::default());
    let recorder = TelemetryRecorder::bounded(exporter.clone(), runtime(), 128);
    let _guard = install_test_recorder(recorder.clone());
    let mut conn = transaction_test_connection(&path);
    assert!(conn.execute_batch("COMMIT").is_err());
    conn.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE observation_parent(id INTEGER PRIMARY KEY); CREATE TABLE observation_child(parent INTEGER REFERENCES observation_parent(id) DEFERRABLE INITIALLY DEFERRED)").unwrap();
    conn.execute_batch("BEGIN; INSERT INTO observation_child VALUES(1)")
        .unwrap();
    assert!(conn.execute_batch("COMMIT").is_err());
    assert!(!conn.is_autocommit());
    conn.execute_batch("ROLLBACK").unwrap();
    {
        let _rollback_on_drop = conn.transaction().unwrap();
    }
    conn.execute_batch("BEGIN").unwrap();
    drop(conn);
    let events = wait_for_events(&exporter, recorder.stats().accepted as usize);
    let transactions = events
        .iter()
        .filter(|e| e.operation == Some(StoreOperation::Transaction))
        .collect::<Vec<_>>();
    assert_eq!(transactions.len(), 3);
    assert!(transactions
        .iter()
        .all(|e| e.outcome == Some(TelemetryOutcome::Error)));
    assert!(events
        .iter()
        .any(|e| e.operation == Some(StoreOperation::Commit)
            && e.outcome == Some(TelemetryOutcome::Error)));
}

#[test]
fn transaction_observation_marks_rejected_commit_as_rollback() {
    unsafe extern "C" fn reject_commit(_: *mut std::ffi::c_void) -> std::ffi::c_int {
        1
    }

    let _lock = telemetry_test_lock();
    let dir = TransactionTestDirectory::new();
    let path = dir.path().join("store.db");
    crate::store::initialize(&path).unwrap();
    let exporter = Arc::new(InMemoryExporter::default());
    let recorder = TelemetryRecorder::bounded(exporter.clone(), runtime(), 128);
    let _guard = install_test_recorder(recorder.clone());
    let conn = transaction_test_connection(&path);
    conn.execute_batch("CREATE TABLE observation_commit(value INTEGER)")
        .unwrap();

    for (opening, closing) in [
        ("BEGIN", "COMMIT"),
        ("BEGIN", "END"),
        ("SAVEPOINT outer_transaction", "RELEASE outer_transaction"),
    ] {
        // SAFETY: the test-only hook has no context and remains valid until
        // removed below. It injects an actual SQLite commit rejection.
        unsafe {
            rusqlite::ffi::sqlite3_commit_hook(
                conn.handle(),
                Some(reject_commit),
                std::ptr::null_mut(),
            );
        }
        conn.execute_batch(opening).unwrap();
        conn.execute_batch("INSERT INTO observation_commit VALUES(1)")
            .unwrap();
        let error = conn.execute_batch(closing).unwrap_err();
        assert_eq!(store_error_identity(&error).unwrap().primary_code, 19);
        if closing == "RELEASE outer_transaction" {
            // SQLite leaves this rejected savepoint release open. It must not
            // finish the lifetime until the following explicit rollback.
            assert!(!conn.is_autocommit());
            let events = wait_for_events(&exporter, recorder.stats().accepted as usize);
            assert_eq!(
                events
                    .iter()
                    .filter(|event| event.operation == Some(StoreOperation::Transaction))
                    .count(),
                4
            );
            conn.execute_batch("ROLLBACK").unwrap();
        }
        assert!(conn.is_autocommit(), "{closing} did not restore autocommit");
        // SAFETY: removing this test's hook leaves the observer's rollback
        // hook intact. The next transaction must not inherit the failure.
        unsafe {
            rusqlite::ffi::sqlite3_commit_hook(conn.handle(), None, std::ptr::null_mut());
        }
        conn.execute_batch("BEGIN; COMMIT").unwrap();
    }

    assert_eq!(
        conn.query_row("SELECT count(*) FROM observation_commit", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap(),
        0
    );
    let events = wait_for_events(&exporter, recorder.stats().accepted as usize);
    let outcomes = |operation| {
        events
            .iter()
            .filter(|event| event.operation == Some(operation))
            .map(|event| event.outcome.unwrap())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        outcomes(StoreOperation::Transaction),
        vec![
            TelemetryOutcome::Error,
            TelemetryOutcome::Ok,
            TelemetryOutcome::Error,
            TelemetryOutcome::Ok,
            TelemetryOutcome::Error,
            TelemetryOutcome::Ok,
        ]
    );
    assert_eq!(
        outcomes(StoreOperation::Commit),
        vec![
            TelemetryOutcome::Error,
            TelemetryOutcome::Ok,
            TelemetryOutcome::Error,
            TelemetryOutcome::Ok,
            TelemetryOutcome::Ok,
        ]
    );
}

#[test]
fn failed_begin_does_not_create_a_transaction_lifetime() {
    let _lock = telemetry_test_lock();
    let dir = TransactionTestDirectory::new();
    let path = dir.path().join("store.db");
    crate::store::initialize(&path).unwrap();
    let exporter = Arc::new(InMemoryExporter::default());
    let recorder = TelemetryRecorder::bounded(exporter.clone(), runtime(), 128);
    let _guard = install_test_recorder(recorder.clone());
    let a = transaction_test_connection(&path);
    let b = transaction_test_connection(&path);
    a.execute_batch("BEGIN IMMEDIATE").unwrap();
    b.busy_timeout(Duration::ZERO).unwrap();
    assert!(b.execute_batch("BEGIN IMMEDIATE").is_err());
    assert!(b.is_autocommit());
    a.execute_batch("ROLLBACK").unwrap();
    let events = wait_for_events(&exporter, recorder.stats().accepted as usize);
    assert_eq!(
        events
            .iter()
            .filter(|e| e.operation == Some(StoreOperation::TransactionBegin))
            .count(),
        1
    );
    let transactions = events
        .iter()
        .filter(|e| e.operation == Some(StoreOperation::Transaction))
        .collect::<Vec<_>>();
    assert_eq!(transactions.len(), 1);
    assert_eq!(transactions[0].outcome, Some(TelemetryOutcome::Error));
}

#[test]
fn transaction_observation_keeps_savepoints_inside_one_lifetime() {
    let _lock = telemetry_test_lock();
    let dir = TransactionTestDirectory::new();
    let path = dir.path().join("store.db");
    crate::store::initialize(&path).unwrap();
    let exporter = Arc::new(InMemoryExporter::default());
    let recorder = TelemetryRecorder::bounded(exporter.clone(), runtime(), 128);
    let _guard = install_test_recorder(recorder.clone());
    let conn = transaction_test_connection(&path);
    conn.execute_batch("SAVEPOINT outer_transaction; SAVEPOINT nested; ROLLBACK TO nested; RELEASE nested; RELEASE outer_transaction").unwrap();
    conn.execute_batch("BEGIN").unwrap();
    assert!(conn.execute_batch("BEGIN").is_err());
    conn.execute_batch("COMMIT").unwrap();
    let events = wait_for_events(&exporter, recorder.stats().accepted as usize);
    assert_eq!(
        events
            .iter()
            .filter(|e| e.operation == Some(StoreOperation::TransactionBegin))
            .count(),
        2
    );
    let transactions = events
        .iter()
        .filter(|e| e.operation == Some(StoreOperation::Transaction))
        .collect::<Vec<_>>();
    assert_eq!(transactions.len(), 2);
    assert!(transactions
        .iter()
        .all(|e| e.outcome == Some(TelemetryOutcome::Ok)));
}
