//! Private numeric diagnostic only. No payloads, new await, cache, or authority.
use std::io::Write;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;
use std::time::Instant;
use uuid::Uuid;

const LIMIT: usize = 2048;
static COUNT: AtomicUsize = AtomicUsize::new(0);
static ENABLED: OnceLock<bool> = OnceLock::new();
static ORIGIN: OnceLock<Instant> = OnceLock::new();

pub(crate) fn phase(observer: Uuid, cursor: u64, name: &'static str, started: Instant) {
    if !*ENABLED.get_or_init(|| std::env::var("NAC_TERMINAL_PHASE_PROFILE").as_deref() == Ok("1")) {
        return;
    }
    let seq = COUNT.fetch_add(1, Ordering::Relaxed);
    if seq > LIMIT {
        return;
    }
    let record = if seq == LIMIT {
        serde_json::json!({"schema":1,"side":"server","phase":"truncated","seq":seq})
    } else {
        serde_json::json!({"schema":1,"side":"server","phase":name,"seq":seq,
            "at_us":ORIGIN.get_or_init(Instant::now).elapsed().as_micros().min(u128::from(u64::MAX)) as u64,
            "elapsed_us":started.elapsed().as_micros().min(u128::from(u64::MAX)) as u64,
            "observer":observer.to_string(),"cursor":cursor.to_string()})
    };
    let _ = writeln!(std::io::stderr().lock(), "NAC_TERMINAL_PHASE {record}");
}
