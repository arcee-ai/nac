use std::collections::HashMap;
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
    pub thread_name: String,
    pub scope: String,
    pub description: String,
    pub item_kind: String,
    pub status: String,
    pub source_threads: Vec<String>,
    pub last_summary: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorksetRecord {
    pub id: String,
    pub session_id: String,
    pub kind: String,
    pub instruction: String,
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
    pub kind: String,
    pub status: String,
    pub summary: String,
    pub item_count: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorksetItemDefinition {
    pub title: String,
    pub thread_name: String,
    pub scope: String,
    pub description: String,
    pub item_kind: String,
    pub status: String,
    pub source_threads: Vec<String>,
    pub last_summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorksetDefinition {
    pub id: String,
    pub kind: String,
    pub instruction: String,
    pub status: String,
    pub summary: String,
    pub verification_recipe: Option<String>,
    pub items: Vec<WorksetItemDefinition>,
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

/// Load all episodes for all threads in one query, grouped by thread_name.
/// Episodes are ordered by id ASC (chronological order).
pub fn load_all_episodes(
    store_path: &Path,
    session_id: &str,
) -> Result<HashMap<String, Vec<EpisodeRecord>>> {
    let conn = open_connection(store_path)?;
    let mut stmt = conn.prepare(
        "SELECT e.id, e.thread_name, e.session_id, e.action, e.content, e.created_at
         FROM episodes e
         INNER JOIN threads t ON e.thread_name = t.name AND e.session_id = t.session_id
         WHERE e.session_id = ?
         ORDER BY e.thread_name, e.id",
    )?;
    let rows = stmt.query_map(params![session_id], row_to_episode)?;

    let mut grouped: HashMap<String, Vec<EpisodeRecord>> = HashMap::new();
    for row in rows {
        let episode = row?;
        grouped
            .entry(episode.thread_name.clone())
            .or_default()
            .push(episode);
    }
    Ok(grouped)
}

pub fn list_threads(path: &Path, session_id: &str) -> Result<Vec<ThreadRecord>> {
    let conn = open_connection(path)?;
    let mut stmt = conn.prepare(
        "SELECT t.name, t.session_id, t.created_at, t.updated_at,
                (SELECT COUNT(*) FROM episodes e
                 WHERE e.thread_name = t.name AND e.session_id = t.session_id) AS episode_count,
                (SELECT e.action FROM episodes e
                 WHERE e.thread_name = t.name AND e.session_id = t.session_id
                 ORDER BY e.id DESC
                 LIMIT 1) AS latest_action
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
            latest_action: row.get(5)?,
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

pub fn define_workset(path: &Path, session_id: &str, workset: &WorksetDefinition) -> Result<()> {
    let mut conn = open_connection(path)?;
    let tx = conn.transaction()?;
    let now = now_utc();
    let created_at = tx
        .query_row(
            "SELECT created_at
             FROM worksets
             WHERE id = ?1 AND session_id = ?2",
            params![workset.id, session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .unwrap_or_else(|| now.clone());

    tx.execute(
        "INSERT INTO worksets (
             id, session_id, kind, instruction, status, summary, verification_recipe, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id, session_id) DO UPDATE SET
             kind = excluded.kind,
             instruction = excluded.instruction,
             status = excluded.status,
             summary = excluded.summary,
             verification_recipe = excluded.verification_recipe,
             updated_at = excluded.updated_at",
        params![
            workset.id,
            session_id,
            workset.kind,
            workset.instruction,
            workset.status,
            workset.summary,
            workset.verification_recipe,
            created_at,
            now,
        ],
    )?;

    tx.execute(
        "DELETE FROM workset_items WHERE workset_id = ?1 AND session_id = ?2",
        params![workset.id, session_id],
    )?;

    for (index, item) in workset.items.iter().enumerate() {
        tx.execute(
            "INSERT INTO workset_items (
                 workset_id, session_id, position, title, thread_name, scope, description,
                 item_kind, status, source_threads_json, last_summary, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                workset.id,
                session_id,
                index as i64 + 1,
                item.title,
                item.thread_name,
                item.scope,
                item.description,
                item.item_kind,
                item.status,
                serde_json::to_string(&item.source_threads)?,
                item.last_summary,
                now,
            ],
        )?;
    }

    tx.commit()?;
    Ok(())
}

pub fn read_workset(path: &Path, session_id: &str, id: &str) -> Result<Option<WorksetRecord>> {
    let conn = open_connection(path)?;
    let Some(mut workset) = conn
        .query_row(
            "SELECT id, session_id, kind, instruction, status, summary, verification_recipe, created_at, updated_at
             FROM worksets
             WHERE id = ?1 AND session_id = ?2",
            params![id, session_id],
            row_to_workset,
        )
        .optional()?
    else {
        return Ok(None);
    };
    workset.items = load_workset_items(&conn, session_id, id)?;
    Ok(Some(workset))
}

pub fn list_worksets(
    path: &Path,
    session_id: &str,
    kind: Option<&str>,
) -> Result<Vec<WorksetSummary>> {
    let conn = open_connection(path)?;
    let sql = if kind.is_some() {
        "SELECT w.id, w.kind, w.status, w.summary,
                (SELECT COUNT(*) FROM workset_items i
                 WHERE i.workset_id = w.id AND i.session_id = w.session_id) AS item_count,
                w.updated_at
         FROM worksets w
         WHERE w.session_id = ?1 AND w.kind = ?2
         ORDER BY w.updated_at DESC, w.id ASC"
    } else {
        "SELECT w.id, w.kind, w.status, w.summary,
                (SELECT COUNT(*) FROM workset_items i
                 WHERE i.workset_id = w.id AND i.session_id = w.session_id) AS item_count,
                w.updated_at
         FROM worksets w
         WHERE w.session_id = ?1
         ORDER BY w.updated_at DESC, w.id ASC"
    };
    let mut stmt = conn.prepare(sql)?;
    let mut rows = if let Some(kind) = kind {
        stmt.query(params![session_id, kind])?
    } else {
        stmt.query(params![session_id])?
    };

    let mut worksets = Vec::new();
    while let Some(row) = rows.next()? {
        worksets.push(WorksetSummary {
            id: row.get(0)?,
            kind: row.get(1)?,
            status: row.get(2)?,
            summary: row.get(3)?,
            item_count: row.get(4)?,
            updated_at: row.get(5)?,
        });
    }
    Ok(worksets)
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

pub fn render_workset_document(workset: &WorksetRecord) -> String {
    let mut rendered = format!(
        "Workset \"{}\" | kind: {} | status: {} | {} item(s)",
        workset.id,
        workset.kind,
        workset.status,
        workset.items.len()
    );
    rendered.push_str(&format!(
        "\nsummary: {}",
        if workset.summary.is_empty() {
            "(none)"
        } else {
            &workset.summary
        }
    ));
    rendered.push_str(&format!("\ninstruction: {}", workset.instruction));
    if let Some(recipe) = workset.verification_recipe.as_deref() {
        rendered.push_str(&format!("\nverification: {}", recipe));
    }
    rendered.push_str(&format!(
        "\ncreated: {} | updated: {}",
        workset.created_at, workset.updated_at
    ));

    if workset.items.is_empty() {
        rendered.push_str("\n\nNo workset items defined.");
        return rendered;
    }

    rendered.push_str("\n\nItems:");
    for item in &workset.items {
        let sources = if item.source_threads.is_empty() {
            "none".to_string()
        } else {
            item.source_threads.join(", ")
        };
        rendered.push_str(&format!(
            "\n\n{}. [{}] {}",
            item.position, item.status, item.title
        ));
        rendered.push_str(&format!("\n   thread: {}", item.thread_name));
        rendered.push_str(&format!("\n   scope: {}", item.scope));
        rendered.push_str(&format!("\n   kind: {}", item.item_kind));
        rendered.push_str(&format!("\n   sources: {}", sources));
        rendered.push_str(&format!("\n   description: {}", item.description));
        if let Some(summary) = item.last_summary.as_deref() {
            rendered.push_str(&format!("\n   last summary: {}", summary));
        }
    }
    rendered
}

pub fn render_workset_list(worksets: &[WorksetSummary]) -> String {
    if worksets.is_empty() {
        return "No worksets in this session.".to_string();
    }

    let mut rendered = String::from("Worksets:");
    for workset in worksets {
        rendered.push_str(&format!(
            "\n- {} | {} | {} | {} item(s) | updated {}",
            workset.id, workset.kind, workset.status, workset.item_count, workset.updated_at
        ));
        if !workset.summary.is_empty() {
            rendered.push_str(&format!("\n  {}", workset.summary));
        }
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
         CREATE TABLE IF NOT EXISTS worksets (
             id TEXT NOT NULL,
             session_id TEXT NOT NULL,
             kind TEXT NOT NULL,
             instruction TEXT NOT NULL,
             status TEXT NOT NULL,
             summary TEXT NOT NULL,
             verification_recipe TEXT,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             PRIMARY KEY (id, session_id)
         );
         CREATE TABLE IF NOT EXISTS workset_items (
             workset_id TEXT NOT NULL,
             session_id TEXT NOT NULL,
             position INTEGER NOT NULL,
             title TEXT NOT NULL,
             thread_name TEXT NOT NULL,
             scope TEXT NOT NULL,
             description TEXT NOT NULL,
             item_kind TEXT NOT NULL,
             status TEXT NOT NULL,
             source_threads_json TEXT NOT NULL,
             last_summary TEXT,
             updated_at TEXT NOT NULL,
             PRIMARY KEY (workset_id, session_id, position),
             FOREIGN KEY (workset_id, session_id) REFERENCES worksets(id, session_id)
         );
         CREATE INDEX IF NOT EXISTS idx_episodes_thread_session_created
             ON episodes(thread_name, session_id, id);
         CREATE INDEX IF NOT EXISTS idx_worksets_session_updated
             ON worksets(session_id, updated_at DESC);
         CREATE INDEX IF NOT EXISTS idx_workset_items_workset_position
             ON workset_items(workset_id, session_id, position);",
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

fn row_to_workset(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorksetRecord> {
    Ok(WorksetRecord {
        id: row.get(0)?,
        session_id: row.get(1)?,
        kind: row.get(2)?,
        instruction: row.get(3)?,
        status: row.get(4)?,
        summary: row.get(5)?,
        verification_recipe: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        items: Vec::new(),
    })
}

fn load_workset_items(
    conn: &Connection,
    session_id: &str,
    workset_id: &str,
) -> Result<Vec<WorksetItemRecord>> {
    let mut stmt = conn.prepare(
        "SELECT position, title, thread_name, scope, description, item_kind, status,
                source_threads_json, last_summary, updated_at
         FROM workset_items
         WHERE workset_id = ?1 AND session_id = ?2
         ORDER BY position ASC",
    )?;
    let mut rows = stmt.query(params![workset_id, session_id])?;
    let mut items = Vec::new();
    while let Some(row) = rows.next()? {
        let source_threads_json: String = row.get(7)?;
        let source_threads = serde_json::from_str::<Vec<String>>(&source_threads_json)
            .unwrap_or_else(|_| vec![source_threads_json]);
        items.push(WorksetItemRecord {
            position: row.get(0)?,
            title: row.get(1)?,
            thread_name: row.get(2)?,
            scope: row.get(3)?,
            description: row.get(4)?,
            item_kind: row.get(5)?,
            status: row.get(6)?,
            source_threads,
            last_summary: row.get(8)?,
            updated_at: row.get(9)?,
        });
    }
    Ok(items)
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
            id: "batch-auth-refresh".to_string(),
            kind: "batch".to_string(),
            instruction: "refresh auth flow".to_string(),
            status: "planned".to_string(),
            summary: "Split auth refresh into reviewable units.".to_string(),
            verification_recipe: Some("cargo test -p nac".to_string()),
            items: vec![
                WorksetItemDefinition {
                    title: "Inspect auth state handling".to_string(),
                    thread_name: "research/auth-state".to_string(),
                    scope: "crates/nac/src/agent.rs".to_string(),
                    description: "Map auth state behavior and risks.".to_string(),
                    item_kind: "research".to_string(),
                    status: "planned".to_string(),
                    source_threads: Vec::new(),
                    last_summary: None,
                },
                WorksetItemDefinition {
                    title: "Implement auth state update".to_string(),
                    thread_name: "impl/auth-state".to_string(),
                    scope: "crates/nac/src/tui.rs".to_string(),
                    description: "Apply the focused code change.".to_string(),
                    item_kind: "implement".to_string(),
                    status: "planned".to_string(),
                    source_threads: vec!["research/auth-state".to_string()],
                    last_summary: Some("waiting on research".to_string()),
                },
            ],
        };

        define_workset(&store_path, session_id, &definition).unwrap();

        let workset = read_workset(&store_path, session_id, "batch-auth-refresh")
            .unwrap()
            .expect("expected workset");
        assert_eq!(workset.kind, "batch");
        assert_eq!(workset.items.len(), 2);
        assert_eq!(workset.items[1].source_threads, vec!["research/auth-state"]);

        let listed = list_worksets(&store_path, session_id, Some("batch")).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "batch-auth-refresh");

        let rendered = render_workset_document(&workset);
        assert!(rendered.contains("Inspect auth state handling"));
        assert!(rendered.contains("verification: cargo test -p nac"));
        assert!(render_workset_list(&listed).contains("batch-auth-refresh"));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }
}
