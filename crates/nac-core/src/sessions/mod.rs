use std::collections::{BTreeMap, HashSet};
use std::fmt;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::light_model::LightModelSettings;
use crate::model::{BackendKind, ReasoningEffort};
use crate::sandbox::{SandboxBackendType, SandboxSpec, SshConnection};
use crate::types::Message;

mod codec;
mod db;
mod operation_lease;
mod snapshot;
mod summary;

pub use db::MALFORMED_LIGHT_MODEL_DIAGNOSTIC;
pub use db::{
    create_session, delete_session, increment_run_count, list_sessions, load_last_session,
    load_session, load_session_config, reorder_sessions, save_session, save_session_run_state,
    session_exists, update_raw_session_config, update_session_config, update_session_presentation,
};
pub(crate) use db::{
    insert_new_session_in_transaction, list_sessions_with_connection, load_session_run_state,
};
pub use operation_lease::{
    SessionOperationLease, SessionOperationLeaseError, SessionOperationLeaseValidationError,
    SessionRelationshipLease, SessionResourceLease, SessionResourceMutationLease,
    WorkspaceActivityLease, WorkspaceMutationLease,
};
// Compatibility aliases for callers that have not yet adopted operation-wide naming.
pub type SessionRunLease = SessionOperationLease;
pub type SessionRunLeaseError = SessionOperationLeaseError;
pub use snapshot::{new_snapshot, refresh_snapshot, SessionRunState, SessionRunStateUpdate};

pub(crate) async fn load_session_async(
    path: PathBuf,
    session_id: String,
) -> Result<SessionSnapshot> {
    tokio::task::spawn_blocking(move || load_session(&path, &session_id))
        .await
        .context("session load task failed")?
}

pub(crate) async fn load_last_session_async(path: PathBuf) -> Result<SessionSnapshot> {
    tokio::task::spawn_blocking(move || load_last_session(&path))
        .await
        .context("last-session load task failed")?
}

use codec::*;
pub(crate) use summary::{last_user_prompt, visible_message_count};

/// Immutable execution behavior selected when a top-level session is created.
/// Stored as text so future behaviors can fail closed instead of being
/// misinterpreted as the orchestrator.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum SessionBehavior {
    #[default]
    Orchestrator,
    Direct,
    DirectWithOrchestrator,
}

impl SessionBehavior {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Orchestrator => "orchestrator",
            Self::Direct => "direct",
            Self::DirectWithOrchestrator => "direct-with-orchestrator",
        }
    }

    /// Agent chats: `direct` and the compatibility alias `direct-with-orchestrator`.
    /// NAC (`orchestrator`) is not an agent.
    pub const fn is_agent(self) -> bool {
        matches!(self, Self::Direct | Self::DirectWithOrchestrator)
    }

    /// NAC planner chats. They use threads and worksets and never create sessions.
    pub const fn is_nac(self) -> bool {
        matches!(self, Self::Orchestrator)
    }

    /// New rows persist only `direct` or `orchestrator`.
    pub const fn for_create(self) -> Self {
        match self {
            Self::DirectWithOrchestrator => Self::Direct,
            other => other,
        }
    }
}

/// Fail-closed product rule: NAC plans through threads and worksets only.
pub const NAC_CANNOT_CREATE_SESSIONS: &str = "NAC sessions cannot create sessions";

impl fmt::Display for SessionBehavior {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl std::str::FromStr for SessionBehavior {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "orchestrator" => Ok(Self::Orchestrator),
            "direct" => Ok(Self::Direct),
            "direct-with-orchestrator" => Ok(Self::DirectWithOrchestrator),
            _ => Err(anyhow!("unsupported stored session behavior '{value}'")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct RawSessionConfig {
    pub session_id: String,
    pub model: String,
    pub base_url: String,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub backend: Option<String>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub reasoning_effort: Option<String>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub api_key_env: Option<String>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub extra_headers_json: Option<String>,
    /// Light worker model; `None` keeps single-model dispatch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub light_model: Option<LightModelSettings>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub orchestrator_compaction_threshold: Option<u64>,
    pub config_version: i64,
    /// Structural parse failures in the persisted values. These are diagnostics,
    /// not migrations: callers must explicitly PATCH every invalid value.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<String>,
}

#[derive(Debug)]
pub enum SessionConfigUpdateError {
    NotFound(String),
    Conflict(String),
    Store(anyhow::Error),
}

impl fmt::Display for SessionConfigUpdateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(message) | Self::Conflict(message) => formatter.write_str(message),
            Self::Store(error) => {
                write!(formatter, "session configuration storage failed: {error}")
            }
        }
    }
}

impl std::error::Error for SessionConfigUpdateError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Store(error) => Some(error.as_ref()),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for SessionConfigUpdateError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(error.into())
    }
}

impl From<anyhow::Error> for SessionConfigUpdateError {
    fn from(error: anyhow::Error) -> Self {
        Self::Store(error)
    }
}

/// In-memory session state; persistence uses the store path passed by the caller.
#[derive(Debug, Clone)]
pub struct SessionSnapshot {
    pub session_id: String,
    pub behavior: SessionBehavior,
    /// Explicit project association, stored authoritatively in `session_projects`.
    pub project_id: Option<String>,
    pub cwd: PathBuf,
    pub model: String,
    pub base_url: String,
    pub backend: BackendKind,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub sandbox_spec: Option<SandboxSpec>,
    /// How to reach the host of a remote session; `None` for local sessions.
    /// Persisted in full so resume reaches the same machine the same way,
    /// without depending on the ssh config of whoever restarts nac.
    pub ssh: Option<SshConnection>,
    /// Env var name used to resolve the API key at session creation time.
    /// Stored per-session so resume uses the same key source, not current config.
    pub api_key_env: Option<String>,
    /// Custom HTTP headers captured at session creation time.
    /// Stored per-session so resume uses the same headers, not current config.
    pub extra_headers: BTreeMap<String, String>,
    /// Light worker model; `None` keeps single-model dispatch.
    pub light_model: Option<LightModelSettings>,
    /// Absolute compaction threshold captured for this orchestrator session.
    /// `None` disables new checkpoint generation; valid stored checkpoints still project.
    pub orchestrator_compaction_threshold: Option<u64>,
    /// Monotonic revision for optimistic session-configuration updates.
    pub config_version: i64,
    pub messages: Vec<Message>,
    pub last_response_duration_ms: Option<u64>,
    pub previous_response_duration_ms: Option<u64>,
    pub response_durations_ms: Option<Vec<Option<u64>>>,
    /// Per-response token usage, one entry per assistant response (in order).
    pub token_usages: Vec<Option<crate::model::TokenUsage>>,
    /// Cumulative usage from billable runs that produced no visible response.
    /// Kept separate so `token_usages` remains correctly indexed by response.
    pub unattributed_token_usage: Option<crate::model::TokenUsage>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct SessionSummary {
    pub session_id: String,
    pub behavior: SessionBehavior,
    pub project_id: Option<String>,
    pub cwd: PathBuf,
    pub workspace_host_path: Option<PathBuf>,
    pub model: String,
    /// Raw persisted backend. Empty means the legacy row has no backend.
    pub backend: String,
    /// Per-row model configuration parse failure; listing remains available so
    /// the row can be selected and repaired.
    pub model_config_error: Option<String>,
    pub visible_message_count: usize,
    pub last_user_prompt: Option<String>,
    pub sandboxed: bool,
    /// How to reach the host of a remote session.
    pub ssh: Option<SshConnection>,
    pub title: Option<String>,
    pub pinned: bool,
    pub sort_order: i64,
    pub presentation_version: i64,
    pub created_at: String,
    pub updated_at: String,
    /// Billable tokens accumulated over the whole session, or `None` when no
    /// response ever reported usage.
    pub total_tokens: Option<u64>,
    /// Micro-USD spend accumulated over the session, or `None` when no response
    /// ever reported usage. Zero means the catalog had no rates for the model.
    pub total_cost_micros: Option<u64>,
    /// Number of runs ever started in this session.
    pub run_count: u64,
    /// Present when this chat was forked from another session.
    pub forked_from: Option<crate::store::SessionForkOrigin>,
}

#[derive(Debug)]
pub enum SessionPresentationError {
    InvalidInput(String),
    NotFound(String),
    Conflict(String),
    Busy(String),
    Store(anyhow::Error),
}

impl fmt::Display for SessionPresentationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput(message)
            | Self::NotFound(message)
            | Self::Conflict(message)
            | Self::Busy(message) => formatter.write_str(message),
            Self::Store(error) => write!(formatter, "session presentation storage failed: {error}"),
        }
    }
}

impl std::error::Error for SessionPresentationError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Store(error) => Some(error.as_ref()),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for SessionPresentationError {
    fn from(error: rusqlite::Error) -> Self {
        if matches!(
            error.sqlite_error_code(),
            Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked)
        ) {
            return Self::Busy("session presentation store is busy".to_string());
        }
        Self::Store(error.into())
    }
}

impl From<anyhow::Error> for SessionPresentationError {
    fn from(error: anyhow::Error) -> Self {
        let busy = error.chain().any(|cause| {
            cause
                .downcast_ref::<rusqlite::Error>()
                .is_some_and(|sqlite_error| {
                    matches!(
                        sqlite_error.sqlite_error_code(),
                        Some(
                            rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
                        )
                    )
                })
        });
        if busy {
            Self::Busy("session presentation store is busy".to_string())
        } else {
            Self::Store(error)
        }
    }
}

#[cfg(test)]
#[path = "facade_tests.rs"]
mod tests;
