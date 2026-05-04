use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, Transaction};

mod render;
mod schema;
mod threads;
mod time;
mod worksets;

pub use render::*;
pub use schema::{default_store_path, initialize};
pub use threads::*;
pub use worksets::*;

use schema::open_connection;
use time::now_utc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EpisodeRecord {
    pub id: i64,
    pub thread_name: String,
    pub session_id: String,
    pub action: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadRecord {
    pub name: String,
    pub session_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub episode_count: i64,
    pub latest_action: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerContext {
    pub self_episodes: Vec<EpisodeRecord>,
    pub source_episodes: Vec<EpisodeRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorksetItemRecord {
    pub position: i64,
    pub title: String,
    pub scope: String,
    pub description: String,
    pub role: String,
    pub depends_on: Vec<String>,
    pub acceptance: String,
    pub notes: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorksetRecord {
    pub id: String,
    pub session_id: String,
    pub goal: String,
    pub status: String,
    pub summary: String,
    pub verification_recipe: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub items: Vec<WorksetItemRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorksetSummary {
    pub id: String,
    pub status: String,
    pub summary: String,
    pub item_count: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorksetItemDefinition {
    pub title: String,
    pub scope: String,
    pub description: String,
    pub role: String,
    pub depends_on: Vec<String>,
    pub acceptance: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorksetDefinition {
    pub id: String,
    pub goal: String,
    pub status: String,
    pub summary: String,
    pub verification_recipe: Option<String>,
    pub items: Vec<WorksetItemDefinition>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store_path(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_store_test_{}_{}", label, unique))
            .join("store.db")
    }

    #[test]
    fn append_list_and_read_thread_data() {
        let store_path = temp_store_path("append");
        initialize(&store_path).unwrap();

        let session_id = "session-a";
        append_episode(
            &store_path,
            session_id,
            "auth",
            "inspect",
            "first auth episode",
        )
        .unwrap();
        append_episode(
            &store_path,
            session_id,
            "auth",
            "refactor",
            "second auth episode",
        )
        .unwrap();
        append_episode(&store_path, session_id, "tests", "inspect", "test episode").unwrap();

        let threads = list_threads(&store_path, session_id).unwrap();
        assert_eq!(threads.len(), 2);
        assert!(threads
            .iter()
            .any(|thread| thread.name == "auth" && thread.episode_count == 2));

        let auth_episodes = thread_read(&store_path, session_id, "auth").unwrap();
        assert_eq!(auth_episodes.len(), 2);
        assert_eq!(auth_episodes[0].action, "inspect");
        assert_eq!(auth_episodes[1].action, "refactor");

        let rendered = render_thread_document("auth", &auth_episodes);
        assert!(rendered.contains("first auth episode"));
        assert!(rendered.contains("second auth episode"));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn worker_context_uses_latest_source_episode() {
        let store_path = temp_store_path("context");
        initialize(&store_path).unwrap();

        let session_id = "session-b";
        append_episode(&store_path, session_id, "auth", "inspect", "self history").unwrap();
        append_episode(&store_path, session_id, "tests", "scan", "old source").unwrap();
        append_episode(&store_path, session_id, "tests", "scan", "new source").unwrap();

        let context =
            load_worker_context(&store_path, session_id, "auth", &["tests".to_string()]).unwrap();

        assert_eq!(context.self_episodes.len(), 1);
        assert_eq!(context.source_episodes.len(), 1);
        assert_eq!(context.source_episodes[0].content, "new source");

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn delete_thread_removes_all_episodes() {
        let store_path = temp_store_path("delete");
        initialize(&store_path).unwrap();

        let session_id = "session-c";
        append_episode(&store_path, session_id, "impl", "step-1", "first episode").unwrap();
        append_episode(&store_path, session_id, "impl", "step-2", "second episode").unwrap();

        let deleted = delete_thread(&store_path, session_id, "impl").unwrap();
        assert!(deleted);
        assert!(thread_read(&store_path, session_id, "impl")
            .unwrap()
            .is_empty());

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn define_read_and_list_worksets() {
        let store_path = temp_store_path("worksets");
        initialize(&store_path).unwrap();

        let session_id = "session-workset";
        let definition = WorksetDefinition {
            id: "auth-refresh".to_string(),
            goal: "refresh auth flow".to_string(),
            status: "planned".to_string(),
            summary: "Split auth refresh into scoped units.".to_string(),
            verification_recipe: Some("cargo test -p nac".to_string()),
            items: vec![
                WorksetItemDefinition {
                    title: "Inspect auth state handling".to_string(),
                    scope: "crates/nac/src/agent.rs".to_string(),
                    description: "Map auth state behavior and risks.".to_string(),
                    role: "research".to_string(),
                    depends_on: Vec::new(),
                    acceptance: "Auth state behavior and risks are mapped.".to_string(),
                    notes: None,
                },
                WorksetItemDefinition {
                    title: "Implement auth state update".to_string(),
                    scope: "crates/nac/src/tui.rs".to_string(),
                    description: "Apply the focused code change.".to_string(),
                    role: "implement".to_string(),
                    depends_on: vec!["Inspect auth state handling".to_string()],
                    acceptance: "Focused code change is applied.".to_string(),
                    notes: Some("waiting on research".to_string()),
                },
            ],
        };

        define_workset(&store_path, session_id, &definition).unwrap();

        let workset = read_workset(&store_path, session_id, "auth-refresh")
            .unwrap()
            .expect("expected workset");
        assert_eq!(workset.goal, "refresh auth flow");
        assert_eq!(workset.items.len(), 2);
        assert_eq!(
            workset.items[1].depends_on,
            vec!["Inspect auth state handling"]
        );
        assert_eq!(
            workset.items[1].acceptance,
            "Focused code change is applied."
        );

        let listed = list_worksets(&store_path, session_id).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "auth-refresh");

        let rendered = render_workset_document(&workset);
        assert!(rendered.contains("Inspect auth state handling"));
        assert!(rendered.contains("verification: cargo test -p nac"));
        assert!(render_workset_list(&listed).contains("auth-refresh"));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }
}
