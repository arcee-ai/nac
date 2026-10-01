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
            StoreOperation::Transaction,
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
