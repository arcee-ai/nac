//! Schema owner for agent follow-up receipts; no human-intent metadata.
use super::*;

pub(super) fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS task_followups (
            caller_session_id TEXT NOT NULL,
            request_id TEXT NOT NULL,
            target_session_id TEXT NOT NULL,
            request_json TEXT NOT NULL,
            resolved_delivery TEXT NOT NULL CHECK (resolved_delivery IN ('queue','steer')),
            admitted_run_id TEXT,
            inbox_item_id INTEGER NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            PRIMARY KEY (caller_session_id, request_id)
        );",
    )?;
    // Receipts intentionally survive deletion of their target/inbox item. A
    // missing item is unknown, and replay must never recreate accepted input.
    Ok(())
}
