//! Immutable, caller-scoped admission replies. The current goal and retained
//! terminal evidence remain owned by session_goals/task_evidence.
use super::*;

pub(super) fn create_tables(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS peer_goal_starts (
            caller_session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
            request_id TEXT NOT NULL CHECK (length(request_id) BETWEEN 1 AND 160),
            target_session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
            request_json TEXT NOT NULL,
            response_json TEXT NOT NULL,
            PRIMARY KEY(caller_session_id, request_id)
        );
        CREATE INDEX IF NOT EXISTS idx_peer_goal_starts_target ON peer_goal_starts(target_session_id);",
    )?;
    Ok(())
}
