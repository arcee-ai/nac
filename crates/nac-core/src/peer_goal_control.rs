//! Narrow inward port for native peer goal mutations. The server composes the
//! existing target lifecycle; the tool issues this opaque invocation only after
//! ordinary policy and an exact explicit human reply.
use anyhow::{anyhow, Result};
use futures_util::future::BoxFuture;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

#[derive(Debug)]
pub enum PeerGoalError {
    Conflict(&'static str),
    Unavailable(&'static str),
}
impl std::fmt::Display for PeerGoalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Conflict(detail) => write!(f, "conflict: {detail}"),
            Self::Unavailable(detail) => write!(f, "unavailable: {detail}"),
        }
    }
}
impl std::error::Error for PeerGoalError {}

#[derive(Debug, Clone)]
pub(crate) enum PeerGoalAction {
    Start {
        request_id: String,
        objective: String,
        token_budget: Option<u64>,
    },
    Pause {
        goal_id: String,
        expected_version: i64,
    },
    Resume {
        goal_id: String,
        expected_version: i64,
    },
}

/// No deserializable or public constructor. Human product intent does not
/// construct this capability, and cannot bypass native policy.
pub struct AuthorizedPeerGoal {
    pub(crate) caller: String,
    pub(crate) target: String,
    pub(crate) project: Option<String>,
    pub(crate) action: PeerGoalAction,
}
impl AuthorizedPeerGoal {
    pub fn caller(&self) -> &str {
        &self.caller
    }
    pub fn target(&self) -> &str {
        &self.target
    }
    pub fn project(&self) -> Option<&str> {
        self.project.as_deref()
    }
    pub(crate) fn start_request(&self) -> Option<crate::store::PeerGoalStart> {
        match &self.action {
            PeerGoalAction::Start {
                request_id,
                objective,
                token_budget,
            } => Some(crate::store::PeerGoalStart {
                caller_session_id: self.caller.clone(),
                request_id: request_id.clone(),
                target_session_id: self.target.clone(),
                project_id: self.project.clone(),
                objective: objective.clone(),
                token_budget: *token_budget,
            }),
            _ => None,
        }
    }
    /// Read-only receipt reconciliation before target attachment/lease checks.
    pub async fn replay_start(
        &self,
        path: &Path,
    ) -> Result<Option<crate::store::PeerGoalStartReceipt>> {
        let Some(request) = self.start_request() else {
            return Ok(None);
        };
        let path = path.to_owned();
        crate::store::spawn_blocking_store_caller(move || {
            crate::store::peer_goals::lookup_peer_goal_start(&path, &request)
        })
        .await?
    }
    pub(crate) fn action(&self) -> &PeerGoalAction {
        &self.action
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum PeerGoalOutcome {
    Started {
        receipt: crate::store::PeerGoalStartReceipt,
    },
    Replayed {
        receipt: crate::store::PeerGoalStartReceipt,
    },
    Paused {
        goal: crate::store::SessionGoalRecord,
    },
    Resumed {
        goal: crate::store::SessionGoalRecord,
    },
}

pub type PeerGoalFuture<'a, T> = BoxFuture<'a, Result<T>>;

pub trait PeerGoalController: Send + Sync + 'static {
    fn control<'a>(&'a self, request: AuthorizedPeerGoal) -> PeerGoalFuture<'a, PeerGoalOutcome>;
}
static CONTROLLERS: LazyLock<Mutex<HashMap<PathBuf, Arc<dyn PeerGoalController>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
pub fn register_controller(path: PathBuf, controller: Arc<dyn PeerGoalController>) {
    CONTROLLERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(path, controller);
}
pub(crate) fn controller_for(path: &Path) -> Result<Arc<dyn PeerGoalController>> {
    CONTROLLERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(path)
        .cloned()
        .ok_or_else(|| anyhow!("unavailable: peer goal lifecycle owner is unavailable"))
}
