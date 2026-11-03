//! Schema owned by independent native task launch admission.
use super::*;

pub(super) fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS native_task_launches (
        request_id TEXT PRIMARY KEY, caller_session_id TEXT NOT NULL,
        project_id TEXT NOT NULL, request_json TEXT NOT NULL,
        source_cwd TEXT NOT NULL, session_id TEXT NOT NULL UNIQUE,
        retained INTEGER NOT NULL CHECK(retained IN (0,1)),
        phase TEXT NOT NULL CHECK(phase IN ('reserved','preparing_runtime','ready','failed','cancelled')),
        error TEXT, first_input_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );")?;
    Ok(())
}
