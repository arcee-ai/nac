//! Schema for transcript replay receipts and prompt recovery obligations.
//! Their foreign keys bind replay and recovery to canonical transcript rows;
//! the ordered migration and version transition remain in schema.rs.
use super::*;

pub(super) fn create_session_run_recovery_table(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_run_recovery (
             session_id TEXT PRIMARY KEY
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             run_id TEXT NOT NULL CHECK (length(trim(run_id)) > 0),
             submitted_message_id INTEGER NOT NULL
                 REFERENCES thread_events(id) ON DELETE CASCADE,
             status TEXT NOT NULL CHECK (status IN ('active', 'interrupted', 'failed')),
             terminal_disposition TEXT
                 CHECK (terminal_disposition IN ('completed', 'cancelled')),
             failure_json TEXT
         );",
    )?;
    Ok(())
}

pub(super) fn create_transcript_append_receipts_table(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS transcript_append_receipts (
             session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
             operation_id TEXT NOT NULL,
             digest TEXT NOT NULL,
             run_id TEXT,
             generation INTEGER,
             start_idx INTEGER NOT NULL CHECK (start_idx >= 0),
             end_idx INTEGER NOT NULL CHECK (end_idx > start_idx),
             last_message_id INTEGER NOT NULL REFERENCES thread_events(id) ON DELETE CASCADE,
             result_json TEXT,
             PRIMARY KEY (session_id, operation_id)
         );",
    )?;
    Ok(())
}

/// Seeds the run counter for sessions that predate it. One run submits exactly
/// one user message, so the stored history is the best available estimate.
/// Rows that already counted a run keep their value, and unparseable history
/// stays at zero rather than failing the migration.
pub(super) fn backfill_run_counts(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE sessions
         SET run_count = (
             SELECT COUNT(*)
             FROM json_each(sessions.messages_json)
             WHERE json_extract(value, '$.role') = 'user'
         )
         WHERE run_count = 0 AND json_valid(messages_json)",
        [],
    )?;
    Ok(())
}
