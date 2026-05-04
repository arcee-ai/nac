use super::*;

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
