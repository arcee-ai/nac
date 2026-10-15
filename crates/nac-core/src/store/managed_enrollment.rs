//! Enrollment uncertainty and audit journal. Rows are observations, never grants.
//! No credential, provider request, filesystem effect or live capability belongs here.
use super::*;
use crate::model::ManagedHostKeyBinding;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EnrollmentAttempt {
    pub attempt_id: Uuid,
    pub binding: ManagedHostKeyBinding,
    pub original_check_sha256: [u8; 32],
    pub serving_lifetime_id: Uuid,
    pub eligible_subject: String,
    pub primary_revision: String,
    pub eligibility_audit_id: String,
}

impl EnrollmentAttempt {
    fn validate(&self) -> Result<()> {
        self.binding.validate()?;
        anyhow::ensure!(
            !self.attempt_id.is_nil()
                && !self.serving_lifetime_id.is_nil()
                && self.original_check_sha256 != [0; 32],
            "enrollment identity unavailable"
        );
        for value in [
            &self.eligible_subject,
            &self.primary_revision,
            &self.eligibility_audit_id,
        ] {
            anyhow::ensure!(
                !value.trim().is_empty()
                    && value.len() <= 256
                    && !value.chars().any(char::is_control),
                "enrollment lineage unavailable"
            );
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnrollmentPhase {
    Pending,
    Imported,
    Terminal,
}

/// Nonsecret durable history. Reading or deserializing it cannot resume import.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EnrollmentSnapshot {
    pub attempt: EnrollmentAttempt,
    pub phase: EnrollmentPhase,
    pub import_audit_id: Option<String>,
}

pub(super) fn create_tables(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS managed_enrollment_attempts (
            attempt_id TEXT PRIMARY KEY NOT NULL,
            bootstrap_id TEXT NOT NULL UNIQUE,
            attempt_json TEXT NOT NULL,
            phase TEXT NOT NULL CHECK(phase IN ('pending','imported','terminal')),
            import_audit_id TEXT UNIQUE,
            CHECK((phase = 'pending' AND import_audit_id IS NULL) OR (phase = 'imported' AND import_audit_id IS NOT NULL) OR phase = 'terminal')
        );
        CREATE TABLE IF NOT EXISTS managed_enrollment_events (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            attempt_id TEXT NOT NULL REFERENCES managed_enrollment_attempts(attempt_id),
            event TEXT NOT NULL CHECK(event IN ('pending','imported','terminal')),
            recorded_at TEXT NOT NULL,
            UNIQUE(attempt_id,event)
        );
        CREATE TRIGGER IF NOT EXISTS managed_enrollment_attempts_no_delete BEFORE DELETE ON managed_enrollment_attempts
        BEGIN SELECT RAISE(ABORT, 'enrollment history is retained'); END;
        CREATE TRIGGER IF NOT EXISTS managed_enrollment_attempts_fenced BEFORE UPDATE ON managed_enrollment_attempts
        WHEN NEW.attempt_id IS NOT OLD.attempt_id OR NEW.bootstrap_id IS NOT OLD.bootstrap_id
            OR NEW.attempt_json IS NOT OLD.attempt_json OR OLD.phase = 'terminal'
            OR NEW.phase NOT IN ('imported','terminal')
            OR (OLD.phase = 'imported' AND NEW.phase != 'terminal')
            OR (OLD.import_audit_id IS NOT NULL AND NEW.import_audit_id IS NOT OLD.import_audit_id)
        BEGIN SELECT RAISE(ABORT, 'enrollment cannot rewind'); END;
        CREATE TRIGGER IF NOT EXISTS managed_enrollment_events_no_update BEFORE UPDATE ON managed_enrollment_events
        BEGIN SELECT RAISE(ABORT, 'enrollment audit is immutable'); END;
        CREATE TRIGGER IF NOT EXISTS managed_enrollment_events_no_delete BEFORE DELETE ON managed_enrollment_events
        BEGIN SELECT RAISE(ABORT, 'enrollment audit is retained'); END;"
    )?;
    Ok(())
}

coordinated_command! {
    /// Commit uncertainty BEFORE opening private delivery. Exact replay is
    /// observational (false), including after lost acknowledgment or restart.
    pub fn begin_enrollment_attempt(path: &Path, attempt: &EnrollmentAttempt) -> Result<bool> {
        attempt.validate()?;
        let mut connection = open_runtime_connection(path)?;
        let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(existing) = read(&tx, attempt.attempt_id)? {
            anyhow::ensure!(existing.attempt == *attempt, "enrollment attempt conflicts");
            return Ok(false);
        }
        tx.execute("INSERT INTO managed_enrollment_attempts(attempt_id,bootstrap_id,attempt_json,phase)
            VALUES(?1,?2,?3,'pending')", params![attempt.attempt_id.to_string(),attempt.binding.bootstrap_id,serde_json::to_string(attempt)?])?;
        append(&tx, attempt.attempt_id, "pending")?;
        tx.commit()?;
        Ok(true)
    }
    command BeginEnrollmentAttempt { attempt: EnrollmentAttempt = attempt.clone() }
    call |c| (&c.attempt)
    correlation |_c| crate::telemetry::Correlation::default();
    port public;
}

coordinated_command! {
    /// Record only after actual custody completes under genuine current
    /// authority. This SQL receipt alone never proves eligibility or Ready.
    pub fn finish_enrollment_attempt(path: &Path, attempt: &EnrollmentAttempt) -> Result<EnrollmentSnapshot> {
        attempt.validate()?;
        let mut connection = open_runtime_connection(path)?;
        let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let existing = read(&tx, attempt.attempt_id)?.ok_or_else(|| anyhow!("enrollment not recorded"))?;
        anyhow::ensure!(existing.attempt == *attempt && existing.phase != EnrollmentPhase::Terminal, "enrollment unavailable");
        if existing.phase == EnrollmentPhase::Pending {
            // This identifier names a real immutable event in this transaction,
            // not an invented external provider/SQL audit or connection UUID.
            let event_id = append(&tx, attempt.attempt_id, "imported")?;
            let audit = format!("nac-enrollment:{}:{event_id}", attempt.attempt_id);
            tx.execute("UPDATE managed_enrollment_attempts SET phase='imported',import_audit_id=?2 WHERE attempt_id=?1 AND phase='pending'",
                params![attempt.attempt_id.to_string(),audit])?;
        }
        let snapshot = read(&tx, attempt.attempt_id)?.ok_or_else(|| anyhow!("enrollment receipt unavailable"))?;
        tx.commit()?;
        Ok(snapshot)
    }
    command FinishEnrollmentAttempt { attempt: EnrollmentAttempt = attempt.clone() }
    call |c| (&c.attempt)
    correlation |_c| crate::telemetry::Correlation::default();
    port public;
}

coordinated_command! {
    /// Cancellation/expiry/lost custody are permanent for this exact attempt.
    /// A retained import audit remains historical evidence after termination.
    pub fn terminate_enrollment_attempt(path: &Path, attempt: &EnrollmentAttempt) -> Result<()> {
        let mut connection = open_runtime_connection(path)?;
        let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let existing = read(&tx, attempt.attempt_id)?.ok_or_else(|| anyhow!("enrollment not recorded"))?;
        anyhow::ensure!(existing.attempt == *attempt, "enrollment attempt conflicts");
        if existing.phase != EnrollmentPhase::Terminal {
            tx.execute("UPDATE managed_enrollment_attempts SET phase='terminal' WHERE attempt_id=?1", [attempt.attempt_id.to_string()])?;
            append(&tx, attempt.attempt_id, "terminal")?;
        }
        tx.commit()?;
        Ok(())
    }
    command TerminateEnrollmentAttempt { attempt: EnrollmentAttempt = attempt.clone() }
    call |c| (&c.attempt)
    correlation |_c| crate::telemetry::Correlation::default();
    port public;
}

coordinated_command! {
    pub fn read_enrollment_attempt(path: &Path, attempt_id: &Uuid) -> Result<Option<EnrollmentSnapshot>> {
        let connection = open_initialized_read_connection(path)?;
        read(&connection, *attempt_id)
    }
    command ReadEnrollmentAttempt { attempt_id: Uuid = *attempt_id }
    call |c| (&c.attempt_id)
    correlation |_c| crate::telemetry::Correlation::default();
    port public;
}

fn append(connection: &Connection, attempt: Uuid, event: &str) -> Result<i64> {
    connection.execute(
        "INSERT INTO managed_enrollment_events(attempt_id,event,recorded_at) VALUES(?1,?2,?3)",
        params![attempt.to_string(), event, now_utc()],
    )?;
    Ok(connection.last_insert_rowid())
}

fn read(connection: &Connection, attempt: Uuid) -> Result<Option<EnrollmentSnapshot>> {
    let row: Option<(String,String,Option<String>)> = connection.query_row(
        "SELECT attempt_json,phase,import_audit_id FROM managed_enrollment_attempts WHERE attempt_id=?1",
        [attempt.to_string()], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    row.map(|(json, phase, import_audit_id)| {
        let attempt: EnrollmentAttempt = serde_json::from_str(&json)?;
        attempt.validate()?;
        let phase = match phase.as_str() {
            "pending" => EnrollmentPhase::Pending,
            "imported" => EnrollmentPhase::Imported,
            "terminal" => EnrollmentPhase::Terminal,
            _ => return Err(anyhow!("enrollment phase unavailable")),
        };
        Ok(EnrollmentSnapshot {
            attempt,
            phase,
            import_audit_id,
        })
    })
    .transpose()
}

#[cfg(test)]
#[path = "managed_enrollment_tests.rs"]
mod tests;
