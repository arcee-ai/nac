//! Retained human delegation is distinct from agent permission grants.
use super::*;

pub(super) fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS task_followup_delegations (
            id TEXT PRIMARY KEY,
            caller_session_id TEXT NOT NULL,
            human_request_id TEXT NOT NULL,
            target_session_id TEXT NOT NULL,
            action TEXT NOT NULL CHECK (action IN ('queue','steer','auto')),
            request_json TEXT NOT NULL,
            scope_json TEXT NOT NULL,
            issued_config_version INTEGER NOT NULL,
            origin TEXT NOT NULL CHECK (origin='human_product_request'),
            created_at TEXT NOT NULL,
            revoked_at TEXT,
            UNIQUE(caller_session_id,human_request_id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS task_followup_delegations_active
        ON task_followup_delegations(caller_session_id,target_session_id,action)
        WHERE revoked_at IS NULL;",
    )?;
    ensure_column(
        conn,
        "task_followups",
        "delegation_id",
        "TEXT REFERENCES task_followup_delegations(id)",
    )?;
    // Both records retain audit evidence after session/inbox deletion. Historical
    // receipts keep NULL: migration never manufactures human provenance.
    Ok(())
}
