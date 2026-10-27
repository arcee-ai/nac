use super::*;

/// Receipt rows retain a generation's settled response when its relationship
/// advances. Their relationship foreign key also covers parent/root deletion.
/// Only a current terminal generation can be seeded from an older store.
pub(super) fn create_and_seed(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS traditional_child_terminal_receipts (
             child_session_id TEXT NOT NULL
                 REFERENCES traditional_children(child_session_id) ON DELETE CASCADE,
             generation INTEGER NOT NULL CHECK (generation > 0),
             run_id TEXT NOT NULL CHECK (length(run_id) > 0),
             record_json TEXT NOT NULL,
             PRIMARY KEY (child_session_id, generation),
             UNIQUE (child_session_id, run_id)
         );
         CREATE TABLE IF NOT EXISTS managed_orchestrator_terminal_receipts (
             orchestrator_session_id TEXT NOT NULL
                 REFERENCES managed_orchestrators(orchestrator_session_id) ON DELETE CASCADE,
             generation INTEGER NOT NULL CHECK (generation > 0),
             run_id TEXT NOT NULL CHECK (length(run_id) > 0),
             record_json TEXT NOT NULL,
             PRIMARY KEY (orchestrator_session_id, generation),
             UNIQUE (orchestrator_session_id, run_id)
         );",
    )?;
    super::super::traditional_children::seed_terminal_receipts(connection)?;
    super::super::managed_orchestrators::seed_terminal_receipts(connection)?;
    Ok(())
}

#[cfg(test)]
mod tests;
