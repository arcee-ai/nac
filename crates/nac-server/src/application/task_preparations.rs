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
}

impl TaskPreparations {
    pub(crate) async fn admit(&self) -> Result<OwnedRwLockReadGuard<()>> {
        self.git.check_running()?;
        let guard = Arc::clone(&self.work).read_owned().await;
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
        let _settled = self.work.write().await;
    }
}
