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

#[derive(Debug, Clone)]
pub struct SessionSnapshot {
    pub session_id: String,
    pub cwd: PathBuf,
    pub store_path: PathBuf,
    pub model: String,
    pub base_url: String,
    pub backend: BackendKind,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub sandbox_spec: Option<SandboxSpec>,
    pub messages: Vec<Message>,
    pub last_response_duration_ms: Option<u64>,
    pub previous_response_duration_ms: Option<u64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub struct SessionSummary {
    pub session_id: String,
    pub cwd: PathBuf,
    pub model: String,
    pub backend: BackendKind,
    pub visible_message_count: usize,
    pub last_user_prompt: Option<String>,
    pub sandboxed: bool,
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
            store_path.clone(),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            Some(ReasoningEffort::Xhigh),
            None,
            vec![Message::User {
                content: "hello".to_string(),
            }],
        );
        snapshot.last_response_duration_ms = Some(12_345);
        snapshot.previous_response_duration_ms = Some(6_789);
        create_session(&snapshot).unwrap();
        let loaded = load_session(&store_path, "session-1").unwrap();
        assert_eq!(loaded.session_id, "session-1");
        assert_eq!(loaded.cwd, PathBuf::from("/repo"));
        assert_eq!(loaded.messages.len(), 1);
        assert_eq!(loaded.last_response_duration_ms, Some(12_345));
        assert_eq!(loaded.previous_response_duration_ms, Some(6_789));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn load_last_session_returns_most_recent() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let store_path = temp_store_path("latest");

        let first = new_snapshot(
            "session-1".to_string(),
            PathBuf::from("/repo-one"),
            store_path.clone(),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            Some(ReasoningEffort::Xhigh),
            None,
            Vec::new(),
        );
        create_session(&first).unwrap();

        let second = new_snapshot(
            "session-2".to_string(),
            PathBuf::from("/repo-two"),
            store_path.clone(),
            "model-b".to_string(),
            "https://api.fireworks.ai/inference/v1".to_string(),
            BackendKind::FireworksChat,
            None,
            None,
            vec![Message::User {
                content: "latest".to_string(),
            }],
        );
        save_session(&second).unwrap();

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
            store_path.clone(),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
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
        create_session(&first).unwrap();

        let second = new_snapshot(
            "session-2".to_string(),
            PathBuf::from("/repo-two"),
            store_path.clone(),
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
        save_session(&second).unwrap();

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
