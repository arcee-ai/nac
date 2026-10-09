//! Durable user commands; a partial unique index admits one non-terminal command per session.
use super::*;

pub(super) fn create_session_user_commands_table(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_user_commands (
             session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
             request_id TEXT NOT NULL CHECK (length(trim(request_id)) > 0),
             payload_digest TEXT NOT NULL,
             command TEXT NOT NULL,
             timeout_ms INTEGER NOT NULL CHECK (timeout_ms > 0),
             state TEXT NOT NULL CHECK (state IN (
                 'admitted', 'executing', 'completed', 'timed_out', 'cancelled',
                 'spawn_failed', 'rejected', 'interrupted', 'outcome_unknown'
             )),
             result_json TEXT,
             reason TEXT,
             cwd TEXT,
             process_started INTEGER NOT NULL DEFAULT 0 CHECK (process_started IN (0, 1)),
             created_at_epoch_ms INTEGER NOT NULL,
             finished_at_epoch_ms INTEGER,
             transcript_message_id INTEGER REFERENCES thread_events(id) ON DELETE SET NULL,
             PRIMARY KEY (session_id, request_id)
         );
         CREATE UNIQUE INDEX IF NOT EXISTS session_user_commands_one_active
             ON session_user_commands(session_id)
             WHERE state IN ('admitted', 'executing');
         CREATE INDEX IF NOT EXISTS session_user_commands_transcript_message
             ON session_user_commands(transcript_message_id);",
    )?;
    Ok(())
}
