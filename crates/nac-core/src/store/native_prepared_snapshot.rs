//! Append-only actual snapshot seal, retaining the original source reservation.
//! An SQL digest or readback can never reconstruct the original in-memory owner.
use super::*;

pub(crate) fn create_table(c: &Connection) -> Result<()> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS native_source_prepared_snapshots (
        operation_id TEXT PRIMARY KEY REFERENCES native_source_reservations(operation_id),
        digest BLOB NOT NULL CHECK(typeof(digest)='blob' AND length(digest)=32));
      CREATE TRIGGER IF NOT EXISTS native_source_snapshot_no_update BEFORE UPDATE ON native_source_prepared_snapshots
      BEGIN SELECT RAISE(ABORT,'prepared snapshot immutable'); END;
      CREATE TRIGGER IF NOT EXISTS native_source_snapshot_no_delete BEFORE DELETE ON native_source_prepared_snapshots
      BEGIN SELECT RAISE(ABORT,'prepared snapshot history retained'); END;")?;
    Ok(())
}

pub(super) fn check_persisted(state: &SourceState, c: &Connection) -> Result<()> {
    let stored: Option<Vec<u8>> = c
        .query_row(
            "SELECT digest FROM native_source_prepared_snapshots WHERE operation_id=?1",
            [state.binding.operation_id.to_string()],
            |r| r.get(0),
        )
        .optional()?;
    match (
        state.binding.creation_snapshot_sha256,
        state.prepared_snapshot.get(),
        stored,
    ) {
        (Some(_), None, None) | (None, None, None) => Ok(()),
        (None, Some(original), Some(stored)) if stored.as_slice() == original => Ok(()),
        _ => anyhow::bail!("original prepared snapshot binding changed"),
    }
}

pub(super) fn bind(
    state: &SourceState,
    session_id: &str,
    project_id: Option<&str>,
    digest: [u8; 32],
) -> Result<()> {
    state.check_denial()?;
    anyhow::ensure!(
        state.binding.creation_snapshot_sha256.is_none()
            && state.prepared_snapshot.get().is_none()
            && session_id == state.binding.session_id
            && project_id == state.binding.project_id.as_deref()
            && digest != [0; 32],
        "prepared snapshot original owner mismatch or already bound"
    );
    let mut c = open_runtime_connection(&state.path)?;
    let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    state.check(&tx, "preparing")?;
    state.check_denial()?;
    tx.execute(
        "INSERT INTO native_source_prepared_snapshots(operation_id,digest) VALUES(?1,?2)",
        params![state.binding.operation_id.to_string(), digest.as_slice()],
    )?;
    state.check_denial()?;
    tx.commit()?;
    // Only a known commit on THIS original object fills memory. SQL observation
    // after unknown commit/restart cannot mint this one-use prepared binding.
    state
        .prepared_snapshot
        .set(digest)
        .map_err(|_| anyhow!("prepared snapshot already bound"))?;
    state.check_denial()
}
