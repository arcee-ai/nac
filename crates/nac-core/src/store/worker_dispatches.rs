//! Host-owned admission and atomic episode receipts. No process/transport effects
//! occur inside these transactions. A receipt survives loss of the worker ack.
use super::*;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WorkerDispatchIdentity {
    pub session_id: String,
    pub thread_name: String,
    pub dispatch_id: String,
    pub generation: i64,
    pub run_id: Option<String>,
}

pub(super) fn create_worker_dispatches_table(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS worker_dispatches (
            dispatch_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
            thread_name TEXT NOT NULL,
            generation INTEGER NOT NULL CHECK (generation > 0),
            run_id TEXT,
            action TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'ok', 'error', 'timed_out', 'cancelled')),
            episode_id INTEGER,
            history_start_id INTEGER,
            history_boundary_id INTEGER NOT NULL DEFAULT 0,
            UNIQUE (session_id, thread_name, generation),
            FOREIGN KEY (thread_name, session_id) REFERENCES threads(name, session_id) ON DELETE CASCADE,
            CHECK ((status = 'pending' AND episode_id IS NULL) OR
                   (status <> 'pending' AND episode_id IS NOT NULL))
        );",
    )?;
    Ok(())
}

coordinated_command! {
pub(crate) fn admit_worker_dispatch(
    path: &Path,
    session_id: &str,
    thread_name: &str,
    dispatch_id: &str,
    run_id: Option<&str>,
    action: &str,
) -> Result<WorkerDispatchIdentity> {
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    validate_run(&tx, session_id, run_id)?;
    super::threads::ensure_thread_in_tx(&tx, session_id, thread_name)?;
    let generation = tx.query_row(
        "SELECT COALESCE(MAX(generation), 0) + 1 FROM worker_dispatches
         WHERE session_id = ?1 AND thread_name = ?2",
        params![session_id, thread_name],
        |row| row.get(0),
    )?;
    tx.execute(
        "INSERT INTO worker_dispatches
         (dispatch_id, session_id, thread_name, generation, run_id, action, status, history_boundary_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending',
            (SELECT COALESCE(MAX(id), 0) FROM thread_events WHERE session_id = ?2 AND thread_name = ?3))",
        params![
            dispatch_id,
            session_id,
            thread_name,
            generation,
            run_id,
            action
        ],
    )?;
    tx.commit()?;
    Ok(WorkerDispatchIdentity {
        session_id: session_id.into(),
        thread_name: thread_name.into(),
        dispatch_id: dispatch_id.into(),
        generation,
        run_id: run_id.map(str::to_owned),
    })
}
command AdmitWorkerDispatchCommand {
    session_id: String = session_id.to_owned(),
    thread_name: String = thread_name.to_owned(),
    dispatch_id: String = dispatch_id.to_owned(),
    run_id: Option<String> = run_id.map(str::to_owned),
    action: String = action.to_owned(),
}
call |command| (&command.session_id, &command.thread_name, &command.dispatch_id, command.run_id.as_deref(), &command.action)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)).with_run(command.run_id.as_deref());
port internal;
}

// Bind required history to this admitted generation's acknowledged start row.
// Raw supervision/receipt fixtures retain their established optional journal.
coordinated_command! {
pub(crate) fn require_worker_history(path: &Path, identity: &WorkerDispatchIdentity) -> Result<()> {
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    validate_run(&tx, &identity.session_id, identity.run_id.as_deref())?;
    let (id, json): (i64, String) = tx.query_row(
        "SELECT id, event_json FROM thread_events WHERE session_id = ?1 AND thread_name = ?2 ORDER BY id DESC LIMIT 1",
        params![identity.session_id, identity.thread_name], |row| Ok((row.get(0)?, row.get(1)?)))?;
    let event: serde_json::Value = serde_json::from_str(&json)?;
    anyhow::ensure!(event.get("type").and_then(serde_json::Value::as_str) == Some("thread_started"),
        "required worker start history is missing");
    let changed = tx.execute(
        "UPDATE worker_dispatches SET history_start_id = ?6 WHERE dispatch_id = ?1 AND session_id = ?2
         AND thread_name = ?3 AND generation = ?4 AND run_id IS ?5 AND status = 'pending'
         AND ?6 > history_boundary_id
         AND generation = (SELECT MAX(generation) FROM worker_dispatches WHERE session_id = ?2 AND thread_name = ?3)",
        params![identity.dispatch_id, identity.session_id, identity.thread_name, identity.generation, identity.run_id, id])?;
    anyhow::ensure!(changed == 1, "worker history identity is stale or unknown");
    tx.commit()?;
    Ok(())
}
command RequireWorkerHistoryCommand { identity: WorkerDispatchIdentity = identity.clone(), }
call |command| (&command.identity)
correlation |command| crate::telemetry::Correlation::session(Some(&command.identity.session_id));
port public;
}

fn validate_required_history(
    tx: &Transaction<'_>,
    identity: &WorkerDispatchIdentity,
) -> Result<()> {
    let start: Option<i64> = tx.query_row(
        "SELECT history_start_id FROM worker_dispatches WHERE dispatch_id = ?1",
        [&identity.dispatch_id],
        |row| row.get(0),
    )?;
    let Some(start) = start else {
        return Ok(());
    };
    let mut stmt = tx.prepare("SELECT id, event_json FROM thread_events WHERE session_id = ?1 AND thread_name = ?2 AND id >= ?3 ORDER BY id")?;
    let mut rows = stmt.query(params![identity.session_id, identity.thread_name, start])?;
    let mut thread_started = false;
    let mut run_started = false;
    let mut assistant = false;
    while let Some(row) = rows.next()? {
        let id: i64 = row.get(0)?;
        let json: String = row.get(1)?;
        let event: serde_json::Value = serde_json::from_str(&json)?;
        match event.get("type").and_then(serde_json::Value::as_str) {
            Some("thread_started") if id == start => thread_started = true,
            Some("thread_started") => {
                anyhow::bail!("worker history crossed another dispatch start")
            }
            Some("run_started") if thread_started => run_started = true,
            Some("assistant_message") if run_started => assistant = true,
            _ => {}
        }
    }
    anyhow::ensure!(
        thread_started && run_started && assistant,
        "worker completion rejected because required durable prefix is incomplete"
    );
    Ok(())
}

fn validate_run(conn: &Connection, session_id: &str, run_id: Option<&str>) -> Result<()> {
    let current = load_run_recovery_with_connection(conn, session_id)?;
    if current.as_ref().map(|row| row.run_id.as_str()) != run_id
        || current.is_some_and(|row| {
            row.status != RunRecoveryStatus::Active || row.terminal_disposition.is_some()
        })
    {
        anyhow::bail!("worker dispatch has a stale session run");
    }
    Ok(())
}

coordinated_command! {
pub(crate) fn commit_worker_episode(
    path: &Path,
    identity: &WorkerDispatchIdentity,
    content: &str,
    status: EpisodeStatus,
) -> Result<i64> {
    crate::telemetry::observe_store(
        crate::telemetry::StoreOperation::WorkerEpisodeCommit,
        crate::telemetry::Correlation::session(Some(&identity.session_id)),
        || {
            let mut conn = open_runtime_connection(path)?;
            let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            let id = commit_in_tx(&tx, identity, content, status)?;
            tx.commit()?;
            Ok(id)
        },
    )
}
command CommitWorkerEpisodeCommand {
    identity: WorkerDispatchIdentity = identity.clone(),
    content: String = content.to_owned(),
    status: EpisodeStatus = status,
}
call |command| (&command.identity, &command.content, command.status)
correlation |command| crate::telemetry::Correlation::session(Some(&command.identity.session_id));
port internal;
}

fn commit_in_tx(
    tx: &Transaction<'_>,
    identity: &WorkerDispatchIdentity,
    content: &str,
    status: EpisodeStatus,
) -> Result<i64> {
    let (action, existing): (String, Option<i64>) = tx
        .query_row(
            "SELECT action, episode_id FROM worker_dispatches
         WHERE dispatch_id = ?1 AND session_id = ?2 AND thread_name = ?3
           AND generation = ?4 AND run_id IS ?5
           AND generation = (SELECT MAX(generation) FROM worker_dispatches
                             WHERE session_id = ?2 AND thread_name = ?3)",
            params![
                identity.dispatch_id,
                identity.session_id,
                identity.thread_name,
                identity.generation,
                identity.run_id
            ],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| anyhow!("worker dispatch identity is stale or unknown"))?;
    // Exact committed replay is read-only, including after run settlement or
    // restart. A newer thread generation still rejects the old frame above.
    if let Some(id) = existing {
        let matches: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM episodes WHERE id = ?1 AND content = ?2 AND status = ?3)",
            params![id, content, status.as_str()],
            |row| row.get(0),
        )?;
        if !matches {
            anyhow::bail!("worker completion conflicts with durable receipt");
        }
        return Ok(id);
    }
    validate_run(tx, &identity.session_id, identity.run_id.as_deref())?;
    if status == EpisodeStatus::Ok {
        validate_required_history(tx, identity)?;
    }
    tx.execute(
        "INSERT INTO episodes (thread_name, session_id, action, content, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            identity.thread_name,
            identity.session_id,
            action,
            content,
            status.as_str(),
            now_utc()
        ],
    )?;
    let id = tx.last_insert_rowid();
    tx.execute(
        "UPDATE worker_dispatches SET status = ?2, episode_id = ?3 WHERE dispatch_id = ?1",
        params![identity.dispatch_id, status.as_str(), id],
    )?;
    tx.execute(
        "UPDATE threads SET updated_at = ?3 WHERE session_id = ?1 AND name = ?2",
        params![identity.session_id, identity.thread_name, now_utc()],
    )?;
    Ok(id)
}

coordinated_command! {
pub(crate) fn worker_dispatch_generation(path: &Path, dispatch_id: &str) -> Result<i64> {
    let conn = open_runtime_connection(path)?;
    Ok(conn.query_row(
        "SELECT generation FROM worker_dispatches WHERE dispatch_id = ?1",
        [dispatch_id],
        |row| row.get(0),
    )?)
}
command WorkerDispatchGenerationCommand {
    dispatch_id: String = dispatch_id.to_owned(),
}
call |command| (&command.dispatch_id)
correlation |_command| crate::telemetry::Correlation::default();
port internal;
}

coordinated_command! {
pub(crate) fn worker_dispatch_result(path: &Path, dispatch_id: &str) -> Result<Option<String>> {
    let conn = open_runtime_connection(path)?;
    Ok(conn.query_row("SELECT e.content FROM worker_dispatches d JOIN episodes e ON e.id = d.episode_id WHERE d.dispatch_id = ?1 AND d.status = 'ok'",
        [dispatch_id], |row| row.get(0)).optional()?)
}
command WorkerDispatchResultCommand {
    dispatch_id: String = dispatch_id.to_owned(),
}
call |command| (&command.dispatch_id)
correlation |_command| crate::telemetry::Correlation::default();
port internal;
}

coordinated_command! {
pub(crate) fn worker_dispatch_committed(path: &Path, dispatch_id: &str) -> Result<bool> {
    let conn = open_runtime_connection(path)?;
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM worker_dispatches WHERE dispatch_id = ?1 AND status = 'ok')",
        [dispatch_id],
        |row| row.get(0),
    )?)
}
command WorkerDispatchCommittedCommand {
    dispatch_id: String = dispatch_id.to_owned(),
}
call |command| (&command.dispatch_id)
correlation |_command| crate::telemetry::Correlation::default();
port internal;
}

/// Called only by session recovery under the session operation lease. Preserve
/// committed results; classify every uncommitted dispatch once before restart.
pub(super) fn recover_worker_dispatches(tx: &Transaction<'_>, session_id: &str) -> Result<()> {
    let pending = {
        let mut stmt = tx.prepare("SELECT dispatch_id, thread_name, action FROM worker_dispatches WHERE session_id = ?1 AND status = 'pending'")?;
        let rows = stmt
            .query_map([session_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    for (dispatch, thread, action) in pending {
        tx.execute("INSERT INTO episodes (thread_name, session_id, action, content, status, created_at) VALUES (?1, ?2, ?3, ?4, 'error', ?5)",
            params![thread, session_id, action, "Worker interrupted before host commit acknowledgement.", now_utc()])?;
        tx.execute(
            "UPDATE worker_dispatches SET status = 'error', episode_id = ?2 WHERE dispatch_id = ?1",
            params![dispatch, tx.last_insert_rowid()],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
