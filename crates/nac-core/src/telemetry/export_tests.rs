use super::*;
use std::sync::atomic::{AtomicBool, AtomicUsize};

use crate::telemetry::{Correlation, TelemetryKind, TelemetryName};

#[derive(Default)]
struct CaptureExporter {
    receipts: Mutex<Vec<ExportReceipt>>,
    events: AtomicUsize,
    receipt_attempts: AtomicUsize,
    recorder_ids: Mutex<Vec<Option<String>>>,
    fail_events: AtomicBool,
    fail_receipts: AtomicBool,
    gate: Option<Arc<(Mutex<bool>, std::sync::Condvar)>>,
}

impl TelemetryExporter for CaptureExporter {
    fn export(&self, event: &TelemetryEvent) -> Result<(), TelemetryExportError> {
        self.events.fetch_add(1, Ordering::Relaxed);
        self.recorder_ids
            .lock()
            .unwrap()
            .push(event.export_recorder_id.clone());
        if let Some(gate) = &self.gate {
            let mut released = gate.0.lock().unwrap();
            while !*released {
                released = gate.1.wait(released).unwrap();
            }
        }
        if self.fail_events.load(Ordering::Relaxed) {
            Err(TelemetryExportError)
        } else {
            Ok(())
        }
    }

    fn export_receipt(&self, receipt: &ExportReceipt) -> Result<(), TelemetryExportError> {
        self.receipt_attempts.fetch_add(1, Ordering::Relaxed);
        if self.fail_receipts.load(Ordering::Relaxed) {
            return Err(TelemetryExportError);
        }
        self.receipts.lock().unwrap().push(receipt.clone());
        Ok(())
    }
}

fn runtime() -> RuntimeMetadata {
    RuntimeMetadata::sqlite(
        "dev-test",
        "receipt-revision",
        32,
        Some("private-host"),
        None,
    )
}

fn observation() -> Observation {
    Observation {
        name: TelemetryName::HttpRequestDuration,
        kind: TelemetryKind::Span,
        operation: None,
        activity: None,
        route: Some("/healthz".to_string()),
        outcome: None,
        duration_us: Some(10),
        value: None,
        pid: None,
        cpu_time_us: None,
        resident_memory_bytes: None,
        error: None,
        correlation: Correlation::default(),
    }
}

fn wait_until(condition: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(3);
    while !condition() {
        assert!(Instant::now() < deadline, "exporter did not progress");
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[test]
fn idle_receipt_and_final_receipt_have_stable_content_free_identity() {
    let exporter = Arc::new(CaptureExporter::default());
    let recorder =
        TelemetryRecorder::bounded_internal(exporter.clone(), runtime(), usize::MAX, true);
    wait_until(|| !exporter.receipts.lock().unwrap().is_empty());
    recorder.record(observation());
    assert_eq!(
        recorder.finish(Duration::from_secs(2)),
        ExportShutdown::Drained
    );
    let receipts = exporter.receipts.lock().unwrap();
    let first = &receipts[0];
    let last = receipts.last().unwrap();
    assert!(!first.final_receipt);
    assert!(last.final_receipt);
    assert_eq!(first.recorder_id, last.recorder_id);
    assert_eq!(last.process_id, std::process::id());
    assert_eq!(last.capacity, MAX_EXPORT_QUEUE_CAPACITY);
    assert_eq!(
        last.stats,
        ExportStats {
            accepted: 1,
            dropped: 0,
            exported: 1,
            failures: 0
        }
    );
    assert_eq!(last.receipt_failures, 0);
    assert_eq!(
        *exporter.recorder_ids.lock().unwrap(),
        vec![Some(last.recorder_id.clone())]
    );
    let serialized = serde_json::to_string(last).unwrap();
    assert!(!serialized.contains("private-host"));
    assert!(serialized.contains("receipt-revision"));
    assert_eq!(
        exporter.events.load(Ordering::Relaxed),
        1,
        "receipts are not observations"
    );
}

#[test]
fn final_receipt_exposes_drops_and_failures_without_stalling_producers() {
    let gate = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
    let exporter = Arc::new(CaptureExporter {
        gate: Some(gate.clone()),
        fail_events: AtomicBool::new(true),
        ..Default::default()
    });
    let recorder = TelemetryRecorder::bounded_internal(exporter.clone(), runtime(), 4, true);
    recorder.record(observation());
    wait_until(|| exporter.events.load(Ordering::Relaxed) == 1);
    let started = Instant::now();
    for _ in 0..10_000 {
        recorder.record(observation());
    }
    assert!(started.elapsed() < Duration::from_secs(1));
    let before = recorder.stats();
    assert_eq!(before.accepted, 5);
    assert_eq!(before.dropped, 9_996);
    *gate.0.lock().unwrap() = true;
    gate.1.notify_all();
    assert_eq!(
        recorder.finish(Duration::from_secs(2)),
        ExportShutdown::Drained
    );
    let receipts = exporter.receipts.lock().unwrap();
    let last = receipts.last().unwrap();
    assert!(last.final_receipt);
    assert_eq!(
        last.stats,
        ExportStats {
            accepted: 5,
            dropped: 9_996,
            exported: 0,
            failures: 5
        }
    );
}

#[test]
fn stalled_exporter_cannot_extend_shutdown_budget() {
    let gate = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
    let exporter = Arc::new(CaptureExporter {
        gate: Some(gate.clone()),
        ..Default::default()
    });
    let recorder = TelemetryRecorder::bounded_internal(exporter.clone(), runtime(), 1, true);
    recorder.record(observation());
    wait_until(|| exporter.events.load(Ordering::Relaxed) == 1);
    let started = Instant::now();
    assert_eq!(
        recorder.finish(Duration::from_millis(20)),
        ExportShutdown::TimedOut
    );
    assert!(started.elapsed() < Duration::from_millis(200));
    assert!(exporter.receipts.lock().unwrap().is_empty());
    *gate.0.lock().unwrap() = true;
    gate.1.notify_all();
    wait_until(|| {
        exporter
            .receipts
            .lock()
            .unwrap()
            .iter()
            .any(|r| r.final_receipt)
    });
}

#[test]
fn receipt_failure_is_explicit_and_accounted_separately() {
    let exporter = Arc::new(CaptureExporter {
        fail_receipts: AtomicBool::new(true),
        ..Default::default()
    });
    let recorder = TelemetryRecorder::bounded_internal(exporter.clone(), runtime(), 1, true);
    assert_eq!(
        recorder.finish(Duration::from_secs(2)),
        ExportShutdown::ReceiptFailed
    );
    assert_eq!(exporter.events.load(Ordering::Relaxed), 0);
    assert!(exporter.receipts.lock().unwrap().is_empty());
}

#[test]
fn disabled_and_default_adapters_do_not_emit_accounting_receipts() {
    assert_eq!(
        TelemetryRecorder::disabled().finish(Duration::from_secs(1)),
        ExportShutdown::Disabled
    );
    let exporter = Arc::new(CaptureExporter::default());
    let recorder = TelemetryRecorder::bounded(exporter.clone(), runtime(), 1);
    recorder.record(observation());
    assert_eq!(
        recorder.finish(Duration::from_secs(2)),
        ExportShutdown::Drained
    );
    assert!(exporter.receipts.lock().unwrap().is_empty());
}

#[test]
fn recovered_receipt_export_retains_prior_receipt_failure_count() {
    let exporter = Arc::new(CaptureExporter {
        fail_receipts: AtomicBool::new(true),
        ..Default::default()
    });
    let recorder = TelemetryRecorder::bounded_internal(exporter.clone(), runtime(), 1, true);
    wait_until(|| exporter.receipt_attempts.load(Ordering::Relaxed) >= 1);
    exporter.fail_receipts.store(false, Ordering::Relaxed);
    recorder.record(observation());
    assert_eq!(
        recorder.finish(Duration::from_secs(2)),
        ExportShutdown::Drained
    );
    let receipts = exporter.receipts.lock().unwrap();
    let last = receipts.last().unwrap();
    assert!(last.final_receipt);
    assert_eq!(last.receipt_failures, 1);
    assert_eq!(
        last.stats,
        ExportStats {
            accepted: 1,
            dropped: 0,
            exported: 1,
            failures: 0
        }
    );
}
