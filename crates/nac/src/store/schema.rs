use super::*;

pub fn default_store_path() -> PathBuf {
    PathBuf::from(".nac").join("store.db")
}

pub fn initialize(path: &Path) -> Result<()> {
    let _ = open_connection(path)?;
    Ok(())
}

pub(super) fn open_connection(path: &Path) -> Result<Connection> {
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
             acceptance TEXT NOT NULL DEFAULT '',
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
    ensure_workset_items_acceptance_column(&conn)?;
    Ok(conn)
}

fn ensure_workset_items_acceptance_column(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(workset_items)")?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == "acceptance" {
            return Ok(());
        }
    }

    conn.execute(
        "ALTER TABLE workset_items ADD COLUMN acceptance TEXT NOT NULL DEFAULT ''",
        [],
    )?;
    Ok(())
}
