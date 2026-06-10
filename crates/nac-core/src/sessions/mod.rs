use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::model::{detect_backend, BackendKind, ReasoningEffort};
use crate::sandbox::SandboxSpec;
use crate::types::Message;

mod codec;
mod db;
mod snapshot;
mod summary;

pub use db::{create_session, list_sessions, load_last_session, load_session, save_session};
pub use snapshot::{new_snapshot, refresh_snapshot};

use codec::*;
use summary::*;

/// In-memory session state. Note: there is intentionally no `store_path`
/// field. Sessions always persist to the store that was actually opened
/// (passed explicitly to `create_session`/`save_session`), never to a path
/// remembered inside the row.
#[derive(Debug, Clone)]
pub struct SessionSnapshot {
    pub session_id: String,
    pub cwd: PathBuf,
    pub model: String,
    pub base_url: String,
    pub backend: BackendKind,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub sandbox_spec: Option<SandboxSpec>,
    /// OpenSSH/freeform target the session runs on. `None` = local session
    /// (exactly the pre-remote behavior). When set, `cwd` is a path on that
    /// remote host and must not be checked or canonicalized locally.
    pub ssh_host: Option<String>,
    pub messages: Vec<Message>,
    pub last_response_duration_ms: Option<u64>,
    pub previous_response_duration_ms: Option<u64>,
    pub response_durations_ms: Option<Vec<Option<u64>>>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct SessionSummary {
    pub session_id: String,
    pub cwd: PathBuf,
    pub workspace_host_path: Option<PathBuf>,
    pub model: String,
    pub backend: BackendKind,
    pub visible_message_count: usize,
    pub last_user_prompt: Option<String>,
    pub sandboxed: bool,
    /// OpenSSH/freeform target the session runs on; `None` = local session.
    pub ssh_host: Option<String>,
    pub created_at: String,
    pub updated_at: String,
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
        );
        snapshot.last_response_duration_ms = Some(12_345);
        snapshot.previous_response_duration_ms = Some(6_789);
        snapshot.response_durations_ms = Some(vec![Some(1_000), None, Some(12_345)]);
        create_session(&store_path, &snapshot).unwrap();
        let loaded = load_session(&store_path, "session-1").unwrap();
        assert_eq!(loaded.session_id, "session-1");
        assert_eq!(loaded.cwd, PathBuf::from("/repo"));
        assert_eq!(loaded.messages.len(), 1);
        assert_eq!(loaded.last_response_duration_ms, Some(12_345));
        assert_eq!(loaded.previous_response_duration_ms, Some(6_789));
        assert_eq!(
            loaded.response_durations_ms,
            Some(vec![Some(1_000), None, Some(12_345)])
        );

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
        assert_eq!(
            loaded.ssh_host, None,
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

        // Legacy row claiming it belongs to a different store file.
        {
            let conn = crate::store::open_connection(&store_path).unwrap();
            conn.execute(
                "INSERT INTO sessions (
                    session_id, cwd, store_path, model, base_url, messages_json,
                    created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    "session-foreign",
                    "/repo",
                    foreign_store_path.display().to_string(),
                    "model-a",
                    "https://api.openai.com/v1",
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

        // The legacy NOT NULL column is rewritten with the store actually opened.
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

    #[test]
    fn ssh_host_round_trips_through_store_refresh_and_summaries() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("ssh_host_round_trip");

        let snapshot = new_snapshot(
            "session-remote".to_string(),
            PathBuf::from("/remote/workspace"),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            Some("build-box".to_string()),
            vec![Message::User {
                content: "hello".to_string(),
            }],
        );
        create_session(&store_path, &snapshot).unwrap();

        let loaded = load_session(&store_path, "session-remote").unwrap();
        assert_eq!(loaded.ssh_host.as_deref(), Some("build-box"));

        let refreshed = refresh_snapshot(&loaded, loaded.messages.clone(), None, None, None);
        assert_eq!(refreshed.ssh_host.as_deref(), Some("build-box"));
        save_session(&store_path, &refreshed).unwrap();
        assert_eq!(
            load_session(&store_path, "session-remote")
                .unwrap()
                .ssh_host
                .as_deref(),
            Some("build-box")
        );

        let summaries = list_sessions(&store_path).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].ssh_host.as_deref(), Some("build-box"));
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
        );
        save_session(&store_path, &second).unwrap();

        let loaded = load_last_session(&store_path).unwrap();
        assert_eq!(loaded.session_id, "session-2");

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn list_sessions_returns_summaries_in_updated_order() {
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
                image: "python:3.13".to_string(),
                workdir: PathBuf::from("/workspace"),
                mounts: Vec::new(),
                gpu_devices: Vec::new(),
                shm_size: Some("0".to_string()),
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
                },
            ],
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
}
