use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_TEMP_PATH: AtomicU64 = AtomicU64::new(0);

/// Returns a unique, nonexistent path; callers retain creation and cleanup ownership.
pub(crate) fn temp_store_path(label: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    let sequence = NEXT_TEMP_PATH.fetch_add(1, Ordering::Relaxed);

    std::env::temp_dir()
        .join(format!(
            "nac_core_test_{label}_{}_{timestamp}_{sequence}",
            std::process::id()
        ))
        .join("store.db")
}
