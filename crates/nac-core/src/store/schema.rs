use super::*;

const STORE_SCHEMA_VERSION: i64 = 1;

/// Default SQLite store path under the nac home, or `.nac/store.db` as fallback.
pub fn default_store_path() -> PathBuf {
    crate::paths::nac_home_dir()
        .map(|home| home.join("store.db"))
        .unwrap_or_else(|| PathBuf::from(".nac").join("store.db"))
}

pub fn initialize(path: &Path) -> Result<()> {
    let _ = open_connection(path)?;
    Ok(())
}

fn connect(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create store dir {}", parent.display()))?;
    }

    let conn = Connection::open(path)
        .with_context(|| format!("failed to open SQLite store {}", path.display()))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(conn)
}

pub(crate) fn open_runtime_connection(path: &Path) -> Result<Connection> {
    let conn = connect(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    let schema_version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if schema_version < STORE_SCHEMA_VERSION {
        drop(conn);
        return open_connection(path);
    }
    Ok(conn)
}

pub(crate) fn open_connection(path: &Path) -> Result<Connection> {
    let conn = connect(path)?;
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
         CREATE TABLE IF NOT EXISTS sessions (
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
             response_durations_ms_json TEXT,
             api_key_env TEXT,
             extra_headers_json TEXT,
             token_usages_json TEXT,
             config_version INTEGER NOT NULL DEFAULT 0 CHECK (config_version >= 0),
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS session_presentations (
             session_id TEXT PRIMARY KEY
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             title TEXT,
             pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
             sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
             version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
         );
         CREATE TABLE IF NOT EXISTS session_overviews (
             session_id TEXT PRIMARY KEY
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             status TEXT NOT NULL,
             focus_json TEXT NOT NULL,
             completed_json TEXT NOT NULL,
             blockers_json TEXT NOT NULL,
             next_steps_json TEXT NOT NULL,
             model TEXT NOT NULL,
             generated_at TEXT NOT NULL,
             source_updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS thread_steering (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             session_id TEXT NOT NULL,
             thread_name TEXT NOT NULL,
             instruction TEXT NOT NULL,
             status TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'delivered', 'expired')),
             created_at TEXT NOT NULL,
             delivered_at TEXT,
             expired_at TEXT
         );
         CREATE TABLE IF NOT EXISTS thread_events (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             session_id TEXT NOT NULL,
             thread_name TEXT NOT NULL,
             event_json TEXT NOT NULL,
             created_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_episodes_thread_session_created
             ON episodes(thread_name, session_id, id);
         CREATE INDEX IF NOT EXISTS idx_worksets_session_updated
             ON worksets(session_id, updated_at DESC);
         CREATE INDEX IF NOT EXISTS idx_workset_items_workset_position
             ON workset_items(workset_id, session_id, position);
         CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
             ON sessions(updated_at DESC);
         CREATE INDEX IF NOT EXISTS idx_thread_steering_pending
             ON thread_steering(session_id, thread_name, status, id);
         CREATE INDEX IF NOT EXISTS idx_thread_events_session_thread_id
             ON thread_events(session_id, thread_name, id DESC);",
    )?;
    ensure_workset_items_acceptance_column(&conn)?;
    ensure_column(&conn, "sessions", "backend", "TEXT")?;
    ensure_column(&conn, "sessions", "reasoning_effort", "TEXT")?;
    ensure_column(&conn, "sessions", "last_response_duration_ms", "INTEGER")?;
    ensure_column(
        &conn,
        "sessions",
        "previous_response_duration_ms",
        "INTEGER",
    )?;
    ensure_column(&conn, "sessions", "response_durations_ms_json", "TEXT")?;
    ensure_column(&conn, "sessions", "host_id", "TEXT")?;
    ensure_column(&conn, "sessions", "api_key_env", "TEXT")?;
    ensure_column(&conn, "sessions", "extra_headers_json", "TEXT")?;
    ensure_column(&conn, "sessions", "token_usages_json", "TEXT")?;
    ensure_column(
        &conn,
        "sessions",
        "config_version",
        "INTEGER NOT NULL DEFAULT 0 CHECK (config_version >= 0)",
    )?;
    conn.pragma_update(None, "user_version", STORE_SCHEMA_VERSION)?;
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

fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<()> {
    let pragma = format!("PRAGMA table_info({})", table);
    let mut stmt = conn.prepare(&pragma)?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for existing in columns {
        if existing? == column {
            return Ok(());
        }
    }

    let alter = format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, definition);
    conn.execute(&alter, [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_zero_store_migrates_additively_and_remains_legacy_readable() {
        let path = std::env::temp_dir()
            .join(format!(
                "nac_schema_compat_{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ))
            .join("store.db");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();

        let legacy = Connection::open(&path).unwrap();
        legacy
            .execute_batch(
                "PRAGMA user_version = 0;
                 CREATE TABLE sessions (
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
                     response_durations_ms_json TEXT,
                     api_key_env TEXT,
                     extra_headers_json TEXT,
                     token_usages_json TEXT,
                     config_version INTEGER NOT NULL DEFAULT 0,
                     created_at TEXT NOT NULL,
                     updated_at TEXT NOT NULL
                 );
                 CREATE TABLE threads (
                     name TEXT NOT NULL,
                     session_id TEXT NOT NULL,
                     created_at TEXT NOT NULL,
                     updated_at TEXT NOT NULL,
                     PRIMARY KEY (name, session_id)
                 );
                 CREATE TABLE episodes (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     thread_name TEXT NOT NULL,
                     session_id TEXT NOT NULL,
                     action TEXT NOT NULL,
                     content TEXT NOT NULL,
                     created_at TEXT NOT NULL,
                     FOREIGN KEY (thread_name, session_id) REFERENCES threads(name, session_id)
                 );
                 INSERT INTO sessions
                     (session_id, cwd, store_path, model, base_url, backend,
                      messages_json, created_at, updated_at)
                 VALUES
                     ('legacy-session', '/tmp/project', '/tmp/store.db', 'legacy-model',
                      'https://example.invalid', 'openai-responses', '[]',
                      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
                 INSERT INTO threads
                     (name, session_id, created_at, updated_at)
                 VALUES
                     ('legacy-thread', 'legacy-session',
                      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
                 INSERT INTO episodes
                     (thread_name, session_id, action, content, created_at)
                 VALUES
                     ('legacy-thread', 'legacy-session', 'inspect', 'preserved',
                      '2026-01-01T00:00:00Z');",
            )
            .unwrap();
        drop(legacy);

        initialize(&path).unwrap();

        let migrated = Connection::open(&path).unwrap();
        let version: i64 = migrated
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, STORE_SCHEMA_VERSION);
        for table in ["session_overviews", "thread_steering", "thread_events"] {
            let exists: bool = migrated
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                    params![table],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(exists, "missing additive table {table}");
        }

        // These are columns and tables the pre-redesign server reads. New tables and
        // PRAGMA user_version must not change the result of those legacy queries.
        let legacy_session: (String, String, String, String) = migrated
            .query_row(
                "SELECT session_id, cwd, model, messages_json FROM sessions WHERE session_id = ?1",
                params!["legacy-session"],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            legacy_session,
            (
                "legacy-session".to_string(),
                "/tmp/project".to_string(),
                "legacy-model".to_string(),
                "[]".to_string(),
            )
        );
        let episode: String = migrated
            .query_row(
                "SELECT content FROM episodes WHERE thread_name = ?1 AND session_id = ?2",
                params!["legacy-thread", "legacy-session"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(episode, "preserved");

        drop(migrated);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
