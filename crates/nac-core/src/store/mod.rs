use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, Transaction};

mod model_configurations;
pub(crate) mod orchestrator_compaction;
mod render;
mod schema;
mod ssh_configurations;
mod steering;
mod thread_events;
mod threads;
mod time;
mod transcript;
mod worksets;
mod workspace_revisions;

pub use model_configurations::*;
pub use render::*;
pub use schema::{default_store_path, initialize};
pub use ssh_configurations::*;
pub use steering::*;
pub use thread_events::*;
pub use threads::*;
pub use transcript::*;
pub use worksets::*;
pub use workspace_revisions::*;

pub(crate) use schema::{open_connection, open_runtime_connection};
#[cfg(test)]
pub(crate) use schema::{track_connection_opens, tracked_connection_opens};
pub(crate) use steering::list_thread_steering_with_connection;
pub(crate) use thread_events::load_all_thread_events_with_connection;
pub(crate) use threads::{list_threads_with_connection, load_all_episodes_with_connection};
use time::now_utc;
pub(crate) use worksets::{list_worksets_with_connection, read_workset_with_connection};

#[cfg(test)]
pub(crate) fn insert_test_session(path: &Path, session_id: &str) {
    let conn = open_runtime_connection(path).unwrap();
    conn.execute(
        "INSERT INTO sessions
             (session_id, cwd, store_path, model, base_url, messages_json,
              created_at, updated_at)
         VALUES (?1, '/tmp/project', '/tmp/store.db', 'test-model',
                 'https://example.invalid', '[]', ?2, ?2)",
        params![session_id, now_utc()],
    )
    .unwrap();
}

pub fn is_sqlite_busy(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        matches!(
            cause.downcast_ref::<rusqlite::Error>(),
            Some(rusqlite::Error::SqliteFailure(code, _))
                if matches!(
                    code.code,
                    rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
                )
        )
    })
}

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
pub struct ThreadEventRecord {
    pub id: i64,
    pub thread_name: String,
    pub session_id: String,
    pub event_json: String,
    pub created_at: String,
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
    fn delete_thread_removes_only_target_owned_rows() {
        let store_path = temp_store_path("delete");
        initialize(&store_path).unwrap();
        insert_test_session(&store_path, "session-c");

        for thread_name in ["impl", "keep"] {
            append_episode(&store_path, "session-c", thread_name, "step", "episode").unwrap();
            queue_thread_steering(
                &store_path,
                "session-c",
                thread_name,
                &format!("dispatch-{thread_name}"),
                "instruction",
            )
            .unwrap();
            append_thread_event(&store_path, "session-c", thread_name, "{}").unwrap();
        }

        let deleted = delete_thread(&store_path, "session-c", "impl").unwrap();
        assert!(deleted);

        let conn = open_runtime_connection(&store_path).unwrap();
        for table in ["threads", "episodes", "thread_steering", "thread_events"] {
            let target_count: i64 = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM {table} WHERE session_id = ?1 AND {} = ?2",
                        if table == "threads" {
                            "name"
                        } else {
                            "thread_name"
                        }
                    ),
                    params!["session-c", "impl"],
                    |row| row.get(0),
                )
                .unwrap();
            let retained_count: i64 = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM {table} WHERE session_id = ?1 AND {} = ?2",
                        if table == "threads" {
                            "name"
                        } else {
                            "thread_name"
                        }
                    ),
                    params!["session-c", "keep"],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(target_count, 0, "target rows remain in {table}");
            assert_eq!(retained_count, 1, "unrelated rows changed in {table}");
        }

        drop(conn);
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn delete_thread_rejects_reserved_orchestrator_target() {
        let store_path = temp_store_path("delete_reserved");
        initialize(&store_path).unwrap();
        insert_test_session(&store_path, "session-c");

        // Transcript log rows and orchestrator steering live under the
        // reserved name without any threads row.
        let writer = crate::store::TranscriptLogWriter::new(&store_path).unwrap();
        writer
            .append(
                "session-c",
                0,
                &crate::types::Message::User {
                    content: "prompt".to_string(),
                },
            )
            .unwrap();
        writer
            .append(
                "session-c",
                1,
                &crate::types::Message::Assistant {
                    content: Some("answer".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                },
            )
            .unwrap();
        queue_thread_steering(
            &store_path,
            "session-c",
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            "dispatch-1",
            "instruction",
        )
        .unwrap();
        append_episode(&store_path, "session-c", "keep", "step", "episode").unwrap();

        let error = delete_thread(
            &store_path,
            "session-c",
            crate::store::ORCHESTRATOR_STEERING_TARGET,
        )
        .unwrap_err();
        assert!(error.to_string().contains("reserved"));

        // Nothing was deleted: transcript and steering rows survive intact.
        assert_eq!(writer.read_from("session-c", 0).unwrap().len(), 2);
        let conn = open_runtime_connection(&store_path).unwrap();
        for table in ["thread_steering", "thread_events"] {
            let count: i64 = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM {table}
                         WHERE session_id = 'session-c' AND thread_name = '__orchestrator__'"
                    ),
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            let expected = if table == "thread_events" { 2 } else { 1 };
            assert_eq!(count, expected, "reserved rows lost from {table}");
        }
        drop(conn);

        // Normal deletes are unaffected.
        assert!(delete_thread(&store_path, "session-c", "keep").unwrap());

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
            verification_recipe: Some("cargo test -p nac-core".to_string()),
            items: vec![
                WorksetItemDefinition {
                    title: "Inspect auth state handling".to_string(),
                    scope: "crates/nac-core/src/agent/mod.rs".to_string(),
                    description: "Map auth state behavior and risks.".to_string(),
                    role: "research".to_string(),
                    depends_on: Vec::new(),
                    acceptance: "Auth state behavior and risks are mapped.".to_string(),
                    notes: None,
                },
                WorksetItemDefinition {
                    title: "Implement auth state update".to_string(),
                    scope: "crates/nac-core/src/store/mod.rs".to_string(),
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
        assert!(rendered.contains("verification: cargo test -p nac-core"));
        assert!(render_workset_list(&listed).contains("auth-refresh"));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }
}
