use super::*;

coordinated_command! {
/// Read the exact settled generation, independent of the latest relationship.
pub fn load_managed_orchestrator_terminal_receipt(
    path: &Path,
    orchestrator_session_id: &str,
    generation: u64,
) -> Result<Option<ManagedOrchestratorRecord>> {
    let connection = open_runtime_connection(path)?;
    let stored: Option<(String, String)> = connection.query_row(
        "SELECT receipt.run_id, receipt.record_json
         FROM managed_orchestrator_terminal_receipts AS receipt
         JOIN managed_orchestrators AS orchestrator USING (orchestrator_session_id)
         WHERE receipt.orchestrator_session_id = ?1 AND receipt.generation = ?2",
        params![orchestrator_session_id, generation],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional()?;
    let Some((run_id, json)) = stored else { return Ok(None); };
    let record: ManagedOrchestratorRecord = serde_json::from_str(&json)
        .context("invalid managed orchestrator terminal receipt")?;
    if record.orchestrator_session_id != orchestrator_session_id || record.generation != generation
        || record.run_id.as_deref() != Some(run_id.as_str()) || !record.status.is_terminal()
    {
        return Err(anyhow!("managed orchestrator terminal receipt identity is invalid"));
    }
    Ok(Some(record))
}
command LoadManagedOrchestratorTerminalReceiptCommand {
    orchestrator_session_id: String = orchestrator_session_id.to_owned(),
    generation: u64 = generation,
}
call |command| (&command.orchestrator_session_id, command.generation)
correlation |command| crate::telemetry::Correlation::session(Some(&command.orchestrator_session_id)).with_generation(command.generation);
port public;
}

pub(super) fn insert_terminal_receipt(
    connection: &Connection,
    record: &ManagedOrchestratorRecord,
) -> Result<()> {
    let run_id = record
        .run_id
        .as_deref()
        .filter(|run_id| !run_id.is_empty())
        .ok_or_else(|| anyhow!("managed orchestrator terminal receipt has no run id"))?;
    if !record.status.is_terminal() || record.generation == 0 {
        return Err(anyhow!(
            "managed orchestrator terminal receipt is not settled"
        ));
    }
    connection.execute(
        "INSERT INTO managed_orchestrator_terminal_receipts
         (orchestrator_session_id, generation, run_id, record_json)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (orchestrator_session_id, generation) DO NOTHING",
        params![
            record.orchestrator_session_id,
            record.generation,
            run_id,
            serde_json::to_string(record)?
        ],
    )?;
    let stored_run: String = connection.query_row(
        "SELECT run_id FROM managed_orchestrator_terminal_receipts
         WHERE orchestrator_session_id = ?1 AND generation = ?2",
        params![record.orchestrator_session_id, record.generation],
        |row| row.get(0),
    )?;
    if stored_run != run_id {
        return Err(anyhow!(
            "managed orchestrator terminal receipt belongs to another run"
        ));
    }
    Ok(())
}

pub(in crate::store) fn seed_terminal_receipts(connection: &Connection) -> Result<()> {
    let mut statement = connection.prepare(&format!(
        "SELECT {COLUMNS} FROM managed_orchestrators
         WHERE status IN ('completed', 'failed', 'cancelled', 'interrupted')"
    ))?;
    let records = statement.query_map([], row_to_record)?;
    for record in records {
        insert_terminal_receipt(connection, &record?)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
