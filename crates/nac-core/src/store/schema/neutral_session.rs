//! Version 55 renames the surviving direct-session ledger without rewriting content.
use super::*;

pub(super) fn rename_storage(conn: &Connection) -> Result<()> {
    let occupied: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM thread_events WHERE thread_name = '__nac_transcript__')",
        [],
        |row| row.get(0),
    )?;
    if occupied {
        return Err(anyhow!(
            "neutral transcript target already exists in legacy storage"
        ));
    }
    conn.execute_batch(
        "ALTER TABLE thread_events RENAME TO session_events;
         ALTER TABLE session_events RENAME COLUMN thread_name TO event_target;
         ALTER TABLE orchestrator_compaction_checkpoints RENAME TO session_compaction_checkpoints;
         ALTER TABLE sessions RENAME COLUMN orchestrator_compaction_threshold TO compaction_threshold;
         DROP INDEX idx_thread_events_session_thread_id;
         DROP INDEX idx_orchestrator_compaction_checkpoints_latest;
         CREATE INDEX idx_session_events_session_target_id ON session_events(session_id, event_target, id DESC);
         CREATE INDEX idx_session_compaction_checkpoints_latest ON session_compaction_checkpoints(session_id, id DESC);
         UPDATE session_events SET event_target='__nac_transcript__' WHERE event_target='__orchestrator__';",
    )?;
    if conn
        .prepare("PRAGMA foreign_key_check")?
        .query([])?
        .next()?
        .is_some()
    {
        return Err(anyhow!(
            "foreign key check failed after session storage migration"
        ));
    }
    Ok(())
}
