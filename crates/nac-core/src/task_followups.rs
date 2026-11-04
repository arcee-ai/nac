//! Inward, action-specific port for authorized independent-task follow-up.
//! The server composes lifecycle attachment; model tools never call HTTP.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use crate::store::{TaskFollowupReceipt, TaskFollowupRequest};
use anyhow::{anyhow, Result};
use futures_util::future::BoxFuture;

pub type TaskFollowupFuture<'a> = BoxFuture<'a, Result<TaskFollowupReceipt>>;

pub trait TaskFollowupController: Send + Sync + 'static {
    /// The native kernel has authorized this exact action/target. Caller
    /// identity comes from runtime construction, never the peer's message.
    fn follow_up<'a>(&'a self, request: TaskFollowupRequest) -> TaskFollowupFuture<'a>;
}

static CONTROLLERS: LazyLock<Mutex<HashMap<PathBuf, Arc<dyn TaskFollowupController>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn register_controller(path: PathBuf, controller: Arc<dyn TaskFollowupController>) {
    CONTROLLERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(path, controller);
}

pub(crate) fn controller_for(path: &Path) -> Result<Arc<dyn TaskFollowupController>> {
    CONTROLLERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(path)
        .cloned()
        .ok_or_else(|| anyhow!("task follow-up control is unavailable"))
}
