//! Original retained CREATE publication cleanup, after Native's authenticated ACK.
//! Ledger rows are history; only the same in-process reservation may release slots.
use super::{native_source_reservation::NativeSourceReservation, *};
use crate::store::coordinator::PersistenceCommand;
use std::sync::Arc;

pub(super) fn create_table(c: &Connection) -> Result<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS native_create_acknowledgements (
            operation_id TEXT PRIMARY KEY REFERENCES native_source_reservations(operation_id),
            binding_json TEXT NOT NULL,
            terminal_body_sha256 BLOB NOT NULL CHECK(typeof(terminal_body_sha256)='blob' AND length(terminal_body_sha256)=32),
            configuration_version INTEGER NOT NULL CHECK(typeof(configuration_version)='integer' AND configuration_version>=0));
         CREATE TRIGGER IF NOT EXISTS native_create_ack_no_update
         BEFORE UPDATE ON native_create_acknowledgements
         BEGIN SELECT RAISE(ABORT,'CREATE acknowledgement history retained'); END;
         CREATE TRIGGER IF NOT EXISTS native_create_ack_no_delete
         BEFORE DELETE ON native_create_acknowledgements
         BEGIN SELECT RAISE(ABORT,'CREATE acknowledgement history retained'); END;",
    )?;
    Ok(())
}

struct Complete {
    source: Arc<NativeSourceReservation>,
    terminal: [u8; 32],
    configuration_version: i64,
}
impl PersistenceCommand for Complete {
    type Output = ();
    fn correlation(&self) -> crate::telemetry::Correlation {
        crate::telemetry::Correlation::session(Some(&self.source.binding().session_id))
    }
    fn execute(self, path: &Path) -> Result<()> {
        let source = &self.source;
        anyhow::ensure!(
            source.original_process_is_current()
                && std::fs::canonicalize(path)? == source.bound_store_path()
                && self.terminal != [0; 32]
                && self.configuration_version >= 0,
            "CREATE cleanup original owner unavailable"
        );
        let mut connection = open_runtime_connection(path)?;
        let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let binding = serde_json::to_string(source.binding())?;
        let operation = source.binding().operation_id.to_string();
        let prior: Option<(String, Vec<u8>, i64)> = tx.query_row(
            "SELECT binding_json,terminal_body_sha256,configuration_version FROM native_create_acknowledgements WHERE operation_id=?1",
            [&operation], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
        ).optional()?;
        if let Some((original, digest, version)) = prior {
            anyhow::ensure!(
                original == binding
                    && digest == self.terminal
                    && version == self.configuration_version,
                "CREATE cleanup acknowledgement differs"
            );
            let retained: i64 = tx.query_row(
                "SELECT COUNT(*) FROM native_source_slots WHERE operation_id=?1",
                [&operation],
                |row| row.get(0),
            )?;
            anyhow::ensure!(retained == 0, "CREATE acknowledged slots reappeared");
            return Ok(());
        }
        // Publication retirement/expiry denies new work, not cleanup. This
        // checks the original immutable reservation and actual durable sources
        // without reviving its admission or reconstructing an owner from rows.
        source.check_recorded_prepared(&tx)?;
        let version: i64 = tx.query_row(
            "SELECT config_version FROM sessions WHERE session_id=?1",
            [&source.binding().session_id],
            |row| row.get(0),
        )?;
        anyhow::ensure!(
            version == self.configuration_version,
            "CREATE cleanup configuration changed"
        );
        tx.execute(
            "INSERT INTO native_create_acknowledgements VALUES(?1,?2,?3,?4)",
            params![operation, binding, self.terminal.as_slice(), version],
        )?;
        let deleted = tx.execute(
            "DELETE FROM native_source_slots WHERE operation_id=?1",
            [&operation],
        )?;
        anyhow::ensure!(
            deleted == source.binding().sources.len(),
            "CREATE cleanup source slots changed"
        );
        // The original reservation, prepared snapshot and immutable ACK remain.
        // No runtime resource, capacity hold or active service is released here.
        tx.commit()?;
        Ok(())
    }
}

pub(crate) fn complete(
    source: Arc<NativeSourceReservation>,
    terminal: [u8; 32],
    configuration_version: i64,
) -> Result<()> {
    let path = source.bound_store_path().to_owned();
    let command = Complete {
        source,
        terminal,
        configuration_version,
    };
    if let Some(owner) = super::coordinator::owner_for(&path)? {
        owner.check_blocking_context()?;
        owner.submit(command)?.acknowledge_blocking()
    } else {
        command.execute(&path)
    }
}
