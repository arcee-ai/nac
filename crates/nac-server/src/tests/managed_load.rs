use super::*;
#[path = "managed_load/direct_acceptance.rs"]
pub(super) mod direct_acceptance;
#[path = "managed_load/direct_candidate.rs"]
mod direct_candidate;
#[cfg(all(unix, feature = "managed-fault-fixture"))]
#[path = "managed_load/direct_candidate_fault.rs"]
mod direct_candidate_fault;
#[path = "managed_load/direct_faults.rs"]
mod direct_faults;
#[path = "managed_load/direct_model.rs"]
mod direct_model;
#[path = "managed_load/probes.rs"]
mod probes;
#[path = "managed_load/telemetry_evidence.rs"]
mod telemetry_evidence;
use probes::{probe_pair, ProbeSample};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use telemetry_evidence::drain_telemetry;
const DEFAULT_SEED: u64 = 0xA11_0112;
const VARIANTS: [usize; 3] = [1, 2, 4];
const PHASE_TIMEOUT: Duration = Duration::from_secs(20);
const PROBE_SETTLEMENT_TIMEOUT: Duration = Duration::from_secs(5);
struct PhaseGate {
    expected: usize,
    state: Mutex<PhaseGateState>,
    ready: Condvar,
}
struct CompletionGate {
    enabled: bool,
    next_ordinal: Mutex<usize>,
    released: std::sync::atomic::AtomicBool,
    ready: Condvar,
}
impl CompletionGate {
    fn new(enabled: bool) -> Self {
        Self {
            enabled,
            next_ordinal: Mutex::new(0),
            released: std::sync::atomic::AtomicBool::new(false),
            ready: Condvar::new(),
        }
    }

    fn wait_for_turn(&self, ordinal: usize) {
        if !self.enabled {
            return;
        }
        let deadline = Instant::now() + PHASE_TIMEOUT;
        let mut next = self.next_ordinal.lock().unwrap();
        while *next != ordinal && !self.released.load(std::sync::atomic::Ordering::SeqCst) {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .expect("managed completion ordering timed out");
            let (guard, timeout) = self.ready.wait_timeout(next, remaining).unwrap();
            next = guard;
            assert!(
                !timeout.timed_out(),
                "managed completion ordering timed out"
            );
        }
    }

    fn advance(&self) {
        if !self.enabled {
            return;
        }
        let mut next = self.next_ordinal.lock().unwrap();
        *next += 1;
        self.ready.notify_all();
    }

    fn release_all(&self) {
        let _next = self
            .next_ordinal
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.released
            .store(true, std::sync::atomic::Ordering::SeqCst);
        self.ready.notify_all();
    }
}

struct PhaseGateState {
    arrived: usize,
    released: bool,
}
impl PhaseGate {
    fn new(expected: usize) -> Self {
        Self {
            expected,
            state: Mutex::new(PhaseGateState {
                arrived: 0,
                released: false,
            }),
            ready: Condvar::new(),
        }
    }

    fn arrive_and_wait(&self, label: &str) {
        let deadline = Instant::now() + PHASE_TIMEOUT;
        let mut state = self.state.lock().unwrap();
        state.arrived += 1;
        self.ready.notify_all();
        while !state.released {
            let remaining = deadline.saturating_duration_since(Instant::now());
            assert!(!remaining.is_zero(), "timed out at {label} barrier");
            let (next, timeout) = self.ready.wait_timeout(state, remaining).unwrap();
            state = next;
            assert!(!timeout.timed_out(), "timed out at {label} barrier");
        }
    }

    fn wait_until_ready(&self, label: &str) {
        self.wait_until_arrived(self.expected, label);
    }

    fn wait_until_arrived(&self, expected_arrivals: usize, label: &str) {
        let deadline = Instant::now() + PHASE_TIMEOUT;
        let mut state = self.state.lock().unwrap();
        while state.arrived < expected_arrivals {
            let remaining = deadline.saturating_duration_since(Instant::now());
            assert!(!remaining.is_zero(), "timed out waiting for {label}");
            let (next, timeout) = self.ready.wait_timeout(state, remaining).unwrap();
            state = next;
            assert!(!timeout.timed_out(), "timed out waiting for {label}");
        }
    }

    fn release(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.released = true;
        self.ready.notify_all();
    }
}

#[derive(Clone, Debug, Serialize)]
struct ModelRequest {
    phase: &'static str,
    ordinal: Option<usize>,
}

fn read_http_body(stream: &mut TcpStream) -> Vec<u8> {
    stream
        .set_read_timeout(Some(PHASE_TIMEOUT))
        .expect("set request read timeout");
    let mut request = Vec::new();
    let mut buffer = [0_u8; 4096];
    let header_end = loop {
        let read = stream
            .read(&mut buffer)
            .expect("read deterministic request");
        assert!(read > 0, "model request ended before headers");
        request.extend_from_slice(&buffer[..read]);
        if let Some(position) = request.windows(4).position(|window| window == b"\r\n\r\n") {
            break position + 4;
        }
        assert!(
            request.len() < 128 * 1024,
            "model request headers too large"
        );
    };
    let headers = String::from_utf8_lossy(&request[..header_end]);
    let content_length = headers
        .lines()
        .find_map(|line| {
            line.split_once(':')
                .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                .and_then(|(_, value)| value.trim().parse::<usize>().ok())
        })
        .expect("model request content-length");
    while request.len() - header_end < content_length {
        let read = stream.read(&mut buffer).expect("read deterministic body");
        assert!(read > 0, "model request ended before body");
        request.extend_from_slice(&buffer[..read]);
    }
    request[header_end..header_end + content_length].to_vec()
}

fn text_response(text: &str) -> String {
    serde_json::json!({
        "status": "completed",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
    })
    .to_string()
}

fn tool_response(call_id: &str, name: &str, arguments: &str) -> String {
    serde_json::json!({
        "status": "completed",
        "output": [{
            "type": "function_call",
            "call_id": call_id,
            "name": name,
            "arguments": arguments,
        }],
        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
    })
    .to_string()
}

fn write_http_json(stream: &mut TcpStream, body: &str) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()
}

pub(super) trait LoadStoreAdapter {
    fn identity(&self) -> &'static str;
    fn create_direct_manager_async<'a>(
        &'a self,
        root: &'a Path,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = SessionManager> + 'a>> {
        Box::pin(async move {
            SessionManager::new_unowned_fixture(ServerOptions {
                root_cwd: root.to_path_buf(),
                store_path: Some(root.join("store.db")),
                worker_executable: None,
                managed_host: None,
            })
            .expect("direct-load session manager")
        })
    }
    fn assert_integrity(&self, store_path: &Path);
    fn configuration(&self, store_path: &Path) -> StoreConfiguration;
    fn checkpoint(&self, store_path: &Path) -> CheckpointEvidence;
}

pub(super) struct SqliteLoadStore;

impl LoadStoreAdapter for SqliteLoadStore {
    fn identity(&self) -> &'static str {
        "sqlite-wal"
    }

    fn assert_integrity(&self, store_path: &Path) {
        let connection = rusqlite::Connection::open(store_path).unwrap();
        let quick_check: String = connection
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .unwrap();
        assert_eq!(quick_check, "ok");
        let foreign_key_errors: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(foreign_key_errors, 0);
        let journal_mode: String = connection
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(journal_mode.to_ascii_lowercase(), "wal");
    }

    fn configuration(&self, store_path: &Path) -> StoreConfiguration {
        let connection = rusqlite::Connection::open(store_path).unwrap();
        StoreConfiguration {
            engine: "sqlite",
            journal_mode: connection
                .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
                .unwrap(),
            synchronous: connection
                .query_row("PRAGMA synchronous", [], |row| row.get(0))
                .unwrap(),
            mmap_size: connection
                .query_row("PRAGMA mmap_size", [], |row| row.get(0))
                .unwrap(),
            schema_version: connection
                .query_row("PRAGMA user_version", [], |row| row.get(0))
                .unwrap(),
            page_count: connection
                .query_row("PRAGMA page_count", [], |row| row.get(0))
                .unwrap(),
            page_size: connection
                .query_row("PRAGMA page_size", [], |row| row.get(0))
                .unwrap(),
            database_bytes: file_size(store_path),
            wal_bytes: file_size(&PathBuf::from(format!("{}-wal", store_path.display()))),
            shm_bytes: file_size(&PathBuf::from(format!("{}-shm", store_path.display()))),
        }
    }

    fn checkpoint(&self, store_path: &Path) -> CheckpointEvidence {
        let connection = rusqlite::Connection::open(store_path).unwrap();
        let started = Instant::now();
        let (busy, log_frames, checkpointed_frames) = connection
            .query_row("PRAGMA wal_checkpoint(PASSIVE)", [], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .unwrap();
        let duration = started.elapsed();
        assert_eq!(busy, 0, "passive checkpoint must not remain busy");
        nac_core::telemetry::emit_store_duration(
            nac_core::telemetry::StoreOperation::Checkpoint,
            nac_core::telemetry::Correlation::default(),
            duration,
            nac_core::telemetry::TelemetryOutcome::Ok,
            None,
        );
        CheckpointEvidence {
            busy,
            log_frames,
            checkpointed_frames,
            duration_us: duration.as_micros(),
        }
    }
}

fn file_size(path: &Path) -> u64 {
    std::fs::metadata(path).map_or(0, |metadata| metadata.len())
}

#[derive(Serialize)]
pub(super) struct StoreConfiguration {
    engine: &'static str,
    journal_mode: String,
    synchronous: i64,
    mmap_size: i64,
    schema_version: i64,
    page_count: i64,
    page_size: i64,
    database_bytes: u64,
    wal_bytes: u64,
    shm_bytes: u64,
}

#[derive(Serialize)]
pub(super) struct CheckpointEvidence {
    busy: i64,
    log_frames: i64,
    checkpointed_frames: i64,
    duration_us: u128,
}

#[derive(Default, Serialize)]
struct LatencyDistribution {
    count: usize,
    min: u64,
    p50: u64,
    p95: u64,
    max: u64,
}

impl LatencyDistribution {
    fn from_values(mut values: Vec<u64>) -> Self {
        if values.is_empty() {
            return Self::default();
        }
        values.sort_unstable();
        let percentile = |numerator: usize| {
            let index = (values.len().saturating_sub(1) * numerator) / 100;
            values[index]
        };
        Self {
            count: values.len(),
            min: values[0],
            p50: percentile(50),
            p95: percentile(95),
            max: *values.last().unwrap(),
        }
    }
}

#[derive(Serialize)]
struct TelemetryEvidence {
    store_latency_us: BTreeMap<String, LatencyDistribution>,
    api_latency_us: BTreeMap<String, LatencyDistribution>,
    max_connection_active: u64,
    max_persistence_queue_active: u64,
    max_orchestrators_active: u64,
    max_direct_active: u64,
    max_terminal_settlement_overlap: usize,
    max_child_processes_active: u64,
    child_process_started: BTreeSet<u32>,
    child_process_stopped: BTreeSet<u32>,
    max_cpu_time_us: u64,
    max_resident_memory_bytes: u64,
    accepted: u64,
    dropped: u64,
    exported: u64,
    failures: u64,
}

pub(super) fn write_secret_safe_artifact(path: &Path, value: &impl Serialize) {
    let bytes = serde_json::to_vec_pretty(value).unwrap();
    let secret = "all612-direct-fixture-key";
    assert!(
        !bytes
            .windows(secret.len())
            .any(|window| window == secret.as_bytes()),
        "artifact contains an injected API credential"
    );
    std::fs::write(path, bytes).unwrap();
}
