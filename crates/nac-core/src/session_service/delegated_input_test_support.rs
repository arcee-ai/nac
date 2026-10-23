//! Nonshipping deterministic observation of the terminal-but-finishing seam.
#![expect(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "private test barriers require intact test synchronization and a persisted fixture"
)]
use super::*;
use std::sync::LazyLock;
use tokio::sync::Notify;

type ReleaseBarrier = (Arc<Notify>, Arc<Notify>, Arc<Notify>);
static RELEASE_BARRIERS: LazyLock<StdMutex<HashMap<String, ReleaseBarrier>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

impl SessionService {
    /// Returns (terminal committed, input awaiting release, release permission).
    /// Only test builds contain this per-session, one-shot barrier.
    pub fn hold_next_child_terminal_release_for_test(&self) -> ReleaseBarrier {
        let barrier = (
            Arc::new(Notify::new()),
            Arc::new(Notify::new()),
            Arc::new(Notify::new()),
        );
        RELEASE_BARRIERS.lock().unwrap().insert(
            self.metadata
                .session_id
                .clone()
                .expect("persisted test session"),
            barrier.clone(),
        );
        barrier
    }

    pub(super) fn observe_child_input_handoff_for_test(&self) {
        if let Some(id) = self.metadata.session_id.as_deref() {
            if let Some((_, waiting, _)) = RELEASE_BARRIERS.lock().unwrap().get(id) {
                waiting.notify_one();
            }
        }
    }

    pub(super) async fn wait_child_terminal_release_for_test(&self) {
        let Some(id) = self.metadata.session_id.as_deref() else {
            return;
        };
        let barrier = RELEASE_BARRIERS.lock().unwrap().get(id).cloned();
        if let Some((arrived, _, release)) = barrier {
            arrived.notify_one();
            release.notified().await;
            RELEASE_BARRIERS.lock().unwrap().remove(id);
        }
    }
}
