//! Bounded, content-free, nonblocking operational telemetry for Managed NAC.

use std::cell::RefCell;
use std::error::Error;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::RwLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::Result;
use serde::Serialize;
use sha2::{Digest, Sha256};

mod export;
mod resource;

pub use export::{
    ExportStats, InMemoryExporter, TelemetryExportError, TelemetryExporter, TelemetryRecorder,
};
pub use resource::emit_resource_sample;

pub const DEFAULT_EXPORT_QUEUE_CAPACITY: usize = 1_024;
pub const MAX_EXPORT_QUEUE_CAPACITY: usize = 4_096;
pub const JSON_LINE_PREFIX: &str = "nac-telemetry ";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TelemetryKind {
    Span,
    Gauge,
    Diagnostic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum TelemetryName {
    #[serde(rename = "nac.store.operation.duration")]
    StoreOperationDuration,
    #[serde(rename = "nac.store.connection.active")]
    StoreConnectionActive,
    #[serde(rename = "nac.persistence.queue.active")]
    PersistenceQueueActive,
    #[serde(rename = "nac.runtime.activity.active")]
    RuntimeActivityActive,
    #[serde(rename = "nac.runtime.child_process")]
    ChildProcess,
    #[serde(rename = "nac.runtime.resource.sample")]
    ResourceSample,
    #[serde(rename = "nac.http.request.duration")]
    HttpRequestDuration,
}

impl TelemetryName {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::StoreOperationDuration => "nac.store.operation.duration",
            Self::StoreConnectionActive => "nac.store.connection.active",
            Self::PersistenceQueueActive => "nac.persistence.queue.active",
            Self::RuntimeActivityActive => "nac.runtime.activity.active",
            Self::ChildProcess => "nac.runtime.child_process",
            Self::ResourceSample => "nac.runtime.resource.sample",
            Self::HttpRequestDuration => "nac.http.request.duration",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StoreOperation {
    ConnectionAcquire,
    Transaction,
    Commit,
    Checkpoint,
    Retry,
    TranscriptAppend,
    EventPersistence,
    WorkerEpisodeCommit,
    ManagedMonitorPoll,
    Recovery,
    TerminalSettlement,
    Readiness,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeActivity {
    Orchestrator,
    Worker,
    ChildProcess,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TelemetryOutcome {
    Ok,
    Error,
    Conflict,
    Dropped,
    Started,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct StoreErrorIdentity {
    pub engine: &'static str,
    pub primary_code: i32,
    pub extended_code: i32,
}

impl StoreErrorIdentity {
    fn sqlite(primary_code: i32, extended_code: i32) -> Self {
        Self {
            engine: "sqlite",
            primary_code,
            extended_code,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Correlation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scenario: Option<String>,
}

impl Correlation {
    pub fn bounded(
        host: Option<&str>,
        session: Option<&str>,
        run: Option<&str>,
        generation: Option<u64>,
        scenario: Option<&str>,
    ) -> Self {
        Self {
            host: host.map(digest_identifier),
            session: session.map(digest_identifier),
            run: run.map(digest_identifier),
            generation,
            scenario: scenario.and_then(bounded_scenario),
        }
    }

    pub fn session(session: Option<&str>) -> Self {
        Self::bounded(None, session, None, None, None)
    }

    pub fn with_run(mut self, run: Option<&str>) -> Self {
        self.run = run.map(digest_identifier);
        self
    }

    pub fn with_generation(mut self, generation: u64) -> Self {
        self.generation = Some(generation);
        self
    }
}

fn digest_identifier(value: &str) -> String {
    // Correlation is intentionally irreversible and fixed-width. Truncating a
    // SHA-256 digest to 64 bits is sufficient for diagnostics while keeping
    // raw identifiers and unbounded label values out of telemetry.
    let digest = Sha256::digest(value.as_bytes());
    digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn bounded_scenario(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')))
    .then(|| value.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RuntimeMetadata {
    pub build_id: String,
    pub source_revision: String,
    pub store_engine: &'static str,
    pub journal_mode: &'static str,
    pub schema_version: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scenario: Option<String>,
}

impl RuntimeMetadata {
    pub fn sqlite(
        build_id: &str,
        source_revision: &str,
        schema_version: i64,
        host_id: Option<&str>,
        scenario: Option<&str>,
    ) -> Self {
        Self {
            build_id: bounded_identity(build_id),
            source_revision: bounded_identity(source_revision),
            store_engine: "sqlite",
            journal_mode: "wal",
            schema_version,
            host: host_id.map(digest_identifier),
            scenario: scenario.and_then(bounded_scenario),
        }
    }
}

fn bounded_identity(value: &str) -> String {
    let value = value.trim();
    if !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && !matches!(byte, b'"' | b'\\'))
    {
        value.to_string()
    } else {
        "unknown".to_string()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TelemetryEvent {
    pub timestamp_unix_ms: u64,
    pub name: TelemetryName,
    pub kind: TelemetryKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<StoreOperation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity: Option<RuntimeActivity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<TelemetryOutcome>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_us: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_time_us: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resident_memory_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<StoreErrorIdentity>,
    pub correlation: Correlation,
    pub runtime: RuntimeMetadata,
}

impl TelemetryEvent {
    pub fn series_key(&self) -> String {
        format!(
            "{}|{:?}|{:?}|{:?}|{}|{}",
            self.name.as_str(),
            self.operation,
            self.activity,
            self.outcome,
            self.route.as_deref().unwrap_or("-"),
            self.runtime.store_engine
        )
    }
}

#[derive(Debug, Clone)]
struct Observation {
    name: TelemetryName,
    kind: TelemetryKind,
    operation: Option<StoreOperation>,
    activity: Option<RuntimeActivity>,
    route: Option<String>,
    outcome: Option<TelemetryOutcome>,
    duration_us: Option<u64>,
    value: Option<u64>,
    pid: Option<u32>,
    cpu_time_us: Option<u64>,
    resident_memory_bytes: Option<u64>,
    error: Option<StoreErrorIdentity>,
    correlation: Correlation,
}

impl Observation {
    fn into_event(self, runtime: RuntimeMetadata) -> TelemetryEvent {
        TelemetryEvent {
            timestamp_unix_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .try_into()
                .unwrap_or(u64::MAX),
            name: self.name,
            kind: self.kind,
            operation: self.operation,
            activity: self.activity,
            route: self.route,
            outcome: self.outcome,
            duration_us: self.duration_us,
            value: self.value,
            pid: self.pid,
            cpu_time_us: self.cpu_time_us,
            resident_memory_bytes: self.resident_memory_bytes,
            error: self.error,
            correlation: self.correlation,
            runtime,
        }
    }
}

static GLOBAL_RECORDER: std::sync::LazyLock<RwLock<TelemetryRecorder>> =
    std::sync::LazyLock::new(|| RwLock::new(TelemetryRecorder::disabled()));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigureStatus {
    Disabled,
    Stderr,
    Invalid,
}

pub fn configure_from_env(runtime: RuntimeMetadata) -> ConfigureStatus {
    let mode = std::env::var("NAC_TELEMETRY").unwrap_or_default();
    let status = match mode.trim() {
        "" | "off" | "disabled" => ConfigureStatus::Disabled,
        "stderr" => {
            let capacity = std::env::var("NAC_TELEMETRY_BUFFER")
                .ok()
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(DEFAULT_EXPORT_QUEUE_CAPACITY)
                .clamp(1, MAX_EXPORT_QUEUE_CAPACITY);
            *GLOBAL_RECORDER
                .write()
                .unwrap_or_else(std::sync::PoisonError::into_inner) =
                export::stderr_recorder(runtime, capacity);
            ConfigureStatus::Stderr
        }
        _ => ConfigureStatus::Invalid,
    };
    status
}

pub fn enabled() -> bool {
    GLOBAL_RECORDER
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .is_enabled()
}

fn global_record(observation: Observation) {
    #[cfg(any(test, feature = "test-support"))]
    if TEST_RECORDER_OWNERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_ref()
        .is_some_and(|owners| !owners.contains(&std::thread::current().id()))
    {
        return;
    }
    GLOBAL_RECORDER
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .record(observation);
}

#[cfg(any(test, feature = "test-support"))]
pub struct TestRecorderGuard {
    previous: Option<TelemetryRecorder>,
    previous_owners: Option<Vec<std::thread::ThreadId>>,
}

#[cfg(any(test, feature = "test-support"))]
static TEST_RECORDER_OWNERS: std::sync::LazyLock<
    std::sync::Mutex<Option<Vec<std::thread::ThreadId>>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(None));

#[cfg(any(test, feature = "test-support"))]
pub struct TestRecorderThreadGuard(std::thread::ThreadId);

#[cfg(any(test, feature = "test-support"))]
impl Drop for TestRecorderThreadGuard {
    fn drop(&mut self) {
        if let Some(owners) = TEST_RECORDER_OWNERS
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_mut()
        {
            owners.retain(|owner| owner != &self.0);
        }
    }
}

#[cfg(any(test, feature = "test-support"))]
impl Drop for TestRecorderGuard {
    fn drop(&mut self) {
        if let Some(previous) = self.previous.take() {
            *GLOBAL_RECORDER
                .write()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = previous;
        }
        *TEST_RECORDER_OWNERS
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = self.previous_owners.take();
    }
}

#[cfg(any(test, feature = "test-support"))]
pub fn install_test_recorder(recorder: TelemetryRecorder) -> TestRecorderGuard {
    let previous_owners = TEST_RECORDER_OWNERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .replace(vec![std::thread::current().id()]);
    let previous = std::mem::replace(
        &mut *GLOBAL_RECORDER
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner),
        recorder,
    );
    TestRecorderGuard {
        previous: Some(previous),
        previous_owners,
    }
}

/// Admit a spawned test thread to the currently installed recorder without
/// accepting unrelated parallel-test traffic.
#[cfg(any(test, feature = "test-support"))]
pub fn register_test_recorder_thread() -> TestRecorderThreadGuard {
    let id = std::thread::current().id();
    if let Some(owners) = TEST_RECORDER_OWNERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_mut()
    {
        owners.push(id);
    }
    TestRecorderThreadGuard(id)
}

thread_local! {
    static STORE_CORRELATION: RefCell<Vec<Correlation>> = const { RefCell::new(Vec::new()) };
}

struct StoreCorrelationScope;

impl StoreCorrelationScope {
    fn push(correlation: Correlation) -> Self {
        STORE_CORRELATION.with(|stack| stack.borrow_mut().push(correlation));
        Self
    }
}

impl Drop for StoreCorrelationScope {
    fn drop(&mut self) {
        STORE_CORRELATION.with(|stack| {
            stack.borrow_mut().pop();
        });
    }
}

fn current_store_correlation() -> Correlation {
    STORE_CORRELATION.with(|stack| stack.borrow().last().cloned().unwrap_or_default())
}

fn duration_us(duration: Duration) -> u64 {
    duration.as_micros().try_into().unwrap_or(u64::MAX)
}

pub fn store_error_identity(error: &(dyn Error + 'static)) -> Option<StoreErrorIdentity> {
    let mut current = Some(error);
    while let Some(cause) = current {
        if let Some(rusqlite::Error::SqliteFailure(code, _)) =
            cause.downcast_ref::<rusqlite::Error>()
        {
            return Some(StoreErrorIdentity::sqlite(
                code.extended_code & 0xff,
                code.extended_code,
            ));
        }
        current = cause.source();
    }
    None
}

pub fn observe_store<T>(
    operation: StoreOperation,
    correlation: Correlation,
    action: impl FnOnce() -> Result<T>,
) -> Result<T> {
    let started = Instant::now();
    let _scope = StoreCorrelationScope::push(correlation.clone());
    let _queue = PersistenceActivityGuard::start(correlation.clone());
    let result = action();
    let error = result
        .as_ref()
        .err()
        .and_then(|error| store_error_identity(error.as_ref()));
    let outcome = if result.is_err() {
        TelemetryOutcome::Error
    } else {
        TelemetryOutcome::Ok
    };
    emit_store_duration(operation, correlation, started.elapsed(), outcome, error);
    result
}

pub fn emit_store_duration(
    operation: StoreOperation,
    correlation: Correlation,
    duration: Duration,
    outcome: TelemetryOutcome,
    error: Option<StoreErrorIdentity>,
) {
    global_record(Observation {
        name: TelemetryName::StoreOperationDuration,
        kind: TelemetryKind::Span,
        operation: Some(operation),
        activity: None,
        route: None,
        outcome: Some(outcome),
        duration_us: Some(duration_us(duration)),
        value: None,
        pid: None,
        cpu_time_us: None,
        resident_memory_bytes: None,
        error,
        correlation,
    });
}

pub fn sqlite_profile(sql: &str, duration: Duration) {
    let sql = sql.trim_start();
    let operation = if starts_with_ascii_case(sql, "BEGIN") {
        Some(StoreOperation::Transaction)
    } else if starts_with_ascii_case(sql, "COMMIT") {
        Some(StoreOperation::Commit)
    } else if starts_with_ascii_case(sql, "PRAGMA WAL_CHECKPOINT") {
        Some(StoreOperation::Checkpoint)
    } else {
        None
    };
    if let Some(operation) = operation {
        emit_store_duration(
            operation,
            current_store_correlation(),
            duration,
            TelemetryOutcome::Ok,
            None,
        );
    }
}

fn starts_with_ascii_case(value: &str, prefix: &str) -> bool {
    value
        .get(..prefix.len())
        .is_some_and(|value| value.eq_ignore_ascii_case(prefix))
}

pub fn emit_connection_counts(process: usize, store: usize, correlation: Correlation) {
    for (route, value) in [("process", process), ("store", store)] {
        global_record(Observation {
            name: TelemetryName::StoreConnectionActive,
            kind: TelemetryKind::Gauge,
            operation: None,
            activity: None,
            route: Some(route.to_string()),
            outcome: None,
            duration_us: None,
            value: Some(value.try_into().unwrap_or(u64::MAX)),
            pid: None,
            cpu_time_us: None,
            resident_memory_bytes: None,
            error: None,
            correlation: correlation.clone(),
        });
    }
}

static ACTIVE_PERSISTENCE: AtomicUsize = AtomicUsize::new(0);
static ACTIVE_ORCHESTRATORS: AtomicUsize = AtomicUsize::new(0);
static ACTIVE_WORKERS: AtomicUsize = AtomicUsize::new(0);
static ACTIVE_CHILD_PROCESSES: AtomicUsize = AtomicUsize::new(0);

struct PersistenceActivityGuard {
    correlation: Correlation,
    active: bool,
}

impl PersistenceActivityGuard {
    fn start(correlation: Correlation) -> Self {
        let active = STORE_CORRELATION.with(|stack| stack.borrow().len() == 1);
        if !active {
            return Self {
                correlation,
                active: false,
            };
        }
        let active = ACTIVE_PERSISTENCE.fetch_add(1, Ordering::Relaxed) + 1;
        emit_active(
            TelemetryName::PersistenceQueueActive,
            None,
            active,
            correlation.clone(),
        );
        Self {
            correlation,
            active: true,
        }
    }
}

impl Drop for PersistenceActivityGuard {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        let active = ACTIVE_PERSISTENCE.fetch_sub(1, Ordering::Relaxed) - 1;
        emit_active(
            TelemetryName::PersistenceQueueActive,
            None,
            active,
            self.correlation.clone(),
        );
    }
}

pub struct RuntimeActivityGuard {
    activity: RuntimeActivity,
    correlation: Correlation,
}

impl RuntimeActivityGuard {
    pub fn start(activity: RuntimeActivity, correlation: Correlation) -> Self {
        let active = activity_counter(activity).fetch_add(1, Ordering::Relaxed) + 1;
        emit_active(
            TelemetryName::RuntimeActivityActive,
            Some(activity),
            active,
            correlation.clone(),
        );
        emit_resource_sample(correlation.clone(), None);
        Self {
            activity,
            correlation,
        }
    }
}

impl Drop for RuntimeActivityGuard {
    fn drop(&mut self) {
        let active = activity_counter(self.activity).fetch_sub(1, Ordering::Relaxed) - 1;
        emit_active(
            TelemetryName::RuntimeActivityActive,
            Some(self.activity),
            active,
            self.correlation.clone(),
        );
        emit_resource_sample(self.correlation.clone(), None);
    }
}

pub struct ChildProcessGuard {
    pid: Option<u32>,
    correlation: Correlation,
}

impl ChildProcessGuard {
    pub fn start(pid: Option<u32>, correlation: Correlation) -> Self {
        let active = ACTIVE_CHILD_PROCESSES.fetch_add(1, Ordering::Relaxed) + 1;
        emit_active(
            TelemetryName::RuntimeActivityActive,
            Some(RuntimeActivity::ChildProcess),
            active,
            correlation.clone(),
        );
        emit_child_process(pid, TelemetryOutcome::Started, correlation.clone());
        emit_resource_sample(correlation.clone(), pid);
        Self { pid, correlation }
    }
}

impl Drop for ChildProcessGuard {
    fn drop(&mut self) {
        emit_child_process(
            self.pid,
            TelemetryOutcome::Stopped,
            self.correlation.clone(),
        );
        let active = ACTIVE_CHILD_PROCESSES.fetch_sub(1, Ordering::Relaxed) - 1;
        emit_active(
            TelemetryName::RuntimeActivityActive,
            Some(RuntimeActivity::ChildProcess),
            active,
            self.correlation.clone(),
        );
    }
}

fn activity_counter(activity: RuntimeActivity) -> &'static AtomicUsize {
    match activity {
        RuntimeActivity::Orchestrator => &ACTIVE_ORCHESTRATORS,
        RuntimeActivity::Worker => &ACTIVE_WORKERS,
        RuntimeActivity::ChildProcess => &ACTIVE_CHILD_PROCESSES,
    }
}

fn emit_active(
    name: TelemetryName,
    activity: Option<RuntimeActivity>,
    active: usize,
    correlation: Correlation,
) {
    global_record(Observation {
        name,
        kind: TelemetryKind::Gauge,
        operation: None,
        activity,
        route: None,
        outcome: None,
        duration_us: None,
        value: Some(active.try_into().unwrap_or(u64::MAX)),
        pid: None,
        cpu_time_us: None,
        resident_memory_bytes: None,
        error: None,
        correlation,
    });
}

fn emit_child_process(pid: Option<u32>, outcome: TelemetryOutcome, correlation: Correlation) {
    global_record(Observation {
        name: TelemetryName::ChildProcess,
        kind: TelemetryKind::Diagnostic,
        operation: None,
        activity: Some(RuntimeActivity::ChildProcess),
        route: None,
        outcome: Some(outcome),
        duration_us: None,
        value: None,
        pid,
        cpu_time_us: None,
        resident_memory_bytes: None,
        error: None,
        correlation,
    });
}

pub fn emit_http_duration(
    route: &str,
    correlation: Correlation,
    duration: Duration,
    outcome: TelemetryOutcome,
) {
    global_record(Observation {
        name: TelemetryName::HttpRequestDuration,
        kind: TelemetryKind::Span,
        operation: None,
        activity: None,
        route: Some(bounded_route(route)),
        outcome: Some(outcome),
        duration_us: Some(duration_us(duration)),
        value: None,
        pid: None,
        cpu_time_us: None,
        resident_memory_bytes: None,
        error: None,
        correlation,
    });
}

fn bounded_route(value: &str) -> String {
    if value.len() <= 160
        && value.starts_with('/')
        && value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'{' | b'}' | b'_' | b'-' | b'.')
        })
    {
        value.to_string()
    } else {
        "/other".to_string()
    }
}
