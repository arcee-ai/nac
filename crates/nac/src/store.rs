use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use rusqlite::{params, Connection, OptionalExtension, Transaction};

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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerContext {
    pub self_episodes: Vec<EpisodeRecord>,
    pub source_episodes: Vec<EpisodeRecord>,
}

pub fn default_store_path() -> PathBuf {
    PathBuf::from(".nac").join("store.db")
}

pub fn initialize(path: &Path) -> Result<()> {
    let _ = open_connection(path)?;
    Ok(())
}

pub fn append_episode(
    path: &Path,
    session_id: &str,
    thread_name: &str,
    action: &str,
    content: &str,
) -> Result<()> {
    let mut conn = open_connection(path)?;
    let tx = conn.transaction()?;
    ensure_thread_in_tx(&tx, session_id, thread_name)?;

    tx.execute(
        "INSERT INTO episodes (thread_name, session_id, action, content, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![thread_name, session_id, action, content, now_utc()],
    )?;

    tx.execute(
        "UPDATE threads
         SET updated_at = ?1
         WHERE name = ?2 AND session_id = ?3",
        params![now_utc(), thread_name, session_id],
    )?;

    tx.commit()?;
    Ok(())
}

pub fn load_worker_context(
    path: &Path,
    session_id: &str,
    thread_name: &str,
    source_threads: &[String],
) -> Result<WorkerContext> {
    let conn = open_connection(path)?;
    let self_episodes = load_thread_episodes(&conn, session_id, thread_name)?;
    let mut source_episodes = Vec::with_capacity(source_threads.len());

    for source_thread in source_threads {
        let episode = latest_episode(&conn, session_id, source_thread)?
            .ok_or_else(|| anyhow!("Source thread '{}' has no retained episode", source_thread))?;
        source_episodes.push(episode);
    }

    Ok(WorkerContext {
        self_episodes,
        source_episodes,
    })
}

pub fn list_threads(path: &Path, session_id: &str) -> Result<Vec<ThreadRecord>> {
    let conn = open_connection(path)?;
    let mut stmt = conn.prepare(
        "SELECT t.name, t.session_id, t.created_at, t.updated_at,
                (SELECT COUNT(*) FROM episodes e
                 WHERE e.thread_name = t.name AND e.session_id = t.session_id) AS episode_count
         FROM threads t
         WHERE t.session_id = ?1
         ORDER BY t.updated_at DESC, t.name ASC",
    )?;

    let mut rows = stmt.query([session_id])?;
    let mut threads = Vec::new();
    while let Some(row) = rows.next()? {
        threads.push(ThreadRecord {
            name: row.get(0)?,
            session_id: row.get(1)?,
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
            episode_count: row.get(4)?,
        });
    }
    Ok(threads)
}

pub fn thread_read(path: &Path, session_id: &str, thread_name: &str) -> Result<Vec<EpisodeRecord>> {
    let conn = open_connection(path)?;
    load_thread_episodes(&conn, session_id, thread_name)
}

pub fn delete_thread(path: &Path, session_id: &str, thread_name: &str) -> Result<bool> {
    let mut conn = open_connection(path)?;
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM episodes WHERE thread_name = ?1 AND session_id = ?2",
        params![thread_name, session_id],
    )?;
    let deleted = tx.execute(
        "DELETE FROM threads WHERE name = ?1 AND session_id = ?2",
        params![thread_name, session_id],
    )?;
    tx.commit()?;
    Ok(deleted > 0)
}

pub fn render_self_context(thread_name: &str, episodes: &[EpisodeRecord]) -> Option<String> {
    if episodes.is_empty() {
        return None;
    }

    let mut rendered = format!("Retained history for thread \"{}\":", thread_name);
    for (index, episode) in episodes.iter().enumerate() {
        rendered.push_str(&format!(
            "\n\n=== Episode {} | {} | action: {} ===\n{}",
            index + 1,
            episode.created_at,
            episode.action,
            episode.content
        ));
    }
    Some(rendered)
}

pub fn render_source_context(episode: &EpisodeRecord) -> String {
    format!(
        "Latest retained episode from thread \"{}\" | {} | action: {}\n{}",
        episode.thread_name, episode.created_at, episode.action, episode.content
    )
}

pub fn render_thread_document(thread_name: &str, episodes: &[EpisodeRecord]) -> String {
    if episodes.is_empty() {
        return format!("Thread \"{}\" has no retained episodes.", thread_name);
    }

    let mut rendered = format!(
        "Thread \"{}\" retained episodes ({} total):",
        thread_name,
        episodes.len()
    );
    for (index, episode) in episodes.iter().enumerate() {
        rendered.push_str(&format!(
            "\n\n=== Episode {} | {} | action: {} ===\n{}",
            index + 1,
            episode.created_at,
            episode.action,
            episode.content
        ));
    }
    rendered
}

fn open_connection(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create store dir {}", parent.display()))?;
    }

    let conn = Connection::open(path)
        .with_context(|| format!("failed to open SQLite store {}", path.display()))?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS threads (
             name TEXT NOT NULL,
             session_id TEXT NOT NULL,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             PRIMARY KEY (name, session_id)
         );
         CREATE TABLE IF NOT EXISTS episodes (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             thread_name TEXT NOT NULL,
             session_id TEXT NOT NULL,
             action TEXT NOT NULL,
             content TEXT NOT NULL,
             created_at TEXT NOT NULL,
             FOREIGN KEY (thread_name, session_id) REFERENCES threads(name, session_id)
         );
         CREATE INDEX IF NOT EXISTS idx_episodes_thread_session_created
             ON episodes(thread_name, session_id, id);",
    )?;
    Ok(conn)
}

fn ensure_thread_in_tx(tx: &Transaction<'_>, session_id: &str, thread_name: &str) -> Result<()> {
    let now = now_utc();
    tx.execute(
        "INSERT OR IGNORE INTO threads (name, session_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)",
        params![thread_name, session_id, now],
    )?;
    Ok(())
}

fn load_thread_episodes(
    conn: &Connection,
    session_id: &str,
    thread_name: &str,
) -> Result<Vec<EpisodeRecord>> {
    let mut stmt = conn.prepare(
        "SELECT id, thread_name, session_id, action, content, created_at
         FROM episodes
         WHERE thread_name = ?1 AND session_id = ?2
         ORDER BY id ASC",
    )?;
    let mut rows = stmt.query(params![thread_name, session_id])?;
    let mut episodes = Vec::new();
    while let Some(row) = rows.next()? {
        episodes.push(row_to_episode(row)?);
    }
    Ok(episodes)
}

fn latest_episode(
    conn: &Connection,
    session_id: &str,
    thread_name: &str,
) -> Result<Option<EpisodeRecord>> {
    conn.query_row(
        "SELECT id, thread_name, session_id, action, content, created_at
         FROM episodes
         WHERE thread_name = ?1 AND session_id = ?2
         ORDER BY id DESC
         LIMIT 1",
        params![thread_name, session_id],
        row_to_episode,
    )
    .optional()
    .map_err(Into::into)
}

fn row_to_episode(row: &rusqlite::Row<'_>) -> rusqlite::Result<EpisodeRecord> {
    Ok(EpisodeRecord {
        id: row.get(0)?,
        thread_name: row.get(1)?,
        session_id: row.get(2)?,
        action: row.get(3)?,
        content: row.get(4)?,
        created_at: row.get(5)?,
    })
}

fn now_utc() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs();
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let (h, rem) = (rem / 3_600, rem % 3_600);
    let (m, s) = (rem / 60, rem % 60);
    let (mut y, mut mo, mut day) = (1970i64, 1u32, 1u32);
    let mut remaining = days as i64;
    loop {
        let yd = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
            366
        } else {
            365
        };
        if remaining < yd {
            break;
        }
        remaining -= yd;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let mdays = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    for md in mdays {
        if remaining < md as i64 {
            break;
        }
        remaining -= md as i64;
        mo += 1;
    }
    day += remaining as u32;
    format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", y, mo, day, h, m, s)
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
        append_episode(&store_path, session_id, "auth", "inspect", "first auth episode").unwrap();
        append_episode(&store_path, session_id, "auth", "refactor", "second auth episode")
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
}
