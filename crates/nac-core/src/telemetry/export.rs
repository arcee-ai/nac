use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use super::{
    Observation, RuntimeMetadata, TelemetryEvent, JSON_LINE_PREFIX, MAX_EXPORT_QUEUE_CAPACITY,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TelemetryExportError;

pub trait TelemetryExporter: Send + Sync + 'static {
    fn export(&self, event: &TelemetryEvent) -> Result<(), TelemetryExportError>;

    /// Optional out-of-band accounting; never enters the observation queue.
    fn export_receipt(&self, _receipt: &ExportReceipt) -> Result<(), TelemetryExportError> {
        Ok(())
    }
}

pub const EXPORT_RECEIPT_PREFIX: &str = "nac-telemetry-export ";
const RECEIPT_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Serialize)]
pub struct ExportReceipt {
    pub timestamp_unix_ms: u64,
    pub recorder_id: String,
    pub process_id: u32,
    pub capacity: usize,
    pub final_receipt: bool,
    pub stats: ExportStats,
    pub receipt_failures: u64,
    pub runtime: RuntimeMetadata,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportShutdown {
    Disabled,
    Drained,
    TimedOut,
    ReceiptFailed,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct ExportStats {
    pub accepted: u64,
    pub dropped: u64,
    pub exported: u64,
    pub failures: u64,
}

#[derive(Default)]
struct AtomicExportStats {
    accepted: AtomicU64,
    dropped: AtomicU64,
    exported: AtomicU64,
    failures: AtomicU64,
}

#[derive(Clone)]
pub struct TelemetryRecorder {
    sender: Option<mpsc::SyncSender<Observation>>,
    stats: Arc<AtomicExportStats>,
    completion: Option<Arc<Mutex<mpsc::Receiver<bool>>>>,
}

impl TelemetryRecorder {
    pub fn disabled() -> Self {
        Self {
            sender: None,
            stats: Arc::new(AtomicExportStats::default()),
            completion: None,
        }
    }

    pub fn bounded(
        exporter: Arc<dyn TelemetryExporter>,
        runtime: RuntimeMetadata,
        capacity: usize,
    ) -> Self {
        Self::bounded_internal(exporter, runtime, capacity, false)
    }

    fn bounded_internal(
        exporter: Arc<dyn TelemetryExporter>,
        runtime: RuntimeMetadata,
        capacity: usize,
        receipts: bool,
    ) -> Self {
        let capacity = capacity.clamp(1, MAX_EXPORT_QUEUE_CAPACITY);
        let (sender, receiver) = mpsc::sync_channel::<Observation>(capacity);
        let (complete_tx, complete_rx) = mpsc::channel();
        let stats = Arc::new(AtomicExportStats::default());
        let worker_stats = Arc::clone(&stats);
        let _ = std::thread::Builder::new()
            .name("nac-telemetry-export".to_string())
            .spawn(move || {
                let recorder_id = uuid::Uuid::new_v4().to_string();
                let mut receipt_failures = 0;
                let mut next_receipt = Instant::now() + RECEIPT_INTERVAL;
                loop {
                    match receiver
                        .recv_timeout(next_receipt.saturating_duration_since(Instant::now()))
                    {
                        Ok(observation) => {
                            let mut event = observation.into_event(runtime.clone());
                            if receipts {
                                event.export_recorder_id = Some(recorder_id.clone());
                            }
                            if exporter.export(&event).is_ok() {
                                worker_stats.exported.fetch_add(1, Ordering::Relaxed);
                            } else {
                                worker_stats.failures.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                    if Instant::now() >= next_receipt {
                        if receipts
                            && export_receipt(
                                &*exporter,
                                &runtime,
                                &recorder_id,
                                capacity,
                                false,
                                &worker_stats,
                                receipt_failures,
                            )
                            .is_err()
                        {
                            receipt_failures += 1;
                        }
                        next_receipt = Instant::now() + RECEIPT_INTERVAL;
                    }
                }
                let final_ok = !receipts
                    || export_receipt(
                        &*exporter,
                        &runtime,
                        &recorder_id,
                        capacity,
                        true,
                        &worker_stats,
                        receipt_failures,
                    )
                    .is_ok();
                let _ = complete_tx.send(final_ok);
            });
        Self {
            sender: Some(sender),
            stats,
            completion: Some(Arc::new(Mutex::new(complete_rx))),
        }
    }

    /// Called after producers quiesce. Other recorder clones must be dropped
    /// before this can drain; a stalled exporter cannot extend the wait budget.
    pub(super) fn finish(mut self, timeout: Duration) -> ExportShutdown {
        self.sender.take();
        let Some(completion) = self.completion.take() else {
            return ExportShutdown::Disabled;
        };
        let result = completion
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .recv_timeout(timeout);
        match result {
            Ok(true) => ExportShutdown::Drained,
            Ok(false) | Err(mpsc::RecvTimeoutError::Disconnected) => ExportShutdown::ReceiptFailed,
            Err(mpsc::RecvTimeoutError::Timeout) => ExportShutdown::TimedOut,
        }
    }

    pub(super) fn is_enabled(&self) -> bool {
        self.sender.is_some()
    }

    pub(super) fn record(&self, observation: Observation) {
        let Some(sender) = self.sender.as_ref() else {
            return;
        };
        match sender.try_send(observation) {
            Ok(()) => {
                self.stats.accepted.fetch_add(1, Ordering::Relaxed);
            }
            Err(mpsc::TrySendError::Full(_) | mpsc::TrySendError::Disconnected(_)) => {
                self.stats.dropped.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    pub fn stats(&self) -> ExportStats {
        self.stats.snapshot()
    }
}

impl AtomicExportStats {
    fn snapshot(&self) -> ExportStats {
        ExportStats {
            accepted: self.accepted.load(Ordering::Relaxed),
            dropped: self.dropped.load(Ordering::Relaxed),
            exported: self.exported.load(Ordering::Relaxed),
            failures: self.failures.load(Ordering::Relaxed),
        }
    }
}

fn export_receipt(
    exporter: &dyn TelemetryExporter,
    runtime: &RuntimeMetadata,
    recorder_id: &str,
    capacity: usize,
    final_receipt: bool,
    stats: &AtomicExportStats,
    receipt_failures: u64,
) -> Result<(), TelemetryExportError> {
    exporter.export_receipt(&ExportReceipt {
        timestamp_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX),
        recorder_id: recorder_id.to_string(),
        process_id: std::process::id(),
        capacity,
        final_receipt,
        stats: stats.snapshot(),
        receipt_failures,
        runtime: runtime.clone(),
    })
}

#[derive(Default)]
pub struct InMemoryExporter {
    events: Mutex<Vec<TelemetryEvent>>,
}

impl InMemoryExporter {
    pub fn events(&self) -> Vec<TelemetryEvent> {
        self.events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }
}

impl TelemetryExporter for InMemoryExporter {
    fn export(&self, event: &TelemetryEvent) -> Result<(), TelemetryExportError> {
        self.events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(event.clone());
        Ok(())
    }
}

struct JsonStderrExporter;

impl TelemetryExporter for JsonStderrExporter {
    fn export(&self, event: &TelemetryEvent) -> Result<(), TelemetryExportError> {
        write_json_line(JSON_LINE_PREFIX, event)
    }

    fn export_receipt(&self, receipt: &ExportReceipt) -> Result<(), TelemetryExportError> {
        write_json_line(EXPORT_RECEIPT_PREFIX, receipt)
    }
}

pub(super) fn stderr_recorder(runtime: RuntimeMetadata, capacity: usize) -> TelemetryRecorder {
    TelemetryRecorder::bounded_internal(Arc::new(JsonStderrExporter), runtime, capacity, true)
}

fn write_json_line(prefix: &str, value: &impl Serialize) -> Result<(), TelemetryExportError> {
    let line = serde_json::to_vec(value).map_err(|_| TelemetryExportError)?;
    let mut stderr = std::io::stderr().lock();
    stderr
        .write_all(prefix.as_bytes())
        .map_err(|_| TelemetryExportError)?;
    stderr.write_all(&line).map_err(|_| TelemetryExportError)?;
    stderr.write_all(b"\n").map_err(|_| TelemetryExportError)
}

#[cfg(test)]
#[path = "export_tests.rs"]
mod tests;
