use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::api::{detect_backend, BackendKind, ReasoningEffort};
use crate::paths::nac_sessions_path;
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

    fn temp_home(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("nac_sessions_test_{}_{}", label, unique));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn create_and_load_session_round_trip() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let home = temp_home("round_trip");
        let previous_nac_home = std::env::var_os("NAC_HOME");
        unsafe {
            std::env::set_var("NAC_HOME", &home);
        }

        let snapshot = new_snapshot(
            "session-1".to_string(),
            PathBuf::from("/repo"),
            PathBuf::from("/repo/.nac/store.db"),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            Some(ReasoningEffort::Xhigh),
            None,
            vec![Message::User {
                content: "hello".to_string(),
            }],
        );
        create_session(&snapshot).unwrap();
        let loaded = load_session("session-1").unwrap();
        assert_eq!(loaded.session_id, "session-1");
        assert_eq!(loaded.cwd, PathBuf::from("/repo"));
        assert_eq!(loaded.messages.len(), 1);

        match previous_nac_home {
            Some(value) => unsafe { std::env::set_var("NAC_HOME", value) },
            None => unsafe { std::env::remove_var("NAC_HOME") },
        }
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn load_last_session_returns_most_recent() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let home = temp_home("latest");
        let previous_nac_home = std::env::var_os("NAC_HOME");
        unsafe {
            std::env::set_var("NAC_HOME", &home);
        }

        let first = new_snapshot(
            "session-1".to_string(),
            PathBuf::from("/repo-one"),
            PathBuf::from("/repo-one/.nac/store.db"),
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
            PathBuf::from("/repo-two/.nac/store.db"),
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

        let loaded = load_last_session().unwrap();
        assert_eq!(loaded.session_id, "session-2");

        match previous_nac_home {
            Some(value) => unsafe { std::env::set_var("NAC_HOME", value) },
            None => unsafe { std::env::remove_var("NAC_HOME") },
        }
        let _ = std::fs::remove_dir_all(home);
    }

    #[test]
    fn list_sessions_returns_summaries_in_updated_order() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let home = temp_home("list");
        let previous_nac_home = std::env::var_os("NAC_HOME");
        unsafe {
            std::env::set_var("NAC_HOME", &home);
        }

        let first = new_snapshot(
            "session-1".to_string(),
            PathBuf::from("/repo-one"),
            PathBuf::from("/repo-one/.nac/store.db"),
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
            PathBuf::from("/repo-two/.nac/store.db"),
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

        let sessions = list_sessions().unwrap();
        assert_eq!(sessions.len(), 2);
        assert_eq!(sessions[0].session_id, "session-2");
        assert_eq!(sessions[0].visible_message_count, 2);
        assert_eq!(
            sessions[0].last_user_prompt.as_deref(),
            Some("latest prompt")
        );
        assert!(sessions[0].sandboxed);

        match previous_nac_home {
            Some(value) => unsafe { std::env::set_var("NAC_HOME", value) },
            None => unsafe { std::env::remove_var("NAC_HOME") },
        }
        let _ = std::fs::remove_dir_all(home);
    }
}
