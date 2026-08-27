//! Protocol-independent control seam for orchestrator sessions managed by a
//! direct-with-orchestrator parent.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use anyhow::{anyhow, Result};
use futures_util::future::BoxFuture;

use crate::store::{ManagedOrchestratorExecutionMode, ManagedOrchestratorRecord};

pub type OrchestrationFuture<'a, T> = BoxFuture<'a, Result<T>>;

#[derive(Debug, Clone)]
pub struct ManagedOrchestratorStartRequest {
    pub parent_session_id: String,
    pub orchestrator_session_id: Option<String>,
    pub description: String,
    pub prompt: String,
    pub execution_mode: ManagedOrchestratorExecutionMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManagedOrchestratorReadKind {
    Messages,
    Episodes,
    Events,
}

pub trait OrchestrationController: Send + Sync + 'static {
    fn start<'a>(
        &'a self,
        request: ManagedOrchestratorStartRequest,
    ) -> OrchestrationFuture<'a, ManagedOrchestratorRecord>;

    fn wait<'a>(
        &'a self,
        orchestrator_session_id: &'a str,
        generation: u64,
    ) -> OrchestrationFuture<'a, ManagedOrchestratorRecord>;

    fn steer<'a>(
        &'a self,
        parent_session_id: &'a str,
        orchestrator_session_id: &'a str,
        instruction: &'a str,
        thread_name: Option<&'a str>,
    ) -> OrchestrationFuture<'a, ManagedOrchestratorRecord>;

    fn read<'a>(
        &'a self,
        parent_session_id: &'a str,
        orchestrator_session_id: &'a str,
        kind: ManagedOrchestratorReadKind,
        limit: usize,
    ) -> OrchestrationFuture<'a, serde_json::Value>;

    fn cancel<'a>(
        &'a self,
        parent_session_id: &'a str,
        orchestrator_session_id: &'a str,
    ) -> OrchestrationFuture<'a, ManagedOrchestratorRecord>;

    fn wake<'a>(&'a self, session_id: &'a str) -> OrchestrationFuture<'a, ()>;
}

static CONTROLLERS: LazyLock<Mutex<HashMap<PathBuf, Arc<dyn OrchestrationController>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn register_controller(path: PathBuf, controller: Arc<dyn OrchestrationController>) {
    CONTROLLERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(path, controller);
}

#[doc(hidden)]
pub fn controller_for(path: &Path) -> Result<Arc<dyn OrchestrationController>> {
    CONTROLLERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(path)
        .cloned()
        .ok_or_else(|| anyhow!("internal orchestrator session control is unavailable"))
}
