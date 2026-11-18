//! Serving-lifetime ownership for accepted retained-task effects, before a
//! SessionService exists. The read guard outlives the HTTP response/waiter.
use anyhow::Result;
use nac_core::workspace::task_worktree::TaskGit;
use std::sync::Arc;
use tokio::sync::{OwnedRwLockReadGuard, RwLock};

#[derive(Default)]
pub(crate) struct TaskPreparations {
    work: Arc<RwLock<()>>,
    pub(crate) git: TaskGit,
    #[cfg(test)]
    pub(crate) native_failure_before_receipt:
        std::sync::Mutex<Option<Arc<super::session_creation::CreationProjectionGate>>>,
    #[cfg(test)]
    pub(crate) source_resolution:
        std::sync::Mutex<Option<Arc<super::session_creation::CreationProjectionGate>>>,
    #[cfg(test)]
    pub(crate) scheduled_handoff:
        std::sync::Mutex<Option<Arc<super::session_creation::CreationProjectionGate>>>,
    #[cfg(test)]
    pub(crate) initial_input_wake:
        std::sync::Mutex<Option<Arc<super::session_creation::CreationProjectionGate>>>,
}

impl TaskPreparations {
    pub(crate) async fn admit(&self) -> Result<OwnedRwLockReadGuard<()>> {
        self.git.check_running()?;
        let guard = Arc::clone(&self.work).read_owned().await;
        self.git.check_running()?;
        Ok(guard)
    }

    /// Reserve a serving-lifetime effect without waiting behind shutdown.
    pub(crate) fn try_admit(&self) -> Result<OwnedRwLockReadGuard<()>> {
        self.git.check_running()?;
        let guard = Arc::clone(&self.work)
            .try_read_owned()
            .map_err(|_| anyhow::anyhow!("task preparation is stopping"))?;
        self.git.check_running()?;
        Ok(guard)
    }

    pub(crate) fn stop(&self) {
        self.git.stop();
    }

    pub(crate) fn is_stopping(&self) -> bool {
        self.git.check_running().is_err()
    }

    pub(crate) async fn settle(&self) {
        // Every accepted future owns a reader through Git cleanup, store ack,
        // service publication and any error receipt. No new reader can start
        // work once stop() has raised the admission fence.
        loop {
            if self.is_stopping() {
                let _settled = self.work.write().await;
                return;
            }
            // A live drain must not queue a writer ahead of work already
            // admitted by a reader: that work can transfer its obligation to
            // a continuation reader before it releases the original guard.
            // While live this observes eventual quiescence, not a bounded fence.
            if let Ok(_settled) = self.work.try_write() {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(1)).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::TaskPreparations;
    use std::time::Duration;

    #[tokio::test]
    async fn live_settlement_allows_an_admitted_effect_to_transfer_ownership() {
        let preparations = TaskPreparations::default();
        let original = preparations.admit().await.unwrap();
        let drain = preparations.settle();
        tokio::pin!(drain);
        tokio::select! {
            biased;
            _ = &mut drain => panic!("settlement finished while work was admitted"),
            _ = tokio::task::yield_now() => {}
        }
        let continuation = preparations.try_admit().unwrap();
        drop(original);
        tokio::select! {
            biased;
            _ = &mut drain => panic!("settlement lost the transferred obligation"),
            _ = tokio::task::yield_now() => {}
        }
        drop(continuation);
        tokio::time::timeout(Duration::from_secs(1), &mut drain)
            .await
            .unwrap();
        preparations.stop();
        assert!(preparations.try_admit().is_err());
    }
}
