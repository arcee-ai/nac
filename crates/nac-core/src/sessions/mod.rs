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

pub(crate) use db::list_sessions_with_connection;
pub use db::MALFORMED_LIGHT_MODEL_DIAGNOSTIC;
pub use db::{
    create_session, delete_session, increment_run_count, list_sessions, load_last_session,
    load_session, load_session_config, reorder_sessions, save_session, save_session_run_state,
    session_exists, update_raw_session_config, update_session_config, update_session_presentation,
};
pub use operation_lease::{
    SessionOperationLease, SessionOperationLeaseError, SessionOperationLeaseValidationError,
};
// Compatibility aliases for callers that have not yet adopted operation-wide naming.
pub type SessionRunLease = SessionOperationLease;
pub type SessionRunLeaseError = SessionOperationLeaseError;
pub use snapshot::{new_snapshot, refresh_snapshot, SessionRunState, SessionRunStateUpdate};

use codec::*;
pub(crate) use summary::{last_user_prompt, visible_message_count};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct RawSessionConfig {
    pub session_id: String,
    pub model: String,
    pub base_url: String,
    pub backend: Option<String>,
    pub reasoning_effort: Option<String>,
    pub api_key_env: Option<String>,
    pub extra_headers_json: Option<String>,
    /// Light worker model; `None` keeps single-model dispatch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub light_model: Option<LightModelSettings>,
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
mod tests {
    use super::*;
    use crate::types::Message;
    use crate::TEST_ENV_LOCK;

    fn temp_store_path(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_sessions_test_{}_{}", label, unique))
            .join("store.db")
    }

    fn test_snapshot(session_id: &str, created_at: &str, updated_at: &str) -> SessionSnapshot {
        let mut snapshot = new_snapshot(
            session_id.to_string(),
            PathBuf::from(format!("/repo/{session_id}")),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            None,
            Vec::new(),
            None,
            BTreeMap::new(),
        );
        snapshot.created_at = created_at.to_string();
        snapshot.updated_at = updated_at.to_string();
        snapshot
    }

    fn expected_versions(entries: &[(&str, i64)]) -> BTreeMap<String, i64> {
        entries
            .iter()
            .map(|(session_id, version)| ((*session_id).to_string(), *version))
            .collect()
    }

    #[test]
    fn create_and_load_session_round_trip() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("round_trip");

        let mut snapshot = new_snapshot(
            "session-1".to_string(),
            PathBuf::from("/repo"),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            Some(ReasoningEffort::Xhigh),
            None,
            None,
            vec![Message::User {
                content: "hello".to_string(),
            }],
            None,
            BTreeMap::new(),
        );
        snapshot.orchestrator_compaction_threshold = Some(32_768);
        snapshot.last_response_duration_ms = Some(12_345);
        snapshot.previous_response_duration_ms = Some(6_789);
        snapshot.response_durations_ms = Some(vec![Some(1_000), None, Some(12_345)]);
        snapshot.token_usages = vec![
            Some(crate::model::TokenUsage {
                input_tokens: 100,
                output_tokens: 50,
                cache_read_tokens: 20,
                cache_write_tokens: 0,
                reasoning_tokens: 0,
                orchestrator_context_tokens: 150,
                cost: crate::model::TokenCostMicros::default(),
            }),
            None,
            Some(crate::model::TokenUsage {
                input_tokens: 200,
                output_tokens: 80,
                cache_read_tokens: 40,
                cache_write_tokens: 10,
                reasoning_tokens: 0,
                orchestrator_context_tokens: 330,
                cost: crate::model::TokenCostMicros::default(),
            }),
        ];
        create_session(&store_path, &snapshot).unwrap();
        let loaded = load_session(&store_path, "session-1").unwrap();
        assert_eq!(loaded.session_id, "session-1");
        assert_eq!(loaded.cwd, PathBuf::from("/repo"));
        assert_eq!(loaded.messages.len(), 1);
        assert_eq!(loaded.orchestrator_compaction_threshold, Some(32_768));
        assert_eq!(loaded.last_response_duration_ms, Some(12_345));
        assert_eq!(loaded.previous_response_duration_ms, Some(6_789));
        assert_eq!(
            loaded.response_durations_ms,
            Some(vec![Some(1_000), None, Some(12_345)])
        );
        assert_eq!(loaded.token_usages.len(), 3);
        assert_eq!(loaded.token_usages[0].as_ref().unwrap().input_tokens, 100);
        assert_eq!(loaded.token_usages[0].as_ref().unwrap().output_tokens, 50);
        assert!(loaded.token_usages[1].is_none());
        assert_eq!(
            loaded.token_usages[2]
                .as_ref()
                .unwrap()
                .orchestrator_context_tokens,
            330
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn light_model_round_trips_and_malformed_json_is_a_diagnostic() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("light_model");
        let mut snapshot = test_snapshot(
            "light",
            "2026-01-01 00:00:00.000000000",
            "2026-01-01 00:00:00.000000000",
        );
        snapshot.light_model = Some(LightModelSettings {
            model: "gpt-5-mini".to_string(),
            backend: Some(BackendKind::OpenAiResponses),
            base_url: None,
            api_key_env: Some("OPENAI_API_KEY".to_string()),
            reasoning_effort: Some(ReasoningEffort::Low),
        });
        create_session(&store_path, &snapshot).unwrap();

        let loaded = load_session(&store_path, "light").unwrap();
        assert_eq!(loaded.light_model, snapshot.light_model);
        let raw = load_session_config(&store_path, "light").unwrap();
        assert_eq!(raw.light_model, snapshot.light_model);
        assert!(raw.diagnostics.is_empty());

        // Clearing through a config update returns the row to single-model.
        let mut cleared = raw.clone();
        cleared.light_model = None;
        assert_eq!(update_raw_session_config(&store_path, &cleared).unwrap(), 1);
        assert_eq!(
            load_session_config(&store_path, "light")
                .unwrap()
                .light_model,
            None
        );

        // Malformed stored JSON surfaces as a diagnostic, not a silent clear.
        let conn = rusqlite::Connection::open(&store_path).unwrap();
        conn.execute(
            "UPDATE sessions SET light_model_json = '{broken' WHERE session_id = 'light'",
            [],
        )
        .unwrap();
        drop(conn);
        let broken = load_session_config(&store_path, "light").unwrap();
        assert_eq!(broken.light_model, None);
        assert!(broken
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.starts_with(MALFORMED_LIGHT_MODEL_DIAGNOSTIC)));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn session_load_rejects_threshold_above_supported_maximum() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("oversized_compaction_threshold");
        let snapshot = test_snapshot(
            "oversized-threshold",
            "2026-01-01 00:00:00.000000000",
            "2026-01-01 00:00:00.000000000",
        );
        create_session(&store_path, &snapshot).unwrap();

        let conn = rusqlite::Connection::open(&store_path).unwrap();
        conn.pragma_update(None, "ignore_check_constraints", "ON")
            .unwrap();
        conn.execute(
            "UPDATE sessions
             SET orchestrator_compaction_threshold = ?1
             WHERE session_id = 'oversized-threshold'",
            [(crate::MAX_SUPPORTED_TOKEN_COUNT + 1) as i64],
        )
        .unwrap();
        drop(conn);

        for error in [
            load_session(&store_path, "oversized-threshold").unwrap_err(),
            load_session_config(&store_path, "oversized-threshold").unwrap_err(),
        ] {
            assert!(error.to_string().contains("exceeds supported maximum"));
        }

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn load_session_migrates_legacy_schema_without_duration_history() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("legacy_duration_schema");
        std::fs::create_dir_all(store_path.parent().unwrap()).unwrap();
        let messages_json = serde_json::to_string(&vec![Message::User {
            content: "hello".to_string(),
        }])
        .unwrap();

        {
            let conn = rusqlite::Connection::open(&store_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE sessions (
                    session_id TEXT PRIMARY KEY,
                    cwd TEXT NOT NULL,
                    store_path TEXT NOT NULL,
                    model TEXT NOT NULL,
                    base_url TEXT NOT NULL,
                    backend TEXT,
                    reasoning_effort TEXT,
                    sandbox_json TEXT,
                    messages_json TEXT NOT NULL,
                    last_response_duration_ms INTEGER,
                    previous_response_duration_ms INTEGER,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO sessions (
                    session_id, cwd, store_path, model, base_url, backend, reasoning_effort,
                    sandbox_json, messages_json, last_response_duration_ms,
                    previous_response_duration_ms, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                rusqlite::params![
                    "legacy-session",
                    "/repo",
                    store_path.display().to_string(),
                    "model-a",
                    "https://api.openai.com/v1",
                    "openai-responses",
                    "xhigh",
                    Option::<String>::None,
                    messages_json,
                    12_345_u64,
                    6_789_u64,
                    "2026-01-01 00:00:00.000000000",
                    "2026-01-01 00:00:01.000000000",
                ],
            )
            .unwrap();
        }

        let loaded = load_session(&store_path, "legacy-session").unwrap();
        assert_eq!(loaded.session_id, "legacy-session");
        assert_eq!(loaded.last_response_duration_ms, Some(12_345));
        assert_eq!(loaded.previous_response_duration_ms, Some(6_789));
        assert_eq!(loaded.response_durations_ms, None);
        assert!(
            loaded.token_usages.is_empty(),
            "legacy rows without token_usages_json column load as empty Vec"
        );
        assert_eq!(
            loaded.ssh, None,
            "legacy rows without a host_id column load as local sessions"
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn save_session_persists_to_opened_store_not_path_recorded_in_row() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("persist_target");
        let foreign_store_path = store_path
            .parent()
            .unwrap()
            .join("foreign")
            .join("store.db");
        std::fs::create_dir_all(store_path.parent().unwrap()).unwrap();
        let messages_json = serde_json::to_string(&vec![Message::User {
            content: "hello".to_string(),
        }])
        .unwrap();

        {
            let conn = crate::store::open_connection(&store_path).unwrap();
            conn.execute(
                "INSERT INTO sessions (
                    session_id, cwd, store_path, model, base_url, backend, messages_json,
                    created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    "session-foreign",
                    "/repo",
                    foreign_store_path.display().to_string(),
                    "model-a",
                    "https://api.openai.com/v1",
                    "openai-responses",
                    messages_json,
                    "2026-01-01 00:00:00.000000000",
                    "2026-01-01 00:00:01.000000000",
                ],
            )
            .unwrap();
        }

        let loaded = load_session(&store_path, "session-foreign").unwrap();
        let refreshed = refresh_snapshot(
            &loaded,
            vec![Message::User {
                content: "updated".to_string(),
            }],
            None,
            None,
            None,
            loaded.token_usages.clone(),
        );
        save_session(&store_path, &refreshed).unwrap();

        assert!(
            !foreign_store_path.exists(),
            "save must not write to the store path recorded inside the row"
        );
        let reloaded = load_session(&store_path, "session-foreign").unwrap();
        assert_eq!(reloaded.messages.len(), 1);
        match &reloaded.messages[0] {
            Message::User { content } => assert_eq!(content, "updated"),
            other => panic!("expected updated user message, got {:?}", other),
        }

        let conn = crate::store::open_connection(&store_path).unwrap();
        let recorded: String = conn
            .query_row(
                "SELECT store_path FROM sessions WHERE session_id = ?1",
                rusqlite::params!["session-foreign"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(recorded, store_path.display().to_string());

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    /// The whole connection has to survive, not just the host name: a session
    /// resumed after a restart has nothing else to tell it which port and key
    /// reached that machine.
    #[test]
    fn ssh_connection_round_trips_through_store_refresh_and_summaries() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("ssh_host_round_trip");

        let connection = SshConnection {
            host: "deploy@build-box".to_string(),
            port: Some(2222),
            identity_file: Some(PathBuf::from("/keys/ci")),
        };
        let snapshot = new_snapshot(
            "session-remote".to_string(),
            PathBuf::from("/remote/workspace"),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            Some(connection.clone()),
            vec![Message::User {
                content: "hello".to_string(),
            }],
            None,
            BTreeMap::new(),
        );
        create_session(&store_path, &snapshot).unwrap();

        let loaded = load_session(&store_path, "session-remote").unwrap();
        assert_eq!(loaded.ssh.as_ref(), Some(&connection));

        let refreshed = refresh_snapshot(
            &loaded,
            loaded.messages.clone(),
            None,
            None,
            None,
            loaded.token_usages.clone(),
        );
        assert_eq!(refreshed.ssh.as_ref(), Some(&connection));
        save_session(&store_path, &refreshed).unwrap();
        assert_eq!(
            load_session(&store_path, "session-remote").unwrap().ssh,
            Some(connection.clone())
        );

        let summaries = list_sessions(&store_path).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].ssh.as_ref(), Some(&connection));
        assert_eq!(
            summaries[0].workspace_host_path, None,
            "remote sessions must not expose a local path for host-side git inspection"
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn load_last_session_returns_most_recent() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("latest");

        let first = new_snapshot(
            "session-1".to_string(),
            PathBuf::from("/repo-one"),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            Some(ReasoningEffort::Xhigh),
            None,
            None,
            Vec::new(),
            None,
            BTreeMap::new(),
        );
        create_session(&store_path, &first).unwrap();

        let second = new_snapshot(
            "session-2".to_string(),
            PathBuf::from("/repo-two"),
            "model-b".to_string(),
            "https://api.fireworks.ai/inference/v1".to_string(),
            BackendKind::FireworksChat,
            None,
            None,
            None,
            vec![Message::User {
                content: "latest".to_string(),
            }],
            None,
            BTreeMap::new(),
        );
        save_session(&store_path, &second).unwrap();

        let loaded = load_last_session(&store_path).unwrap();
        assert_eq!(loaded.session_id, "session-2");

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn list_sessions_returns_summaries_in_presentation_order() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("list");

        let first = new_snapshot(
            "session-1".to_string(),
            PathBuf::from("/repo-one"),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            None,
            vec![
                Message::System {
                    content: "system".to_string(),
                },
                Message::User {
                    content: "first prompt".to_string(),
                },
            ],
            None,
            BTreeMap::new(),
        );
        create_session(&store_path, &first).unwrap();

        let second = new_snapshot(
            "session-2".to_string(),
            PathBuf::from("/repo-two"),
            "model-b".to_string(),
            "https://api.fireworks.ai/inference/v1".to_string(),
            BackendKind::FireworksChat,
            None,
            Some(SandboxSpec {
                backend: SandboxBackendType::Podman,
                image: "python:3.13".to_string(),
                workdir: PathBuf::from("/workspace"),
                mounts: Vec::new(),
                gpu_devices: Vec::new(),
                shm_size: Some("0".to_string()),
                cpus: 2,
                memory_mib: 2048,
            }),
            None,
            vec![
                Message::System {
                    content: "system".to_string(),
                },
                Message::User {
                    content: "latest prompt".to_string(),
                },
                Message::Assistant {
                    content: Some("reply".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                },
            ],
            None,
            BTreeMap::new(),
        );
        save_session(&store_path, &second).unwrap();

        let sessions = list_sessions(&store_path).unwrap();
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].session_id, "session-2");
        assert_eq!(sessions[0].visible_message_count, 2);
        assert_eq!(
            sessions[0].last_user_prompt.as_deref(),
            Some("latest prompt")
        );
        assert!(sessions[0].sandboxed);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn listing_and_raw_config_isolate_structurally_invalid_model_rows() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("raw_invalid_model_rows");
        for (index, id) in ["healthy", "auto", "missing", "effort", "headers"]
            .into_iter()
            .enumerate()
        {
            let snapshot = test_snapshot(
                id,
                &format!("2026-01-0{} 00:00:00.000000000", index + 1),
                &format!("2026-01-0{} 00:00:01.000000000", index + 1),
            );
            create_session(&store_path, &snapshot).unwrap();
        }
        let conn = rusqlite::Connection::open(&store_path).unwrap();
        conn.execute(
            "UPDATE sessions SET backend = 'auto' WHERE session_id = 'auto'",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE sessions SET backend = NULL WHERE session_id = 'missing'",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE sessions SET reasoning_effort = 'ultra' WHERE session_id = 'effort'",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE sessions SET extra_headers_json = '{broken' WHERE session_id = 'headers'",
            [],
        )
        .unwrap();
        drop(conn);

        let summaries = list_sessions(&store_path).unwrap();
        assert_eq!(summaries.len(), 5);
        let by_id = summaries
            .into_iter()
            .map(|summary| (summary.session_id.clone(), summary))
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(by_id["healthy"].model_config_error, None);
        assert!(by_id["auto"]
            .model_config_error
            .as_deref()
            .unwrap()
            .contains("auto"));
        assert_eq!(by_id["missing"].backend, "");
        assert!(by_id["missing"]
            .model_config_error
            .as_deref()
            .unwrap()
            .contains("no backend"));
        assert!(by_id["effort"]
            .model_config_error
            .as_deref()
            .unwrap()
            .contains("ultra"));
        assert!(by_id["headers"]
            .model_config_error
            .as_deref()
            .unwrap()
            .contains("malformed stored extra headers"));

        let raw = load_session_config(&store_path, "headers").unwrap();
        assert_eq!(raw.extra_headers_json.as_deref(), Some("{broken"));
        assert_eq!(raw.config_version, 0);
        assert!(!raw.diagnostics.is_empty());
        let mut repaired = raw.clone();
        repaired.extra_headers_json = None;
        repaired.diagnostics.clear();
        assert_eq!(
            update_raw_session_config(&store_path, &repaired).unwrap(),
            1
        );
        let mut stale = raw;
        stale.extra_headers_json = Some("{\"X-Test\":\"yes\"}".to_string());
        assert!(matches!(
            update_raw_session_config(&store_path, &stale),
            Err(SessionConfigUpdateError::Conflict(_))
        ));
        assert_eq!(
            load_session_config(&store_path, "headers")
                .unwrap()
                .extra_headers_json,
            None
        );
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn session_row_with_removed_sandbox_backend_loads_without_sandbox() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("removed_sandbox_backend");
        let snapshot = test_snapshot(
            "legacy-sandbox",
            "2026-01-01 00:00:00.000000000",
            "2026-01-01 00:00:01.000000000",
        );
        create_session(&store_path, &snapshot).unwrap();

        // Simulate a row written by an older build whose sandbox backend has
        // since been removed ("smolvm"): the stored spec must not break loads.
        let legacy_sandbox_json = r#"{
            "backend": "smolvm",
            "image": "python:3.13-bookworm",
            "workdir": "/workspace",
            "mounts": [],
            "gpu_devices": [],
            "shm_size": "0",
            "cpus": 2,
            "memory_mib": 2048
        }"#;
        let conn = rusqlite::Connection::open(&store_path).unwrap();
        conn.execute(
            "UPDATE sessions SET sandbox_json = ?1 WHERE session_id = 'legacy-sandbox'",
            [legacy_sandbox_json],
        )
        .unwrap();
        drop(conn);

        let loaded = load_session(&store_path, "legacy-sandbox").unwrap();
        assert!(loaded.sandbox_spec.is_none());

        let summaries = list_sessions(&store_path).unwrap();
        assert_eq!(summaries.len(), 1);
        assert!(!summaries[0].sandboxed);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn session_row_with_podman_sandbox_backend_still_loads_with_sandbox() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("podman_sandbox_backend");
        let mut snapshot = test_snapshot(
            "podman-sandbox",
            "2026-01-01 00:00:00.000000000",
            "2026-01-01 00:00:01.000000000",
        );
        snapshot.sandbox_spec = Some(SandboxSpec {
            backend: SandboxBackendType::Podman,
            image: "python:3.13-bookworm".to_string(),
            workdir: PathBuf::from("/workspace"),
            mounts: Vec::new(),
            gpu_devices: Vec::new(),
            shm_size: Some("0".to_string()),
            cpus: 2,
            memory_mib: 2048,
        });
        create_session(&store_path, &snapshot).unwrap();

        let loaded = load_session(&store_path, "podman-sandbox").unwrap();
        let spec = loaded.sandbox_spec.expect("podman sandbox must survive");
        assert_eq!(spec.backend, SandboxBackendType::Podman);
        assert_eq!(spec.image, "python:3.13-bookworm");

        let summaries = list_sessions(&store_path).unwrap();
        assert_eq!(summaries.len(), 1);
        assert!(summaries[0].sandboxed);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn api_key_env_and_extra_headers_round_trip_through_store() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("api_key_env_headers");

        let mut headers = BTreeMap::new();
        headers.insert("X-Custom-Header".to_string(), "custom-value".to_string());
        headers.insert("X-Org".to_string(), "my-org".to_string());

        let raw_selector = " MY_CUSTOM_API_KEY ";
        let mut snapshot = new_snapshot(
            "session-config".to_string(),
            PathBuf::from("/repo"),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            None,
            vec![Message::User {
                content: "hello".to_string(),
            }],
            Some(raw_selector.to_string()),
            headers.clone(),
        );
        snapshot.orchestrator_compaction_threshold = Some(65_536);
        create_session(&store_path, &snapshot).unwrap();

        let loaded = load_session(&store_path, "session-config").unwrap();
        assert_eq!(
            loaded.api_key_env.as_deref(),
            Some(raw_selector),
            "api_key_env must round-trip through the DB byte-for-byte"
        );
        assert_eq!(
            loaded.extra_headers, headers,
            "extra_headers must round-trip through the DB"
        );

        // refresh_snapshot must preserve api_key_env and extra_headers
        let refreshed = refresh_snapshot(
            &loaded,
            loaded.messages.clone(),
            None,
            None,
            None,
            loaded.token_usages.clone(),
        );
        assert_eq!(refreshed.api_key_env.as_deref(), Some(raw_selector));
        assert_eq!(refreshed.extra_headers, headers);
        assert_eq!(refreshed.orchestrator_compaction_threshold, Some(65_536));
        save_session(&store_path, &refreshed).unwrap();

        let reloaded = load_session(&store_path, "session-config").unwrap();
        assert_eq!(reloaded.api_key_env.as_deref(), Some(raw_selector));
        assert_eq!(reloaded.extra_headers, headers);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn config_and_history_writes_preserve_each_other_in_both_orders() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("config_history_isolation");

        for (session_id, config_first) in [
            ("history-then-config", false),
            ("config-then-history", true),
        ] {
            let mut initial = test_snapshot(
                session_id,
                "2026-01-01 00:00:00.000000000",
                "2026-01-01 00:00:00.000000000",
            );
            initial.orchestrator_compaction_threshold = Some(4_096);
            create_session(&store_path, &initial).unwrap();
            crate::store::append_episode(
                &store_path,
                session_id,
                "worker",
                "progress",
                "retained episode",
            )
            .unwrap();

            // These snapshots represent two processes that both read revision 0.
            let mut config_patch = load_session(&store_path, session_id).unwrap();
            config_patch.model = "model-after-patch".to_string();
            config_patch.base_url = "https://example.test/v1".to_string();
            config_patch.backend = BackendKind::TogetherChat;
            config_patch.reasoning_effort = Some(ReasoningEffort::High);
            config_patch.api_key_env = Some("PATCHED_KEY".to_string());
            config_patch.extra_headers =
                BTreeMap::from([("X-Patched".to_string(), "true".to_string())]);
            config_patch.orchestrator_compaction_threshold = Some(8_192);

            let mut completed_run = load_session(&store_path, session_id).unwrap();
            completed_run.messages = vec![
                Message::User {
                    content: "new prompt".to_string(),
                },
                Message::Assistant {
                    content: Some("new response".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                },
            ];
            completed_run.last_response_duration_ms = Some(250);
            completed_run.previous_response_duration_ms = Some(125);
            completed_run.response_durations_ms = Some(vec![Some(250)]);
            completed_run.token_usages = vec![Some(crate::model::TokenUsage {
                input_tokens: 10,
                output_tokens: 20,
                cache_read_tokens: 3,
                cache_write_tokens: 4,
                reasoning_tokens: 5,
                orchestrator_context_tokens: 42,
                cost: crate::model::TokenCostMicros::default(),
            })];
            completed_run.updated_at = "2026-01-02 00:00:00.000000000".to_string();

            if config_first {
                update_session_config(&store_path, &config_patch).unwrap();
                save_session(&store_path, &completed_run).unwrap();
            } else {
                save_session(&store_path, &completed_run).unwrap();
                update_session_config(&store_path, &config_patch).unwrap();
            }

            let stored = load_session(&store_path, session_id).unwrap();
            assert_eq!(stored.model, "model-after-patch");
            assert_eq!(stored.base_url, "https://example.test/v1");
            assert_eq!(stored.backend, BackendKind::TogetherChat);
            assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::High));
            assert_eq!(stored.api_key_env.as_deref(), Some("PATCHED_KEY"));
            assert_eq!(
                stored.extra_headers.get("X-Patched").map(String::as_str),
                Some("true")
            );
            assert_eq!(stored.orchestrator_compaction_threshold, Some(8_192));
            assert_eq!(stored.config_version, 1);
            assert_eq!(stored.messages.len(), 2);
            assert!(matches!(
                stored.messages.first(),
                Some(Message::User { content }) if content == "new prompt"
            ));
            assert!(matches!(
                stored.messages.get(1),
                Some(Message::Assistant { content: Some(content), .. }) if content == "new response"
            ));
            assert_eq!(stored.last_response_duration_ms, Some(250));
            assert_eq!(stored.previous_response_duration_ms, Some(125));
            assert_eq!(stored.response_durations_ms, Some(vec![Some(250)]));
            assert_eq!(stored.token_usages.len(), 1);
            assert_eq!(stored.updated_at, completed_run.updated_at);
            let episodes = crate::store::thread_read(&store_path, session_id, "worker").unwrap();
            assert_eq!(episodes.len(), 1);
            assert_eq!(episodes[0].content, "retained episode");
        }

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn concurrent_config_updates_use_revision_cas() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("config_revision_conflict");
        create_session(
            &store_path,
            &test_snapshot(
                "session",
                "2026-01-01 00:00:00.000000000",
                "2026-01-01 00:00:00.000000000",
            ),
        )
        .unwrap();

        let mut first = load_session(&store_path, "session").unwrap();
        first.model = "first-model".to_string();
        let mut second = load_session(&store_path, "session").unwrap();
        second.model = "second-model".to_string();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));

        let first_path = store_path.clone();
        let first_barrier = barrier.clone();
        let first_update = std::thread::spawn(move || {
            first_barrier.wait();
            update_session_config(&first_path, &first)
        });
        let second_path = store_path.clone();
        let second_barrier = barrier.clone();
        let second_update = std::thread::spawn(move || {
            second_barrier.wait();
            update_session_config(&second_path, &second)
        });
        barrier.wait();

        let results = [first_update.join().unwrap(), second_update.join().unwrap()];
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        let conflict = results
            .iter()
            .find_map(|result| result.as_ref().err())
            .expect("one stale updater must lose the CAS");
        assert!(matches!(conflict, SessionConfigUpdateError::Conflict(_)));
        assert!(conflict.to_string().contains("expected version 0, found 1"));

        let stored = load_session(&store_path, "session").unwrap();
        assert!(matches!(
            stored.model.as_str(),
            "first-model" | "second-model"
        ));
        assert_eq!(stored.config_version, 1);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn legacy_session_without_api_key_env_loads_with_defaults() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("legacy_no_api_key_env");
        std::fs::create_dir_all(store_path.parent().unwrap()).unwrap();
        let messages_json = serde_json::to_string(&vec![Message::User {
            content: "hello".to_string(),
        }])
        .unwrap();

        {
            let conn = rusqlite::Connection::open(&store_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE sessions (
                    session_id TEXT PRIMARY KEY,
                    cwd TEXT NOT NULL,
                    store_path TEXT NOT NULL,
                    model TEXT NOT NULL,
                    base_url TEXT NOT NULL,
                    backend TEXT,
                    reasoning_effort TEXT,
                    sandbox_json TEXT,
                    messages_json TEXT NOT NULL,
                    last_response_duration_ms INTEGER,
                    previous_response_duration_ms INTEGER,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO sessions (
                    session_id, cwd, store_path, model, base_url, backend, reasoning_effort,
                    sandbox_json, messages_json, last_response_duration_ms,
                    previous_response_duration_ms, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                rusqlite::params![
                    "legacy-session",
                    "/repo",
                    store_path.display().to_string(),
                    "model-a",
                    "https://api.openai.com/v1",
                    "openai-responses",
                    Option::<String>::None,
                    Option::<String>::None,
                    messages_json,
                    12_345_u64,
                    6_789_u64,
                    "2026-01-01 00:00:00.000000000",
                    "2026-01-01 00:00:01.000000000",
                ],
            )
            .unwrap();
        }

        // load_session goes through open_connection which runs migrations
        let loaded = load_session(&store_path, "legacy-session").unwrap();
        assert_eq!(
            loaded.api_key_env, None,
            "legacy rows without api_key_env column load as None"
        );
        assert!(
            loaded.extra_headers.is_empty(),
            "legacy rows without extra_headers_json column load as empty map"
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn delete_session_uses_cascades_for_owned_auxiliary_rows() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("delete_cascade");

        // Create a session
        let snapshot = new_snapshot(
            "session-del".to_string(),
            PathBuf::from("/repo"),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            None,
            vec![Message::User {
                content: "hello".to_string(),
            }],
            None,
            BTreeMap::new(),
        );
        create_session(&store_path, &snapshot).unwrap();

        // Add threads with episodes
        crate::store::append_episode(
            &store_path,
            "session-del",
            "auth",
            "inspect",
            "auth episode",
        )
        .unwrap();
        crate::store::append_episode(&store_path, "session-del", "tests", "scan", "test episode")
            .unwrap();

        // Add a workset with items
        let workset = crate::store::WorksetDefinition {
            id: "ws-1".to_string(),
            goal: "refresh".to_string(),
            status: "planned".to_string(),
            summary: "summary".to_string(),
            verification_recipe: None,
            items: vec![crate::store::WorksetItemDefinition {
                title: "item-1".to_string(),
                scope: "src/main.rs".to_string(),
                description: "do thing".to_string(),
                role: "implement".to_string(),
                depends_on: Vec::new(),
                acceptance: "done".to_string(),
                notes: None,
            }],
        };
        crate::store::define_workset(&store_path, "session-del", &workset).unwrap();
        crate::store::queue_thread_steering(
            &store_path,
            "session-del",
            "auth",
            "auth-dispatch",
            "check the failure path",
        )
        .unwrap();
        crate::store::append_thread_event(
            &store_path,
            "session-del",
            "auth",
            r#"{"type":"model_call_started","thread_name":"auth","iteration":1}"#,
        )
        .unwrap();

        // Verify data exists
        assert!(!crate::store::list_threads(&store_path, "session-del")
            .unwrap()
            .is_empty());
        assert!(
            crate::store::list_worksets(&store_path, "session-del")
                .unwrap()
                .len()
                == 1
        );
        assert!(list_sessions(&store_path).unwrap().len() == 1);
        assert_eq!(
            crate::store::list_thread_steering(&store_path, "session-del")
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            crate::store::load_all_thread_events(&store_path, "session-del", 20).unwrap()["auth"]
                .len(),
            1
        );

        // Delete the session
        let deleted = delete_session(&store_path, "session-del").unwrap();
        assert!(
            deleted,
            "delete_session should return true for existing session"
        );

        // Verify all related rows are gone
        assert!(crate::store::list_threads(&store_path, "session-del")
            .unwrap()
            .is_empty());
        assert!(crate::store::list_worksets(&store_path, "session-del")
            .unwrap()
            .is_empty());
        assert!(list_sessions(&store_path).unwrap().is_empty());
        assert!(
            crate::store::list_thread_steering(&store_path, "session-del")
                .unwrap()
                .is_empty()
        );
        assert!(
            crate::store::load_all_thread_events(&store_path, "session-del", 20)
                .unwrap()
                .is_empty()
        );

        // Deleting a non-existent session returns false
        let deleted_again = delete_session(&store_path, "session-del").unwrap();
        assert!(
            !deleted_again,
            "delete_session should return false for missing session"
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn legacy_store_migrates_presentation_table_and_lists_defaults() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("presentation_migration");
        std::fs::create_dir_all(store_path.parent().unwrap()).unwrap();
        let messages_json = serde_json::to_string(&Vec::<Message>::new()).unwrap();
        {
            let conn = rusqlite::Connection::open(&store_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE sessions (
                    session_id TEXT PRIMARY KEY,
                    cwd TEXT NOT NULL,
                    store_path TEXT NOT NULL,
                    model TEXT NOT NULL,
                    base_url TEXT NOT NULL,
                    backend TEXT,
                    reasoning_effort TEXT,
                    sandbox_json TEXT,
                    messages_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO sessions (
                    session_id, cwd, store_path, model, base_url, backend, messages_json,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                rusqlite::params![
                    "legacy-session",
                    "/repo",
                    store_path.display().to_string(),
                    "model-a",
                    "https://api.openai.com/v1",
                    "openai-responses",
                    messages_json,
                    "2026-01-01 00:00:00.000000000",
                    "2026-01-02 00:00:00.000000000",
                ],
            )
            .unwrap();
        }

        let summaries = list_sessions(&store_path).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].title, None);
        assert!(!summaries[0].pinned);
        assert_eq!(summaries[0].sort_order, 0);
        assert_eq!(summaries[0].presentation_version, 0);

        let conn = crate::store::open_connection(&store_path).unwrap();
        let table_exists: bool = conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM sqlite_master
                    WHERE type = 'table' AND name = 'session_presentations'
                 )",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(table_exists);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn presentation_order_uses_creation_fallback_and_new_sessions_lead_unpinned() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("presentation_default_order");
        let old = test_snapshot(
            "old",
            "2026-01-01 00:00:00.000000000",
            "2026-12-01 00:00:00.000000000",
        );
        let same_a = test_snapshot(
            "same-a",
            "2026-02-01 00:00:00.000000000",
            "2026-02-01 00:00:00.000000000",
        );
        let same_b = test_snapshot(
            "same-b",
            "2026-02-01 00:00:00.000000000",
            "2026-02-01 00:00:00.000000000",
        );
        create_session(&store_path, &old).unwrap();
        create_session(&store_path, &same_a).unwrap();
        create_session(&store_path, &same_b).unwrap();

        let initial_ids: Vec<_> = list_sessions(&store_path)
            .unwrap()
            .into_iter()
            .map(|summary| summary.session_id)
            .collect();
        assert_eq!(initial_ids, ["same-b", "same-a", "old"]);
        reorder_sessions(
            &store_path,
            false,
            &[
                "old".to_string(),
                "same-a".to_string(),
                "same-b".to_string(),
            ],
            &expected_versions(&[("old", 0), ("same-a", 0), ("same-b", 0)]),
        )
        .unwrap();

        let newest = test_snapshot(
            "newest",
            "2026-03-01 00:00:00.000000000",
            "2026-03-01 00:00:00.000000000",
        );
        create_session(&store_path, &newest).unwrap();
        let ids: Vec<_> = list_sessions(&store_path)
            .unwrap()
            .into_iter()
            .map(|summary| summary.session_id)
            .collect();
        assert_eq!(ids, ["newest", "old", "same-a", "same-b"]);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn presentation_titles_are_normalized_validated_and_clearable() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("presentation_titles");
        create_session(
            &store_path,
            &test_snapshot(
                "session-title",
                "2026-01-01 00:00:00.000000000",
                "2026-01-01 00:00:00.000000000",
            ),
        )
        .unwrap();

        let titled = update_session_presentation(
            &store_path,
            "session-title",
            "  Custom  title  ",
            false,
            0,
        )
        .unwrap();
        assert_eq!(titled.title.as_deref(), Some("Custom  title"));
        assert_eq!(titled.presentation_version, 1);

        let cleared =
            update_session_presentation(&store_path, "session-title", " \u{2003} ", false, 1)
                .unwrap();
        assert_eq!(cleared.title, None);
        assert_eq!(cleared.presentation_version, 2);

        assert!(matches!(
            update_session_presentation(&store_path, "session-title", "bad\ttitle", false, 2),
            Err(SessionPresentationError::InvalidInput(_))
        ));
        let unicode_title = "🦀".repeat(120);
        let unicode =
            update_session_presentation(&store_path, "session-title", &unicode_title, false, 2)
                .unwrap();
        assert_eq!(unicode.title.as_deref(), Some(unicode_title.as_str()));
        assert_eq!(unicode.presentation_version, 3);

        let no_op =
            update_session_presentation(&store_path, "session-title", &unicode_title, false, 3)
                .unwrap();
        assert_eq!(no_op.presentation_version, 4);
        assert!(matches!(
            update_session_presentation(&store_path, "session-title", &unicode_title, false, 3),
            Err(SessionPresentationError::Conflict(_))
        ));
        assert!(matches!(
            update_session_presentation(&store_path, "session-title", &"🦀".repeat(121), false, 4),
            Err(SessionPresentationError::InvalidInput(_))
        ));
        let unchanged = list_sessions(&store_path).unwrap().remove(0);
        assert_eq!(unchanged.title.as_deref(), Some(unicode_title.as_str()));
        assert_eq!(unchanged.presentation_version, 4);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn pin_moves_append_to_destination_without_disturbing_groups() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("presentation_pin_append");
        for (index, session_id) in ["a", "b", "c"].iter().enumerate() {
            create_session(
                &store_path,
                &test_snapshot(
                    session_id,
                    &format!("2026-01-0{} 00:00:00.000000000", index + 1),
                    "2026-01-01 00:00:00.000000000",
                ),
            )
            .unwrap();
        }

        let a = update_session_presentation(&store_path, "a", "Alpha", true, 0).unwrap();
        let b = update_session_presentation(&store_path, "b", "", true, 0).unwrap();
        assert_eq!((a.sort_order, b.sort_order), (0, 1));
        let b = update_session_presentation(&store_path, "b", "", false, 1).unwrap();
        assert_eq!(b.sort_order, 1, "unpin appends after legacy order zero");

        let summaries = list_sessions(&store_path).unwrap();
        let state: Vec<_> = summaries
            .iter()
            .map(|summary| {
                (
                    summary.session_id.as_str(),
                    summary.pinned,
                    summary.sort_order,
                    summary.title.as_deref(),
                )
            })
            .collect();
        assert_eq!(
            state,
            [
                ("a", true, 0, Some("Alpha")),
                ("c", false, 0, None),
                ("b", false, 1, None),
            ]
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn reorders_groups_independently_and_rejects_conflicts_without_partial_writes() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("presentation_reorder");
        for session_id in ["a", "b", "c"] {
            create_session(
                &store_path,
                &test_snapshot(
                    session_id,
                    "2026-01-01 00:00:00.000000000",
                    "2026-01-01 00:00:00.000000000",
                ),
            )
            .unwrap();
        }
        update_session_presentation(&store_path, "a", "Alpha", true, 0).unwrap();
        update_session_presentation(&store_path, "b", "", true, 0).unwrap();

        let pinned = reorder_sessions(
            &store_path,
            true,
            &["b".to_string(), "a".to_string()],
            &expected_versions(&[("a", 1), ("b", 1)]),
        )
        .unwrap();
        assert_eq!(
            pinned
                .iter()
                .map(|summary| (summary.session_id.as_str(), summary.sort_order))
                .collect::<Vec<_>>(),
            [("b", 0), ("a", 1)]
        );
        assert!(pinned
            .iter()
            .all(|summary| summary.presentation_version == 2));
        assert_eq!(pinned[1].title.as_deref(), Some("Alpha"));

        let unpinned = reorder_sessions(
            &store_path,
            false,
            &["c".to_string()],
            &expected_versions(&[("c", 0)]),
        )
        .unwrap();
        assert_eq!(unpinned[0].presentation_version, 1);
        assert_eq!(unpinned[0].sort_order, 0);

        let stale = reorder_sessions(
            &store_path,
            true,
            &["a".to_string(), "b".to_string()],
            &expected_versions(&[("a", 2), ("b", 1)]),
        );
        assert!(matches!(stale, Err(SessionPresentationError::Conflict(_))));
        let after_stale: Vec<_> = list_sessions(&store_path)
            .unwrap()
            .into_iter()
            .filter(|summary| summary.pinned)
            .map(|summary| (summary.session_id, summary.presentation_version))
            .collect();
        assert_eq!(after_stale, [("b".to_string(), 2), ("a".to_string(), 2)]);

        assert!(matches!(
            reorder_sessions(
                &store_path,
                true,
                &["a".to_string()],
                &expected_versions(&[("a", 2)])
            ),
            Err(SessionPresentationError::Conflict(_))
        ));
        assert!(matches!(
            reorder_sessions(
                &store_path,
                true,
                &["a".to_string(), "a".to_string()],
                &expected_versions(&[("a", 2)])
            ),
            Err(SessionPresentationError::InvalidInput(_))
        ));
        assert!(matches!(
            reorder_sessions(
                &store_path,
                true,
                &["missing".to_string(), "a".to_string(), "b".to_string()],
                &expected_versions(&[("missing", 0), ("a", 2), ("b", 2)])
            ),
            Err(SessionPresentationError::NotFound(_))
        ));
        assert!(matches!(
            reorder_sessions(
                &store_path,
                true,
                &["a".to_string(), "b".to_string()],
                &expected_versions(&[("a", 2)])
            ),
            Err(SessionPresentationError::InvalidInput(_))
        ));
        assert!(matches!(
            reorder_sessions(
                &store_path,
                true,
                &[" ".to_string()],
                &expected_versions(&[(" ", -1)])
            ),
            Err(SessionPresentationError::InvalidInput(_))
        ));
        assert!(matches!(
            reorder_sessions(
                &store_path,
                true,
                &["c".to_string(), "a".to_string(), "b".to_string()],
                &expected_versions(&[("c", 1), ("a", 2), ("b", 2)])
            ),
            Err(SessionPresentationError::Conflict(_))
        ));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn presentation_survives_snapshot_save_and_cascades_on_delete() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("presentation_snapshot_isolation");
        let mut stale_snapshot = test_snapshot(
            "session-presentation",
            "2026-01-01 00:00:00.000000000",
            "2026-01-01 00:00:00.000000000",
        );
        create_session(&store_path, &stale_snapshot).unwrap();
        update_session_presentation(
            &store_path,
            "session-presentation",
            "Persisted title",
            true,
            0,
        )
        .unwrap();

        stale_snapshot.updated_at = "2026-02-01 00:00:00.000000000".to_string();
        save_session(&store_path, &stale_snapshot).unwrap();
        let summary = list_sessions(&store_path).unwrap().remove(0);
        assert_eq!(summary.title.as_deref(), Some("Persisted title"));
        assert!(summary.pinned);
        assert_eq!(summary.presentation_version, 1);

        assert!(delete_session(&store_path, "session-presentation").unwrap());
        let conn = crate::store::open_connection(&store_path).unwrap();
        let presentation_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM session_presentations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(presentation_count, 0);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn presentation_writes_do_not_change_load_last_activity_order() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("presentation_load_last");
        let active = test_snapshot(
            "active",
            "2026-01-01 00:00:00.000000000",
            "2026-03-01 00:00:00.000000000",
        );
        let newer_created = test_snapshot(
            "newer-created",
            "2026-02-01 00:00:00.000000000",
            "2026-02-01 00:00:00.000000000",
        );
        create_session(&store_path, &active).unwrap();
        create_session(&store_path, &newer_created).unwrap();

        update_session_presentation(&store_path, "newer-created", "Renamed and pinned", true, 0)
            .unwrap();
        assert_eq!(load_last_session(&store_path).unwrap().session_id, "active");

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn save_session_run_state_preserves_messages_and_config_columns() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("run_state_sparing_save");
        let mut snapshot = test_snapshot(
            "session-sparing",
            "2026-01-01 00:00:00.000000000",
            "2026-01-01 00:00:00.000000000",
        );
        snapshot.messages = vec![
            Message::System {
                content: "system head".to_string(),
            },
            Message::User {
                content: "hello".to_string(),
            },
        ];
        snapshot.orchestrator_compaction_threshold = Some(4_096);
        create_session(&store_path, &snapshot).unwrap();
        let raw_messages_json = || {
            crate::store::open_connection(&store_path)
                .unwrap()
                .query_row(
                    "SELECT messages_json FROM sessions WHERE session_id = 'session-sparing'",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .unwrap()
        };
        let messages_json_before = raw_messages_json();

        let mut in_memory = load_session(&store_path, "session-sparing").unwrap();
        let update = in_memory.apply_run_state(SessionRunState {
            last_response_duration_ms: Some(250),
            previous_response_duration_ms: Some(125),
            response_durations_ms: Some(vec![Some(125), Some(250)]),
            token_usages: vec![
                None,
                Some(crate::model::TokenUsage {
                    input_tokens: 10,
                    output_tokens: 20,
                    cache_read_tokens: 3,
                    cache_write_tokens: 4,
                    reasoning_tokens: 5,
                    orchestrator_context_tokens: 42,
                    cost: crate::model::TokenCostMicros::default(),
                }),
            ],
            unattributed_token_usage: None,
        });
        save_session_run_state(&store_path, &update).unwrap();

        assert_eq!(
            raw_messages_json(),
            messages_json_before,
            "the sparing save must leave messages_json byte-identical"
        );
        let stored = load_session(&store_path, "session-sparing").unwrap();
        assert_eq!(stored.last_response_duration_ms, Some(250));
        assert_eq!(stored.previous_response_duration_ms, Some(125));
        assert_eq!(
            stored.response_durations_ms,
            Some(vec![Some(125), Some(250)])
        );
        assert_eq!(stored.token_usages.len(), 2);
        assert!(stored.token_usages[0].is_none());
        assert_eq!(
            stored.token_usages[1]
                .as_ref()
                .unwrap()
                .orchestrator_context_tokens,
            42
        );
        assert_eq!(stored.updated_at, update.updated_at);
        // Configuration columns are CAS-only: untouched by the run-end save.
        assert_eq!(stored.model, "model-a");
        assert_eq!(stored.orchestrator_compaction_threshold, Some(4_096));
        assert_eq!(stored.config_version, 0);

        // A missing session row is an error, not an upsert: run end of a
        // persisted session always has its row.
        let missing = SessionRunStateUpdate {
            session_id: "session-missing".to_string(),
            ..update
        };
        let error = save_session_run_state(&store_path, &missing).unwrap_err();
        assert!(error.to_string().contains("session-missing"), "{error:#}");

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn session_summaries_merge_blob_stats_with_transcript_log_tail() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("summary_blob_plus_log");

        // Never-fold session shape (step 4): a write-once blob (system head
        // ++ legacy prefix) plus the live transcript in the log.
        let mut with_log = test_snapshot(
            "session-with-log",
            "2026-01-01 00:00:00.000000000",
            "2026-01-02 00:00:00.000000000",
        );
        with_log.messages = vec![
            Message::System {
                content: "system".to_string(),
            },
            Message::User {
                content: "blob prompt".to_string(),
            },
            Message::Assistant {
                content: Some("blob answer".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
        ];
        create_session(&store_path, &with_log).unwrap();
        let tool_call = crate::types::ToolCall {
            id: "call-1".to_string(),
            call_type: "function".to_string(),
            function: crate::types::FunctionCall {
                name: "read".to_string(),
                arguments: "{\"path\":\"x\"}".to_string(),
            },
        };
        let writer = crate::store::TranscriptLogWriter::new(&store_path).unwrap();
        writer
            .append_batch(
                "session-with-log",
                3,
                &[
                    Message::User {
                        content: "log prompt".to_string(),
                    },
                    Message::Assistant {
                        content: Some("log answer".to_string()),
                        reasoning_text: None,
                        reasoning_details: None,
                        tool_calls: None,
                        duration_ms: None,
                        model_origin: None,
                        reasoning_field: None,
                    },
                    Message::Assistant {
                        content: None,
                        reasoning_text: None,
                        reasoning_details: None,
                        tool_calls: Some(vec![tool_call]),
                        duration_ms: None,
                        model_origin: None,
                        reasoning_field: None,
                    },
                    Message::Tool {
                        tool_call_id: "call-1".to_string(),
                        content: "tool output".to_string(),
                    },
                ],
            )
            .unwrap();

        // Pre-log session shape: blob only, exactly the pre-log numbers.
        let mut blob_only = test_snapshot(
            "session-blob-only",
            "2026-01-01 00:00:00.000000000",
            "2026-01-01 00:00:00.000000000",
        );
        blob_only.messages = vec![
            Message::System {
                content: "system".to_string(),
            },
            Message::User {
                content: "blob only prompt".to_string(),
            },
        ];
        create_session(&store_path, &blob_only).unwrap();

        let summaries = list_sessions(&store_path).unwrap();
        let with_log_summary = summaries
            .iter()
            .find(|summary| summary.session_id == "session-with-log")
            .unwrap();
        assert_eq!(
            with_log_summary.visible_message_count, 4,
            "blob visible (user + answer) ++ log visible (user + answer)"
        );
        assert_eq!(
            with_log_summary.last_user_prompt.as_deref(),
            Some("log prompt"),
            "the log tail holds the latest user prompt"
        );
        let blob_only_summary = summaries
            .iter()
            .find(|summary| summary.session_id == "session-blob-only")
            .unwrap();
        assert_eq!(blob_only_summary.visible_message_count, 1);
        assert_eq!(
            blob_only_summary.last_user_prompt.as_deref(),
            Some("blob only prompt")
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }
}
