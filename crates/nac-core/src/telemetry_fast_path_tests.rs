//! Disabled-telemetry fast path: emitters consult a lock-free mirror of the
//! global recorder before they build an observation or take the recorder's
//! lock, the mirror follows every recorder replacement, and enabled emitters
//! still record exactly the observations they always did.

use super::*;
use std::sync::{mpsc, Arc};

fn runtime() -> RuntimeMetadata {
    RuntimeMetadata::sqlite(
        "build-test",
        "revision-test",
        crate::store::schema_version(),
        None,
        None,
    )
}

fn correlation() -> Correlation {
    Correlation::session(Some("session-a"))
        .with_run(Some("run-a"))
        .with_generation(7)
}

/// Every emitter, public and crate-private, in a fixed order.
fn emit_everything(correlation: &Correlation) {
    emit_store_duration(
        StoreOperation::QueueWait,
        correlation.clone(),
        Duration::from_micros(3),
        TelemetryOutcome::Ok,
        None,
    );
    emit_http_duration(
        "/sessions/{session_id}",
        correlation.clone(),
        Duration::from_millis(1),
        TelemetryOutcome::Ok,
    );
    emit_connection_counts(1, 2, correlation.clone());
    emit_persistence_counts(3, 1, 8, correlation.clone());
    emit_persistence_caller_counts(2, 4);
    emit_resource_sample(correlation.clone(), None);
    observe_store(
        StoreOperation::EventPersistence,
        correlation.clone(),
        || {
            sqlite_profile("COMMIT", Duration::from_micros(5));
            Ok(())
        },
    )
    .unwrap();
    in_store_command(correlation.clone(), || ());
    drop(RuntimeActivityGuard::start(
        RuntimeActivity::Worker,
        correlation.clone(),
    ));
    drop(ChildProcessGuard::start(
        Some(std::process::id()),
        correlation.clone(),
    ));
}

#[test]
fn disabled_emitters_return_before_taking_the_recorder_lock() {
    let _serial = test_recorder_lock();
    let _disabled = install_test_recorder(TelemetryRecorder::disabled());
    let exclusive = GLOBAL_RECORDER
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let (returned_tx, returned) = mpsc::channel();
    let emitter = std::thread::spawn(move || {
        let _member = register_test_recorder_thread();
        emit_everything(&correlation());
        let _ = returned_tx.send(());
    });

    let returned = returned.recv_timeout(Duration::from_secs(2)).is_ok();
    drop(exclusive);
    emitter.join().unwrap();

    assert!(
        returned,
        "a disabled emitter waited for the global recorder lock"
    );
}

#[test]
fn enabled_mirror_follows_every_recorder_replacement() {
    let _serial = test_recorder_lock();
    let before = enabled();
    {
        let _recording = install_test_recorder(TelemetryRecorder::bounded(
            Arc::new(InMemoryExporter::default()),
            runtime(),
            16,
        ));
        assert!(enabled());
        {
            let _quiet = install_test_recorder(TelemetryRecorder::disabled());
            assert!(!enabled());
        }
        assert!(
            enabled(),
            "dropping a test recorder restores the previous one"
        );
        let _ = finish_export(Duration::from_millis(100));
        assert!(!enabled(), "finishing export leaves a disabled recorder");
    }
    assert_eq!(enabled(), before);
}

type Shape = (
    TelemetryName,
    TelemetryKind,
    Option<StoreOperation>,
    Option<RuntimeActivity>,
    Option<String>,
    Option<TelemetryOutcome>,
    bool,
);

#[test]
fn enabled_emitters_record_the_same_observations() {
    let _serial = test_recorder_lock();
    let exporter = Arc::new(InMemoryExporter::default());
    let recorder = TelemetryRecorder::bounded(exporter.clone(), runtime(), 256);
    let _recording = install_test_recorder(recorder.clone());
    let correlation = correlation();

    emit_everything(&correlation);

    let deadline = Instant::now() + Duration::from_secs(2);
    while recorder.stats().exported < recorder.stats().accepted {
        assert!(
            Instant::now() < deadline,
            "telemetry exporter did not drain"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(recorder.stats().dropped, 0);
    let events = exporter.events();
    // Gauge values over process-wide activity counters can include parallel
    // tests' work, so compare everything but those values.
    let shapes = events
        .iter()
        .map(|event| {
            (
                event.name,
                event.kind,
                event.operation,
                event.activity,
                event.route.clone(),
                event.outcome,
                event.correlation == correlation,
            )
        })
        .collect::<Vec<Shape>>();
    use TelemetryKind::{Diagnostic, Gauge, Span};
    use TelemetryName::*;
    let span = |operation| -> Shape {
        (
            StoreOperationDuration,
            Span,
            Some(operation),
            None,
            None,
            Some(TelemetryOutcome::Ok),
            true,
        )
    };
    let gauge = |name, correlated| -> Shape { (name, Gauge, None, None, None, None, correlated) };
    let connections = |route: &str| -> Shape {
        (
            StoreConnectionActive,
            Gauge,
            None,
            None,
            Some(route.to_string()),
            None,
            true,
        )
    };
    let activity = |activity| -> Shape {
        (
            RuntimeActivityActive,
            Gauge,
            None,
            Some(activity),
            None,
            None,
            true,
        )
    };
    let child = |outcome| -> Shape {
        (
            ChildProcess,
            Diagnostic,
            None,
            Some(RuntimeActivity::ChildProcess),
            None,
            Some(outcome),
            true,
        )
    };
    assert_eq!(
        shapes,
        vec![
            span(StoreOperation::QueueWait),
            (
                HttpRequestDuration,
                Span,
                None,
                None,
                Some("/sessions/{session_id}".to_string()),
                Some(TelemetryOutcome::Ok),
                true,
            ),
            connections("process"),
            connections("store"),
            gauge(PersistenceQueueDepth, true),
            gauge(PersistenceExecutorActive, true),
            gauge(PersistenceQueueCapacity, true),
            gauge(PersistenceCallerActive, false),
            gauge(PersistenceCallerCapacity, false),
            gauge(ResourceSample, true),
            gauge(PersistenceQueueActive, true),
            span(StoreOperation::Commit),
            span(StoreOperation::EventPersistence),
            gauge(PersistenceQueueActive, true),
            gauge(PersistenceQueueActive, true),
            gauge(PersistenceQueueActive, true),
            activity(RuntimeActivity::Worker),
            gauge(ResourceSample, true),
            activity(RuntimeActivity::Worker),
            gauge(ResourceSample, true),
            activity(RuntimeActivity::ChildProcess),
            child(TelemetryOutcome::Started),
            gauge(ResourceSample, true),
            child(TelemetryOutcome::Stopped),
            activity(RuntimeActivity::ChildProcess),
        ]
    );
    let values = events
        .iter()
        .filter_map(|event| match (event.name, event.route.as_deref()) {
            (TelemetryName::StoreConnectionActive, route) => Some((event.name, route, event.value)),
            (
                TelemetryName::PersistenceQueueDepth
                | TelemetryName::PersistenceExecutorActive
                | TelemetryName::PersistenceQueueCapacity
                | TelemetryName::PersistenceCallerActive
                | TelemetryName::PersistenceCallerCapacity,
                None,
            ) => Some((event.name, None, event.value)),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        values,
        vec![
            (StoreConnectionActive, Some("process"), Some(1)),
            (StoreConnectionActive, Some("store"), Some(2)),
            (PersistenceQueueDepth, None, Some(3)),
            (PersistenceExecutorActive, None, Some(1)),
            (PersistenceQueueCapacity, None, Some(8)),
            (PersistenceCallerActive, None, Some(2)),
            (PersistenceCallerCapacity, None, Some(4)),
        ]
    );
}
