//! Durable no-replay boundary for one exact managed runtime operation.
//!
//! This journal authenticates nobody and supplies no lease or dispatch authority.
//! The receiver checks current authority before recording, commits uncertainty
//! before any native effect. `NewlyRecorded` reports a committed barrier, not an
//! execution capability. Every retry, including after a lost response or restart,
//! is observational; managed lease transitions are owned by the sibling journal.

use super::*;
use rusqlite::TransactionBehavior;
use uuid::Uuid;

/// The already-qualified canonical operation identity, not a transport envelope.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManagedRuntimeOperationIdentity {
    pub operation_id: Uuid,
    pub full_input_sha256: [u8; 32],
}

/// Only native session/run identifiers are retained; never prompts, HTTP bodies,
/// bearer credentials or model output. A dispatch acknowledgment is not run completion.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ManagedRuntimeObservation {
    NotAdmitted,
    Session { session_id: Uuid },
    Run { session_id: Uuid, run_id: Uuid },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManagedRuntimeOperationSnapshot {
    pub identity: ManagedRuntimeOperationIdentity,
    pub observation: Option<ManagedRuntimeObservation>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ManagedRuntimeRecordOutcome {
    NewlyRecorded,
    AlreadyRecorded(ManagedRuntimeOperationSnapshot),
}

#[derive(Debug)]
pub enum ManagedRuntimeJournalError {
    BindingConflict,
    ObservationConflict,
    MissingOperation,
    LeaseDenied,
    Store(anyhow::Error),
}

impl std::fmt::Display for ManagedRuntimeJournalError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::BindingConflict => "runtime operation canonical input conflicts",
            Self::ObservationConflict => "runtime operation acknowledgment conflicts",
            Self::MissingOperation => "runtime operation has no retained admission",
            Self::LeaseDenied => "runtime operation lease is unavailable",
            Self::Store(_) => "runtime operation persistence failed",
        })
    }
}

impl std::error::Error for ManagedRuntimeJournalError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Store(error) => Some(error.as_ref()),
            _ => None,
        }
    }
}

impl From<anyhow::Error> for ManagedRuntimeJournalError {
    fn from(error: anyhow::Error) -> Self {
        Self::Store(error)
    }
}

impl From<rusqlite::Error> for ManagedRuntimeJournalError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(error.into())
    }
}

impl From<uuid::Error> for ManagedRuntimeJournalError {
    fn from(error: uuid::Error) -> Self {
        Self::Store(error.into())
    }
}

pub(super) fn create_managed_runtime_operations_table(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS managed_runtime_operations (
             operation_id TEXT PRIMARY KEY NOT NULL,
             full_input_sha256 TEXT NOT NULL CHECK (
                 length(full_input_sha256) = 64 AND
                 full_input_sha256 NOT GLOB '*[^0-9a-f]*'
             ),
             recorded_at TEXT NOT NULL,
             observation_kind TEXT CHECK (observation_kind IN ('not_admitted', 'session', 'run')),
             session_id TEXT,
             run_id TEXT,
             CHECK (CASE WHEN observation_kind IS NULL
                 THEN session_id IS NULL AND run_id IS NULL
                 ELSE
                     (observation_kind = 'not_admitted' AND session_id IS NULL AND run_id IS NULL) OR
                     (observation_kind = 'session' AND session_id IS NOT NULL AND run_id IS NULL) OR
                     (observation_kind = 'run' AND session_id IS NOT NULL AND run_id IS NOT NULL)
                 END)
         );
         CREATE TRIGGER IF NOT EXISTS managed_runtime_operations_no_delete
         BEFORE DELETE ON managed_runtime_operations
         BEGIN SELECT RAISE(ABORT, 'runtime operation history is retained'); END;
         CREATE TRIGGER IF NOT EXISTS managed_runtime_operations_immutable
         BEFORE UPDATE ON managed_runtime_operations
         WHEN NEW.operation_id IS NOT OLD.operation_id OR
              NEW.full_input_sha256 IS NOT OLD.full_input_sha256 OR
              NEW.recorded_at IS NOT OLD.recorded_at OR OLD.observation_kind IS NOT NULL
         BEGIN SELECT RAISE(ABORT, 'runtime operation identity/result is immutable'); END;",
    )?;
    Ok(())
}

coordinated_command! {
/// Persist the pre-effect uncertainty barrier. Only the first committed insert
/// is new; exact duplicates never reopen dispatch and changed inputs conflict.
pub fn record_managed_runtime_operation(
    path: &Path,
    identity: &ManagedRuntimeOperationIdentity,
) -> std::result::Result<ManagedRuntimeRecordOutcome, ManagedRuntimeJournalError> {
    let mut connection = open_runtime_connection(path)?;
    record_with_connection(&mut connection, identity, || Ok(()))
}
command RecordManagedRuntimeOperationCommand {
    identity: ManagedRuntimeOperationIdentity = identity.clone(),
}
call |command| (&command.identity)
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

fn record_with_connection(
    connection: &mut Connection,
    identity: &ManagedRuntimeOperationIdentity,
    after_commit: impl FnOnce() -> Result<()>,
) -> std::result::Result<ManagedRuntimeRecordOutcome, ManagedRuntimeJournalError> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let outcome = if let Some(snapshot) = read_with_connection(&transaction, identity)? {
        ManagedRuntimeRecordOutcome::AlreadyRecorded(snapshot)
    } else {
        transaction.execute(
            "INSERT INTO managed_runtime_operations
             (operation_id, full_input_sha256, recorded_at) VALUES (?1, ?2, ?3)",
            params![
                identity.operation_id.to_string(),
                digest_hex(&identity.full_input_sha256),
                now_utc()
            ],
        )?;
        ManagedRuntimeRecordOutcome::NewlyRecorded
    };
    transaction.commit()?;
    after_commit()?;
    Ok(outcome)
}

coordinated_command! {
/// Read only the exact retained identity. Missing work is unknown, not permission
/// to dispatch; a changed digest is a conflict even when the old result is known.
pub fn read_managed_runtime_operation(
    path: &Path,
    identity: &ManagedRuntimeOperationIdentity,
) -> std::result::Result<Option<ManagedRuntimeOperationSnapshot>, ManagedRuntimeJournalError> {
    let connection = open_initialized_read_connection(path)?;
    read_with_connection(&connection, identity)
}
command ReadManagedRuntimeOperationCommand {
    identity: ManagedRuntimeOperationIdentity = identity.clone(),
}
call |command| (&command.identity)
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
/// Record a proven native acknowledgment without executing another operation.
/// Caller must use actual native admission/readback evidence. A lost or ambiguous
/// response stays uncertain; it must never be relabeled `NotAdmitted` by guess.
pub fn acknowledge_managed_runtime_operation(
    path: &Path,
    identity: &ManagedRuntimeOperationIdentity,
    observation: &ManagedRuntimeObservation,
) -> std::result::Result<ManagedRuntimeOperationSnapshot, ManagedRuntimeJournalError> {
    let mut connection = open_runtime_connection(path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut snapshot = read_with_connection(&transaction, identity)?
        .ok_or(ManagedRuntimeJournalError::MissingOperation)?;
    if let Some(existing) = &snapshot.observation {
        if existing != observation {
            return Err(ManagedRuntimeJournalError::ObservationConflict);
        }
    } else {
        let (kind, session, run) = match observation {
            ManagedRuntimeObservation::NotAdmitted => ("not_admitted", None, None),
            ManagedRuntimeObservation::Session { session_id } => ("session", Some(session_id.to_string()), None),
            ManagedRuntimeObservation::Run { session_id, run_id } => ("run", Some(session_id.to_string()), Some(run_id.to_string())),
        };
        let updated = transaction.execute(
            "UPDATE managed_runtime_operations SET observation_kind = ?2, session_id = ?3, run_id = ?4
             WHERE operation_id = ?1 AND observation_kind IS NULL",
            params![identity.operation_id.to_string(), kind, session, run],
        )?;
        if updated != 1 { return Err(ManagedRuntimeJournalError::Store(anyhow!("runtime acknowledgment mutation was not singular"))); }
        snapshot.observation = Some(observation.clone());
    }
    transaction.commit()?;
    Ok(snapshot)
}
command AcknowledgeManagedRuntimeOperationCommand {
    identity: ManagedRuntimeOperationIdentity = identity.clone(),
    observation: ManagedRuntimeObservation = observation.clone(),
}
call |command| (&command.identity, &command.observation)
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

pub(super) fn read_with_connection(
    connection: &Connection,
    identity: &ManagedRuntimeOperationIdentity,
) -> std::result::Result<Option<ManagedRuntimeOperationSnapshot>, ManagedRuntimeJournalError> {
    let row = connection
        .query_row(
            "SELECT full_input_sha256, observation_kind, session_id, run_id
         FROM managed_runtime_operations WHERE operation_id = ?1",
            [identity.operation_id.to_string()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()?;
    let Some((digest, kind, session, run)) = row else {
        return Ok(None);
    };
    if digest != digest_hex(&identity.full_input_sha256) {
        return Err(ManagedRuntimeJournalError::BindingConflict);
    }
    let observation = match (kind.as_deref(), session, run) {
        (None, None, None) => None,
        (Some("not_admitted"), None, None) => Some(ManagedRuntimeObservation::NotAdmitted),
        (Some("session"), Some(session), None) => Some(ManagedRuntimeObservation::Session {
            session_id: Uuid::parse_str(&session)?,
        }),
        (Some("run"), Some(session), Some(run)) => Some(ManagedRuntimeObservation::Run {
            session_id: Uuid::parse_str(&session)?,
            run_id: Uuid::parse_str(&run)?,
        }),
        _ => {
            return Err(ManagedRuntimeJournalError::Store(anyhow!(
                "runtime operation acknowledgment is invalid"
            )))
        }
    };
    Ok(Some(ManagedRuntimeOperationSnapshot {
        identity: identity.clone(),
        observation,
    }))
}

pub(super) fn digest_hex(digest: &[u8; 32]) -> String {
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
#[path = "managed_runtime_admission_tests.rs"]
mod tests;
