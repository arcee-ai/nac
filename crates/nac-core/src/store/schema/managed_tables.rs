use super::*;

pub(super) fn create_terminal_remote_cleanups_table(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS terminal_remote_cleanups (
             session_id TEXT NOT NULL,
             pidfile TEXT NOT NULL,
             created_at TEXT NOT NULL,
             PRIMARY KEY (session_id, pidfile),
             FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE RESTRICT
         );",
    )?;
    Ok(())
}

pub(in crate::store) fn create_managed_maintenance_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS managed_host_maintenance (
             singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
             state TEXT NOT NULL CHECK (state IN ('serving', 'maintenance')),
             operation_id TEXT,
             target_json TEXT,
             accepted_identity_json TEXT,
             prepared_at TEXT,
             version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
             CHECK (
                 (state = 'serving' AND operation_id IS NULL AND target_json IS NULL AND prepared_at IS NULL)
                 OR
                 (state = 'maintenance' AND operation_id IS NOT NULL AND target_json IS NOT NULL AND prepared_at IS NOT NULL)
             )
         );
         INSERT OR IGNORE INTO managed_host_maintenance
             (singleton, state, operation_id, target_json, accepted_identity_json, prepared_at, version)
         VALUES (1, 'serving', NULL, NULL, NULL, NULL, 0);

         CREATE TABLE IF NOT EXISTS managed_control_operations (
             operation_id TEXT PRIMARY KEY,
             binding_json TEXT NOT NULL,
             latest_outcome_json TEXT NOT NULL,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
         );

         CREATE TABLE IF NOT EXISTS managed_control_attempts (
             jti TEXT PRIMARY KEY,
             operation_id TEXT NOT NULL,
             binding_json TEXT NOT NULL,
             outcome_json TEXT,
             expires_at INTEGER NOT NULL,
             created_at TEXT NOT NULL,
             FOREIGN KEY (operation_id) REFERENCES managed_control_operations(operation_id)
                 ON DELETE RESTRICT
         );
         CREATE INDEX IF NOT EXISTS idx_managed_control_attempts_operation
             ON managed_control_attempts(operation_id);",
    )?;
    Ok(())
}
