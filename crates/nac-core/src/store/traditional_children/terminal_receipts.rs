use super::*;

coordinated_command! {
/// Read the exact settled generation, even after a successor has started.
/// Receipt lifetime follows the relationship; deletion never resurrects it.
pub fn load_traditional_child_terminal_receipt(
    path: &Path,
    child_session_id: &str,
    generation: u64,
) -> Result<Option<TraditionalChildRecord>> {
    let connection = open_runtime_connection(path)?;
    let stored: Option<(String, String)> = connection.query_row(
        "SELECT receipt.run_id, receipt.record_json
         FROM traditional_child_terminal_receipts AS receipt
         JOIN traditional_children AS child USING (child_session_id)
         WHERE receipt.child_session_id = ?1 AND receipt.generation = ?2",
        params![child_session_id, generation],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional()?;
    stored.map(|(run_id, json)| decode_terminal_receipt(child_session_id, generation, &run_id, &json))
        .transpose()
}
command LoadTraditionalChildTerminalReceiptCommand {
    child_session_id: String = child_session_id.to_owned(),
    generation: u64 = generation,
}
call |command| (&command.child_session_id, command.generation)
correlation |command| crate::telemetry::Correlation::session(Some(&command.child_session_id)).with_generation(command.generation);
port public;
}

coordinated_command! {
/// Resolve an inbox item's delivered run after the mutable relationship advances.
pub fn load_traditional_child_terminal_receipt_for_run(
    path: &Path,
    child_session_id: &str,
    run_id: &str,
) -> Result<Option<TraditionalChildRecord>> {
    let connection = open_runtime_connection(path)?;
    let stored: Option<(u64, String)> = connection.query_row(
        "SELECT receipt.generation, receipt.record_json
         FROM traditional_child_terminal_receipts AS receipt
         JOIN traditional_children AS child USING (child_session_id)
         WHERE receipt.child_session_id = ?1 AND receipt.run_id = ?2",
        params![child_session_id, run_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional()?;
    stored.map(|(generation, json)| decode_terminal_receipt(child_session_id, generation, run_id, &json))
        .transpose()
}
command LoadTraditionalChildTerminalReceiptForRunCommand {
    child_session_id: String = child_session_id.to_owned(),
    run_id: String = run_id.to_owned(),
}
call |command| (&command.child_session_id, &command.run_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.child_session_id)).with_run(Some(&command.run_id));
port public;
}

fn decode_terminal_receipt(
    child_session_id: &str,
    generation: u64,
    run_id: &str,
    json: &str,
) -> Result<TraditionalChildRecord> {
    let record: TraditionalChildRecord =
        serde_json::from_str(json).context("invalid traditional child terminal receipt")?;
    if record.child_session_id != child_session_id
        || record.generation != generation
        || record.run_id.as_deref() != Some(run_id)
        || !record.status.is_terminal()
    {
        return Err(anyhow!(
            "traditional child terminal receipt identity is invalid"
        ));
    }
    Ok(record)
}

pub(super) fn insert_terminal_receipt(
    connection: &Connection,
    record: &TraditionalChildRecord,
) -> Result<()> {
    let run_id = record
        .run_id
        .as_deref()
        .filter(|run_id| !run_id.is_empty())
        .ok_or_else(|| anyhow!("traditional child terminal receipt has no run id"))?;
    if !record.status.is_terminal() || record.generation == 0 {
        return Err(anyhow!("traditional child terminal receipt is not settled"));
    }
    connection.execute(
        "INSERT INTO traditional_child_terminal_receipts
         (child_session_id, generation, run_id, record_json)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (child_session_id, generation) DO NOTHING",
        params![
            record.child_session_id,
            record.generation,
            run_id,
            serde_json::to_string(record)?
        ],
    )?;
    let stored_run: String = connection.query_row(
        "SELECT run_id FROM traditional_child_terminal_receipts
         WHERE child_session_id = ?1 AND generation = ?2",
        params![record.child_session_id, record.generation],
        |row| row.get(0),
    )?;
    if stored_run != run_id {
        return Err(anyhow!(
            "traditional child terminal receipt belongs to another run"
        ));
    }
    Ok(())
}

pub(in crate::store) fn seed_terminal_receipts(connection: &Connection) -> Result<()> {
    let mut statement = connection.prepare(&format!(
        "SELECT {CHILD_COLUMNS} FROM traditional_children
         WHERE status IN ('completed', 'failed', 'cancelled', 'interrupted')"
    ))?;
    let records = statement.query_map([], row_to_child)?;
    for record in records {
        insert_terminal_receipt(connection, &record?)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
