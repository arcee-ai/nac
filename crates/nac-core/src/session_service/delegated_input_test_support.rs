//! Nonshipping deterministic observation of the terminal-but-finishing seam.
#![expect(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "private test barriers require intact test synchronization and a persisted fixture"
)]
use super::*;
use std::collections::HashSet;
use std::sync::LazyLock;
use tokio::sync::Notify;

type ReleaseBarrier = (Arc<Notify>, Arc<Notify>, Arc<Notify>);
static RELEASE_BARRIERS: LazyLock<StdMutex<HashMap<String, ReleaseBarrier>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

static REJECT_INBOX_ADMISSION: LazyLock<StdMutex<HashSet<(std::path::PathBuf, String)>>> =
    LazyLock::new(|| StdMutex::new(HashSet::new()));

static LOSE_ENQUEUE_ACK: LazyLock<StdMutex<HashSet<(std::path::PathBuf, String)>>> =
    LazyLock::new(|| StdMutex::new(HashSet::new()));

impl SessionService {
    /// Inject one definite persistence rejection at the queued-input boundary.
    #[doc(hidden)]
    pub fn reject_next_child_inbox_admission_for_test(&self) {
        let session = self
            .metadata
            .session_id
            .clone()
            .expect("persisted test session");
        REJECT_INBOX_ADMISSION
            .lock()
            .unwrap()
            .insert((self.metadata.store_path.clone(), session));
    }

    pub(super) fn take_child_inbox_admission_rejection_for_test(&self) -> bool {
        self.metadata.session_id.as_ref().is_some_and(|session| {
            REJECT_INBOX_ADMISSION
                .lock()
                .unwrap()
                .remove(&(self.metadata.store_path.clone(), session.clone()))
        })
    }

    /// Inject one acknowledgement loss after a child input is committed.
    #[doc(hidden)]
    pub fn lose_next_child_enqueue_ack_for_test(&self) {
        let session = self
            .metadata
            .session_id
            .clone()
            .expect("persisted test session");
        LOSE_ENQUEUE_ACK
            .lock()
            .unwrap()
            .insert((self.metadata.store_path.clone(), session));
    }

    pub(super) fn take_child_enqueue_ack_loss_for_test(&self) -> bool {
        self.metadata.session_id.as_ref().is_some_and(|session| {
            LOSE_ENQUEUE_ACK
                .lock()
                .unwrap()
                .remove(&(self.metadata.store_path.clone(), session.clone()))
        })
    }

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
