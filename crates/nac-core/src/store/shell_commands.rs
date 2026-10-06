//! Exact-identity journal for human shell effects. Transactions never execute
//! processes. The operation lease and random operation id fence every write.
use super::*;
use crate::session_service::{ShellCommandSnapshot, ShellCommandState};
use crate::sessions::SessionOperationLease;
use crate::types::Message;
use std::sync::Arc;

pub(super) fn create_shell_commands_table(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS human_shell_operations (
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        request_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN ('accepted', 'started', 'finished')),
        snapshot_json TEXT NOT NULL,
        PRIMARY KEY (session_id, request_id),
        UNIQUE (session_id, operation_id)
    );",
    )?;
    Ok(())
}

coordinated_command! {
    pub(crate) fn lookup_shell_command(path: &Path, session_id: &str, request_id: &str)
        -> Result<Option<(String, ShellCommandSnapshot)>> {
        let conn = open_initialized_read_connection(path)?;
        let row: Option<(String, String)> = conn.query_row(
            "SELECT fingerprint, snapshot_json FROM human_shell_operations WHERE session_id=?1 AND request_id=?2",
            params![session_id, request_id], |r| Ok((r.get(0)?, r.get(1)?)),
        ).optional()?;
        row.map(|(fingerprint, json)| Ok((fingerprint, serde_json::from_str(&json)?))).transpose()
    }
    command LookupShellCommand { session_id: String = session_id.to_owned(), request_id: String = request_id.to_owned() }
    call |c| (&c.session_id, &c.request_id)
    correlation |c| crate::telemetry::Correlation::session(Some(&c.session_id));
    port internal;
}

coordinated_command! {
    pub(crate) fn list_shell_commands(path: &Path, session_id: &str) -> Result<Vec<ShellCommandSnapshot>> {
        let conn = open_initialized_read_connection(path)?;
        let mut statement = conn.prepare("SELECT snapshot_json FROM human_shell_operations WHERE session_id=?1 ORDER BY rowid")?;
        let rows = statement.query_map(params![session_id], |r| r.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }
    command ListShellCommands { session_id: String = session_id.to_owned() }
    call |c| (&c.session_id)
    correlation |c| crate::telemetry::Correlation::session(Some(&c.session_id));
    port internal;
}

coordinated_command! {
    pub(crate) fn accept_shell_command(path: &Path, session_id: &str, fingerprint: &str,
        snapshot: &ShellCommandSnapshot, lease: &Arc<SessionOperationLease>) -> Result<()> {
        lease.validate(path, session_id)?;
        let conn = open_runtime_connection(path)?;
        // Exact request identity is immutable. A lost acknowledgement is read
        // back by the caller; it never causes another effect to be launched.
        let changed = conn.execute("INSERT INTO human_shell_operations (session_id, request_id, fingerprint, operation_id, phase, snapshot_json)
            SELECT ?1,?2,?3,?4,'accepted',?5 FROM sessions WHERE session_id=?1 AND behavior IN ('direct','direct-with-orchestrator')
            AND NOT EXISTS (SELECT 1 FROM traditional_children WHERE child_session_id=?1)
            AND NOT EXISTS (SELECT 1 FROM managed_orchestrators WHERE orchestrator_session_id=?1)",
            params![session_id, snapshot.request_id, fingerprint, snapshot.operation_id, serde_json::to_string(snapshot)?])?;
        anyhow::ensure!(changed == 1, "human shell intent requires an existing direct primary");
        Ok(())
    }
    command AcceptShellCommand {
        session_id: String = session_id.to_owned(), fingerprint: String = fingerprint.to_owned(),
        snapshot: ShellCommandSnapshot = snapshot.clone(), lease: Arc<SessionOperationLease> = Arc::clone(lease)
    }
    call |c| (&c.session_id, &c.fingerprint, &c.snapshot, &c.lease)
    correlation |c| crate::telemetry::Correlation::session(Some(&c.session_id));
    port internal;
}

coordinated_command! {
    pub(crate) fn start_shell_command(path: &Path, session_id: &str,
        snapshot: &ShellCommandSnapshot, lease: &Arc<SessionOperationLease>) -> Result<()> {
        lease.validate(path, session_id)?;
        anyhow::ensure!(snapshot.state == ShellCommandState::Started, "invalid shell start state");
        let conn = open_runtime_connection(path)?;
        let changed = conn.execute("UPDATE human_shell_operations SET phase='started', snapshot_json=?4 WHERE session_id=?1 AND request_id=?2 AND operation_id=?3 AND phase='accepted'
            AND NOT EXISTS (SELECT 1 FROM traditional_children WHERE child_session_id=?1)
            AND NOT EXISTS (SELECT 1 FROM managed_orchestrators WHERE orchestrator_session_id=?1)",
            params![session_id, snapshot.request_id, snapshot.operation_id, serde_json::to_string(snapshot)?])?;
        anyhow::ensure!(changed == 1, "shell operation no longer owns accepted intent");
        Ok(())
    }
    command StartShellCommand {
        session_id: String = session_id.to_owned(), snapshot: ShellCommandSnapshot = snapshot.clone(),
        lease: Arc<SessionOperationLease> = Arc::clone(lease)
    }
    call |c| (&c.session_id, &c.snapshot, &c.lease)
    correlation |c| crate::telemetry::Correlation::session(Some(&c.session_id));
    port internal;
}

impl TranscriptLogWriter {
    pub(crate) fn finish_shell_command(
        &self,
        session_id: &str,
        snapshot: &ShellCommandSnapshot,
    ) -> Result<ShellCommandSnapshot> {
        coordinate_writer!(self, Result<ShellCommandSnapshot>, {
            session_id: String = session_id.to_owned(), snapshot: ShellCommandSnapshot = snapshot.clone(),
        }, call |c| c.writer.finish_shell_command(&c.session_id, &c.snapshot),
        correlation |c| crate::telemetry::Correlation::session(Some(&c.session_id)));
        #[cfg(test)]
        if std::env::var("NAC_HUMAN_CRASH_STAGE").as_deref() == Ok("committed") {
            *self.append_barrier.lock().unwrap() = Some(super::transcript_append::AppendBarrier {
                phase: super::transcript_append::AppendFault::AfterCommitBeforeAck,
                reached: std::env::var_os("NAC_HUMAN_CRASH_REACHED").unwrap().into(),
            });
        }
        anyhow::ensure!(
            snapshot.state.is_terminal(),
            "shell result must be terminal"
        );
        anyhow::ensure!(
            self.append_scope == snapshot.operation_id,
            "shell writer belongs to a different operation"
        );
        let message = Message::User {
            content: format!(
                "<human_shell_result>\n{}\n</human_shell_result>",
                serde_json::to_string(snapshot)?
            ),
        };
        let receipt = self.commit_append(session_id, &format!("human-shell:{}", snapshot.operation_id),
            None, &[message], AppendPurpose::HumanShell, |tx| {
                let mut result = snapshot.clone();
                result.transcript_index = Some(super::transcript::next_append_idx(tx, session_id)?.saturating_sub(1));
                let changed = tx.execute("UPDATE human_shell_operations SET phase='finished', snapshot_json=?4 WHERE session_id=?1 AND request_id=?2 AND operation_id=?3 AND phase IN ('accepted','started')",
                    params![session_id, result.request_id, result.operation_id, serde_json::to_string(&result)?])?;
                anyhow::ensure!(changed == 1, "shell result lost its operation fence");
                Ok(())
            })?;
        let mut result = snapshot.clone();
        result.transcript_index = Some(receipt.start_idx);
        Ok(result)
    }
}

#[cfg(test)]
#[path = "shell_command_store_tests.rs"]
mod tests;
