use super::*;

const STORE_SCHEMA_VERSION: i64 = 3;

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
    if schema_version != STORE_SCHEMA_VERSION {
        drop(conn);
        return open_connection(path);
    }
    Ok(conn)
}

pub(crate) fn open_connection(path: &Path) -> Result<Connection> {
    let mut conn = connect(path)?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;",
    )?;

    let transaction = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let schema_version: i64 =
        transaction.pragma_query_value(None, "user_version", |row| row.get(0))?;
    match schema_version {
        0 | 1 => {
            create_base_schema(&transaction)?;
            ensure_workset_items_acceptance_column(&transaction)?;
            ensure_column(&transaction, "sessions", "backend", "TEXT")?;
            ensure_column(&transaction, "sessions", "reasoning_effort", "TEXT")?;
            ensure_column(
                &transaction,
                "sessions",
                "last_response_duration_ms",
                "INTEGER",
            )?;
            ensure_column(
                &transaction,
                "sessions",
                "previous_response_duration_ms",
                "INTEGER",
            )?;
            ensure_column(
                &transaction,
                "sessions",
                "response_durations_ms_json",
                "TEXT",
            )?;
            ensure_column(&transaction, "sessions", "host_id", "TEXT")?;
            ensure_column(&transaction, "sessions", "api_key_env", "TEXT")?;
            ensure_column(&transaction, "sessions", "extra_headers_json", "TEXT")?;
            ensure_column(&transaction, "sessions", "token_usages_json", "TEXT")?;
            ensure_column(
                &transaction,
                "sessions",
                "config_version",
                "INTEGER NOT NULL DEFAULT 0 CHECK (config_version >= 0)",
            )?;

            // Both v0 and v1 may contain some or all of the branch's v1
            // auxiliary tables. Rebuild every table that exists and create the
            // missing ones before applying the v3 addition.
            migrate_thread_steering(&transaction)?;
            migrate_thread_events(&transaction)?;
            transaction.execute_batch("DROP TABLE IF EXISTS session_overviews")?;
        }
        2 | STORE_SCHEMA_VERSION => {}
        unsupported => {
            return Err(anyhow!(
                "unsupported store schema version {unsupported}; this build supports versions 0, 1, 2, and {STORE_SCHEMA_VERSION}"
            ));
        }
    }

    ensure_column(
        &transaction,
        "sessions",
        "orchestrator_compaction_threshold",
        &format!(
            "INTEGER CHECK (orchestrator_compaction_threshold IS NULL OR (typeof(orchestrator_compaction_threshold) = 'integer' AND orchestrator_compaction_threshold > 0 AND orchestrator_compaction_threshold <= {}))",
            crate::MAX_SUPPORTED_TOKEN_COUNT
        ),
    )?;
    create_orchestrator_compaction_checkpoints_table(&transaction)?;
    verify_auxiliary_foreign_keys(&transaction)?;

    transaction.pragma_update(None, "user_version", STORE_SCHEMA_VERSION)?;
    transaction.commit()?;
    Ok(conn)
}

fn create_base_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS threads (
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
             orchestrator_compaction_threshold INTEGER
                 CHECK (orchestrator_compaction_threshold IS NULL OR
                        (typeof(orchestrator_compaction_threshold) = 'integer' AND
                         orchestrator_compaction_threshold > 0 AND
                         orchestrator_compaction_threshold <= {})),
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
         CREATE INDEX IF NOT EXISTS idx_episodes_thread_session_created
             ON episodes(thread_name, session_id, id);
         CREATE INDEX IF NOT EXISTS idx_worksets_session_updated
             ON worksets(session_id, updated_at DESC);
         CREATE INDEX IF NOT EXISTS idx_workset_items_workset_position
             ON workset_items(workset_id, session_id, position);
         CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
             ON sessions(updated_at DESC);",
        crate::MAX_SUPPORTED_TOKEN_COUNT,
    ))?;
    Ok(())
}

fn migrate_thread_steering(conn: &Connection) -> Result<()> {
    if !table_exists(conn, "thread_steering")? {
        create_thread_steering_table(conn, "thread_steering")?;
        create_thread_steering_indexes(conn)?;
        return Ok(());
    }

    let prior_sequence = autoincrement_sequence(conn, "thread_steering")?;
    let (source_count, orphan_count) = owned_row_counts(conn, "thread_steering")?;
    report_omitted_orphans("thread_steering", orphan_count);
    let has_v2_identity = column_exists(conn, "thread_steering", "dispatch_id")?
        && column_exists(conn, "thread_steering", "claimed_at")?;

    conn.execute_batch("DROP TABLE IF EXISTS thread_steering_v2")?;
    create_thread_steering_table(conn, "thread_steering_v2")?;
    let copied = if has_v2_identity {
        conn.execute(
            "INSERT INTO thread_steering_v2
                 (id, session_id, thread_name, dispatch_id, instruction, status,
                  created_at, claimed_at, delivered_at, expired_at)
             SELECT t.id, t.session_id, t.thread_name, t.dispatch_id, t.instruction,
                    t.status, t.created_at, t.claimed_at, t.delivered_at, t.expired_at
             FROM thread_steering t
             INNER JOIN sessions s ON s.session_id = t.session_id",
            [],
        )?
    } else {
        let migration_at = now_utc();
        conn.execute(
            "INSERT INTO thread_steering_v2
                 (id, session_id, thread_name, dispatch_id, instruction, status,
                  created_at, claimed_at, delivered_at, expired_at)
             SELECT t.id, t.session_id, t.thread_name,
                    'legacy-v1:' || CAST(t.id AS TEXT), t.instruction,
                    CASE WHEN t.status = 'queued' THEN 'expired' ELSE t.status END,
                    t.created_at,
                    CASE WHEN t.status = 'delivered'
                         THEN COALESCE(t.delivered_at, t.created_at) ELSE NULL END,
                    CASE WHEN t.status = 'delivered'
                         THEN COALESCE(t.delivered_at, t.created_at) ELSE NULL END,
                    CASE WHEN t.status = 'queued' THEN ?1
                         WHEN t.status = 'expired'
                         THEN COALESCE(t.expired_at, t.created_at) ELSE NULL END
             FROM thread_steering t
             INNER JOIN sessions s ON s.session_id = t.session_id",
            params![migration_at],
        )?
    };
    verify_copy_count("thread_steering", source_count, orphan_count, copied)?;
    conn.execute_batch(
        "DROP TABLE thread_steering;
         ALTER TABLE thread_steering_v2 RENAME TO thread_steering;",
    )?;
    restore_autoincrement_sequence(conn, "thread_steering", prior_sequence)?;
    create_thread_steering_indexes(conn)?;
    Ok(())
}

fn migrate_thread_events(conn: &Connection) -> Result<()> {
    if !table_exists(conn, "thread_events")? {
        create_thread_events_table(conn, "thread_events")?;
        create_thread_events_index(conn)?;
        return Ok(());
    }

    let prior_sequence = autoincrement_sequence(conn, "thread_events")?;
    let (source_count, orphan_count) = owned_row_counts(conn, "thread_events")?;
    report_omitted_orphans("thread_events", orphan_count);
    let records = {
        let mut statement = conn.prepare(
            "SELECT e.id, e.session_id, e.thread_name, e.event_json, e.created_at
             FROM thread_events e
             INNER JOIN sessions s ON s.session_id = e.session_id
             ORDER BY e.id",
        )?;
        let records = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        records
    };

    conn.execute_batch("DROP TABLE IF EXISTS thread_events_v2")?;
    create_thread_events_table(conn, "thread_events_v2")?;
    let mut copied = 0_i64;
    let mut unsafe_events = 0_i64;
    for (id, session_id, thread_name, event_json, created_at) in records {
        let sanitized = serde_json::from_str::<crate::events::AgentEvent>(&event_json)
            .ok()
            .and_then(crate::events::sanitize_external_agent_event);
        let Some(event) = sanitized else {
            unsafe_events += 1;
            continue;
        };
        let event_json = serde_json::to_string(&event)?;
        conn.execute(
            "INSERT INTO thread_events_v2
                 (id, session_id, thread_name, event_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, session_id, thread_name, event_json, created_at],
        )?;
        copied += 1;
    }
    if copied
        .checked_add(orphan_count)
        .and_then(|count| count.checked_add(unsafe_events))
        != Some(source_count)
    {
        return Err(anyhow!(
            "failed to account for all thread_events rows during migration"
        ));
    }
    if unsafe_events > 0 {
        eprintln!(
            "nac: schema migration omitted {unsafe_events} malformed, unsupported, or internal thread event row(s)"
        );
    }
    conn.execute_batch(
        "DROP TABLE thread_events;
         ALTER TABLE thread_events_v2 RENAME TO thread_events;",
    )?;
    restore_autoincrement_sequence(conn, "thread_events", prior_sequence)?;
    create_thread_events_index(conn)?;
    Ok(())
}

fn create_thread_steering_table(conn: &Connection, table: &str) -> Result<()> {
    conn.execute_batch(&format!(
        "CREATE TABLE {table} (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             thread_name TEXT NOT NULL,
             dispatch_id TEXT NOT NULL CHECK (length(trim(dispatch_id)) > 0),
             instruction TEXT NOT NULL,
             status TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'claimed', 'delivered', 'expired')),
             created_at TEXT NOT NULL,
             claimed_at TEXT,
             delivered_at TEXT,
             expired_at TEXT,
             CHECK (
                 (status = 'queued' AND claimed_at IS NULL
                     AND delivered_at IS NULL AND expired_at IS NULL)
                 OR (status = 'claimed' AND claimed_at IS NOT NULL
                     AND delivered_at IS NULL AND expired_at IS NULL)
                 OR (status = 'delivered' AND claimed_at IS NOT NULL
                     AND delivered_at IS NOT NULL AND expired_at IS NULL)
                 OR (status = 'expired' AND delivered_at IS NULL
                     AND expired_at IS NOT NULL)
             )
         );"
    ))?;
    Ok(())
}

fn create_thread_events_table(conn: &Connection, table: &str) -> Result<()> {
    conn.execute_batch(&format!(
        "CREATE TABLE {table} (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             thread_name TEXT NOT NULL,
             event_json TEXT NOT NULL,
             created_at TEXT NOT NULL
         );"
    ))?;
    Ok(())
}

fn create_thread_steering_indexes(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE INDEX idx_thread_steering_target_pending
             ON thread_steering(session_id, dispatch_id, status, id);
         CREATE INDEX idx_thread_steering_session_thread
             ON thread_steering(session_id, thread_name, id);",
    )?;
    Ok(())
}

fn create_thread_events_index(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE INDEX idx_thread_events_session_thread_id
             ON thread_events(session_id, thread_name, id DESC);",
    )?;
    Ok(())
}

fn create_orchestrator_compaction_checkpoints_table(conn: &Connection) -> Result<()> {
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS orchestrator_compaction_checkpoints (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             previous_checkpoint_id INTEGER,
             summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
             tail_start_message_index INTEGER NOT NULL
                 CHECK (tail_start_message_index >= 0),
             source_prefix_sha256 BLOB NOT NULL
                 CHECK (length(source_prefix_sha256) = 32),
             system_policy_sha256 BLOB NOT NULL
                 CHECK (length(system_policy_sha256) = 32),
             prompt_policy_version INTEGER NOT NULL
                 CHECK (prompt_policy_version > 0
                        AND prompt_policy_version <= 4294967295),
             old_context_estimate INTEGER NOT NULL
                 CHECK (old_context_estimate >= 0
                        AND old_context_estimate <= {max}),
             summary_prompt_tokens INTEGER
                 CHECK (summary_prompt_tokens IS NULL OR
                        (summary_prompt_tokens >= 0
                         AND summary_prompt_tokens <= {max})),
             summary_completion_tokens INTEGER
                 CHECK (summary_completion_tokens IS NULL OR
                        (summary_completion_tokens >= 0
                         AND summary_completion_tokens <= {max})),
             new_context_estimate INTEGER NOT NULL
                 CHECK (new_context_estimate >= 0
                        AND new_context_estimate <= {max}),
             created_at TEXT NOT NULL,
             UNIQUE (session_id, id),
             FOREIGN KEY (session_id, previous_checkpoint_id)
                 REFERENCES orchestrator_compaction_checkpoints(session_id, id)
                 ON DELETE CASCADE
         );
         CREATE INDEX IF NOT EXISTS idx_orchestrator_compaction_checkpoints_latest
             ON orchestrator_compaction_checkpoints(session_id, id DESC);",
        max = crate::MAX_SUPPORTED_TOKEN_COUNT,
    ))?;
    Ok(())
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(
             SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1
         )",
        params![table],
        |row| row.get(0),
    )?)
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut statement = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    for existing in columns {
        if existing? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn owned_row_counts(conn: &Connection, table: &str) -> Result<(i64, i64)> {
    let source_count = conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
        row.get(0)
    })?;
    let orphan_count = conn.query_row(
        &format!(
            "SELECT COUNT(*)
             FROM {table} child
             LEFT JOIN sessions parent ON parent.session_id = child.session_id
             WHERE parent.session_id IS NULL"
        ),
        [],
        |row| row.get(0),
    )?;
    Ok((source_count, orphan_count))
}

fn report_omitted_orphans(table: &str, count: i64) {
    if count > 0 {
        eprintln!("nac: schema migration omitted {count} session-orphan row(s) from {table}");
    }
}

fn verify_copy_count(
    table: &str,
    source_count: i64,
    orphan_count: i64,
    copied: usize,
) -> Result<()> {
    let expected = source_count
        .checked_sub(orphan_count)
        .ok_or_else(|| anyhow!("invalid migration counts for {table}"))?;
    if i64::try_from(copied).ok() != Some(expected) {
        return Err(anyhow!(
            "failed to preserve all session-owned {table} rows during migration"
        ));
    }
    Ok(())
}

fn autoincrement_sequence(conn: &Connection, table: &str) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT seq FROM sqlite_sequence WHERE name = ?1",
            params![table],
            |row| row.get(0),
        )
        .optional()?)
}

fn restore_autoincrement_sequence(
    conn: &Connection,
    table: &str,
    prior_sequence: Option<i64>,
) -> Result<()> {
    let Some(prior_sequence) = prior_sequence else {
        return Ok(());
    };
    let updated = conn.execute(
        "UPDATE sqlite_sequence
         SET seq = MAX(seq, ?2)
         WHERE name = ?1",
        params![table, prior_sequence],
    )?;
    if updated == 0 {
        conn.execute(
            "INSERT INTO sqlite_sequence (name, seq) VALUES (?1, ?2)",
            params![table, prior_sequence],
        )?;
    }
    Ok(())
}

fn verify_auxiliary_foreign_keys(conn: &Connection) -> Result<()> {
    for table in [
        "thread_steering",
        "thread_events",
        "orchestrator_compaction_checkpoints",
    ] {
        let mut statement = conn.prepare(&format!("PRAGMA foreign_key_check({table})"))?;
        if statement.query([])?.next()?.is_some() {
            return Err(anyhow!(
                "foreign key check failed for migrated table {table}"
            ));
        }
    }
    Ok(())
}

fn ensure_workset_items_acceptance_column(conn: &Connection) -> Result<()> {
    if column_exists(conn, "workset_items", "acceptance")? {
        return Ok(());
    }
    conn.execute(
        "ALTER TABLE workset_items ADD COLUMN acceptance TEXT NOT NULL DEFAULT ''",
        [],
    )?;
    Ok(())
}

fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<()> {
    if column_exists(conn, table, column)? {
        return Ok(());
    }
    let alter = format!("ALTER TABLE {table} ADD COLUMN {column} {definition}");
    conn.execute(&alter, [])?;
    Ok(())
}

#[cfg(test)]
#[path = "schema_tests.rs"]
mod tests;
