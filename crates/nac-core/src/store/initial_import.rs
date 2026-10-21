//! Initial source-consume/private-start history. No row or CAS result is a
//! source, channel, custody or execution capability. The admission service
//! must retain actual authority and accept only its own winning transaction.
use super::*;
use nac_contracts::ProtectedImportPhase;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Nonsecret observations mapped from an already verified phase. These fields
/// do not authenticate a Root commit or a physical channel.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InitialImportProofRecord {
    pub attempt_id: Uuid,
    pub grant_id: Uuid,
    pub phase: ProtectedImportPhase,
    pub proof_sha256: [u8; 32],
    pub issued_proof_sha256: [u8; 32],
    pub preceding_proof_sha256: Option<[u8; 32]>,
    pub consumed_audit_id: Option<Uuid>,
}
impl InitialImportProofRecord {
    pub(crate) fn validate(&self) -> Result<()> {
        anyhow::ensure!(
            !self.attempt_id.is_nil() && !self.grant_id.is_nil(),
            "initial import identity unavailable"
        );
        anyhow::ensure!(
            self.proof_sha256 != [0; 32] && self.issued_proof_sha256 != [0; 32],
            "initial import proof unavailable"
        );
        if self.phase == ProtectedImportPhase::Issue {
            anyhow::ensure!(
                self.proof_sha256 == self.issued_proof_sha256
                    && self.preceding_proof_sha256.is_none()
                    && self.consumed_audit_id.is_none(),
                "initial import issue lineage invalid"
            );
        } else {
            anyhow::ensure!(
                self.preceding_proof_sha256.is_some_and(|v| v != [0; 32])
                    && self.consumed_audit_id.is_some_and(|v| !v.is_nil()),
                "initial import consume lineage unavailable"
            );
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InitialImportState {
    Issued,
    Consumed,
    Started,
    Imported,
    Terminal,
}

/// Readback only. In particular Started cannot reconstruct an importer loan.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InitialImportSnapshot {
    pub enrollment: EnrollmentSnapshot,
    pub grant_id: Uuid,
    pub state: InitialImportState,
    pub revision: u64,
    pub proofs: Vec<InitialImportProofRecord>,
}

pub(super) fn create_tables(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS managed_initial_import_grants (
            attempt_id TEXT PRIMARY KEY NOT NULL REFERENCES managed_enrollment_attempts(attempt_id),
            grant_id TEXT UNIQUE NOT NULL,
            issued_proof_sha256 BLOB UNIQUE NOT NULL CHECK(length(issued_proof_sha256)=32),
            consumed_audit_id TEXT UNIQUE,
            state TEXT NOT NULL CHECK(state IN ('issued','consumed','started','imported','terminal')),
            revision INTEGER NOT NULL CHECK(revision>=0),
            CHECK(state IN ('issued','terminal') OR consumed_audit_id IS NOT NULL)
        );
        CREATE TABLE IF NOT EXISTS managed_initial_import_proofs (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            attempt_id TEXT NOT NULL REFERENCES managed_initial_import_grants(attempt_id),
            phase_sequence INTEGER NOT NULL CHECK(phase_sequence BETWEEN 0 AND 7),
            proof_sha256 BLOB UNIQUE NOT NULL CHECK(length(proof_sha256)=32),
            proof_json TEXT NOT NULL,
            recorded_at TEXT NOT NULL,
            UNIQUE(attempt_id,phase_sequence)
        );
        CREATE TRIGGER IF NOT EXISTS managed_initial_import_grants_no_delete BEFORE DELETE ON managed_initial_import_grants
        BEGIN SELECT RAISE(ABORT,'initial import history retained'); END;
        CREATE TRIGGER IF NOT EXISTS managed_initial_import_grants_fenced BEFORE UPDATE ON managed_initial_import_grants
        WHEN NEW.attempt_id IS NOT OLD.attempt_id OR NEW.grant_id IS NOT OLD.grant_id
            OR NEW.issued_proof_sha256 IS NOT OLD.issued_proof_sha256
            OR NEW.revision != OLD.revision+1 OR OLD.state='terminal'
            OR NOT ((OLD.state='issued' AND NEW.state IN ('consumed','terminal'))
                OR (OLD.state='consumed' AND NEW.state IN ('started','terminal'))
                OR (OLD.state='started' AND NEW.state IN ('imported','terminal'))
                OR (OLD.state='imported' AND NEW.state IN ('imported','terminal')))
            OR (OLD.consumed_audit_id IS NOT NULL AND NEW.consumed_audit_id IS NOT OLD.consumed_audit_id)
            OR (OLD.state!='issued' AND NEW.consumed_audit_id IS NOT OLD.consumed_audit_id)
            OR (OLD.state='issued' AND NEW.state='terminal' AND NEW.consumed_audit_id IS NOT OLD.consumed_audit_id)
        BEGIN SELECT RAISE(ABORT,'initial import cannot rewind'); END;
        CREATE TRIGGER IF NOT EXISTS managed_initial_import_proofs_no_update BEFORE UPDATE ON managed_initial_import_proofs
        BEGIN SELECT RAISE(ABORT,'initial import proof immutable'); END;
        CREATE TRIGGER IF NOT EXISTS managed_initial_import_proofs_no_delete BEFORE DELETE ON managed_initial_import_proofs
        BEGIN SELECT RAISE(ABORT,'initial import proof retained'); END;"
    )?;
    Ok(())
}

coordinated_command! {
    /// Record pending plus issued lineage atomically BEFORE remote consume.
    /// Exact replay returns false, never a fresh process-local attempt owner.
    pub fn begin_initial_import_grant(path: &Path, attempt: &EnrollmentAttempt, proof: &InitialImportProofRecord) -> Result<bool> {
        attempt.validate()?;
        proof.validate()?;
        anyhow::ensure!(proof.attempt_id == attempt.attempt_id && proof.phase == ProtectedImportPhase::Issue, "initial import issue binding unavailable");
        let mut connection = open_runtime_connection(path)?;
        let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(existing) = read(&tx, attempt.attempt_id)? {
            anyhow::ensure!(existing.enrollment.attempt == *attempt && existing.proofs.first() == Some(proof), "initial import issue conflicts");
            return Ok(false);
        }
        // A legacy/unknown attempt is never upgraded into live authority.
        anyhow::ensure!(managed_enrollment::read(&tx, attempt.attempt_id)?.is_none(), "initial import attempt is readback only");
        anyhow::ensure!(managed_enrollment::insert_attempt(&tx, attempt)?, "initial import already pending");
        tx.execute("INSERT INTO managed_initial_import_grants(attempt_id,grant_id,issued_proof_sha256,state,revision) VALUES(?1,?2,?3,'issued',0)",
            params![attempt.attempt_id.to_string(),proof.grant_id.to_string(),proof.proof_sha256.as_slice()])?;
        append(&tx, proof)?;
        tx.commit()?;
        Ok(true)
    }
    command BeginInitialImportGrant { attempt: EnrollmentAttempt = attempt.clone(), proof: InitialImportProofRecord = proof.clone() }
    call |c| (&c.attempt, &c.proof)
    correlation |_c| crate::telemetry::Correlation::default();
    port public;
}

coordinated_command! {
    /// The single phase2 winner records Started BEFORE the private effect.
    /// A true return is only a journal mutation, never sufficient authority.
    /// Phase3 records actual import completion; later phases retain evidence.
    pub fn record_initial_import_phase(path: &Path, attempt: &EnrollmentAttempt, proof: &InitialImportProofRecord) -> Result<bool> {
        attempt.validate()?;
        proof.validate()?;
        let sequence = usize::from(proof.phase.sequence());
        anyhow::ensure!(sequence > 0 && proof.attempt_id == attempt.attempt_id, "initial import phase binding unavailable");
        let mut connection = open_runtime_connection(path)?;
        let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let existing = read(&tx, attempt.attempt_id)?.ok_or_else(|| anyhow!("initial import not pending"))?;
        anyhow::ensure!(existing.enrollment.attempt == *attempt && existing.grant_id == proof.grant_id, "initial import scope conflicts");
        if let Some(retained) = existing.proofs.get(sequence) {
            anyhow::ensure!(retained == proof, "initial import phase conflicts");
            return Ok(false);
        }
        anyhow::ensure!(existing.state != InitialImportState::Terminal && existing.enrollment.phase != EnrollmentPhase::Terminal && existing.proofs.len() == sequence, "initial import phase unavailable");
        let last = existing.proofs.last().ok_or_else(|| anyhow!("initial import lineage unavailable"))?;
        anyhow::ensure!(proof.issued_proof_sha256 == existing.proofs[0].proof_sha256 && proof.preceding_proof_sha256 == Some(last.proof_sha256), "initial import proof chain conflicts");
        if sequence > 1 {
            anyhow::ensure!(proof.consumed_audit_id == last.consumed_audit_id, "initial import Root audit conflicts");
        }
        let expected_enrollment = if sequence <= 3 { EnrollmentPhase::Pending } else { EnrollmentPhase::Imported };
        anyhow::ensure!(existing.enrollment.phase == expected_enrollment, "initial import enrollment unavailable");
        append(&tx, proof)?;
        let updated = tx.execute("UPDATE managed_initial_import_grants SET state=?2,consumed_audit_id=?3,revision=revision+1 WHERE attempt_id=?1 AND revision=?4",
            params![attempt.attempt_id.to_string(),state_for_sequence(sequence),proof.consumed_audit_id.map(|v| v.to_string()),existing.revision])?;
        anyhow::ensure!(updated == 1, "initial import phase lost its revision");
        if sequence == 3 {
            managed_enrollment::finish_in_transaction(&tx, attempt)?;
        }
        tx.commit()?;
        Ok(true)
    }
    command RecordInitialImportPhase { attempt: EnrollmentAttempt = attempt.clone(), proof: InitialImportProofRecord = proof.clone() }
    call |c| (&c.attempt, &c.proof)
    correlation |_c| crate::telemetry::Correlation::default();
    port public;
}

coordinated_command! {
    pub fn terminate_initial_import_grant(path: &Path, attempt: &EnrollmentAttempt) -> Result<()> {
        attempt.validate()?;
        let mut connection = open_runtime_connection(path)?;
        let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let existing = read(&tx, attempt.attempt_id)?.ok_or_else(|| anyhow!("initial import not pending"))?;
        anyhow::ensure!(existing.enrollment.attempt == *attempt, "initial import scope conflicts");
        if existing.state != InitialImportState::Terminal {
            tx.execute("UPDATE managed_initial_import_grants SET state='terminal',revision=revision+1 WHERE attempt_id=?1", [attempt.attempt_id.to_string()])?;
        }
        managed_enrollment::terminate_in_transaction(&tx, attempt)?;
        tx.commit()?;
        Ok(())
    }
    command TerminateInitialImportGrant { attempt: EnrollmentAttempt = attempt.clone() }
    call |c| (&c.attempt)
    correlation |_c| crate::telemetry::Correlation::default();
    port public;
}

coordinated_command! {
    pub fn read_initial_import_grant(path: &Path, attempt_id: &Uuid) -> Result<Option<InitialImportSnapshot>> {
        let connection = open_initialized_read_connection(path)?;
        let tx = connection.unchecked_transaction()?;
        read(&tx, *attempt_id)
    }
    command ReadInitialImportGrant { attempt_id: Uuid = *attempt_id }
    call |c| (&c.attempt_id)
    correlation |_c| crate::telemetry::Correlation::default();
    port public;
}

fn state_for_sequence(sequence: usize) -> &'static str {
    match sequence {
        0 => "issued",
        1 => "consumed",
        2 => "started",
        _ => "imported",
    }
}

fn append(connection: &Connection, proof: &InitialImportProofRecord) -> Result<()> {
    connection.execute("INSERT INTO managed_initial_import_proofs(attempt_id,phase_sequence,proof_sha256,proof_json,recorded_at) VALUES(?1,?2,?3,?4,?5)",
        params![proof.attempt_id.to_string(),proof.phase.sequence(),proof.proof_sha256.as_slice(),serde_json::to_string(proof)?,now_utc()])?;
    Ok(())
}

struct GrantRow {
    grant_id: String,
    state: String,
    revision: u64,
    issued: Vec<u8>,
    consumed: Option<String>,
}

fn read(connection: &Connection, attempt: Uuid) -> Result<Option<InitialImportSnapshot>> {
    let row = connection.query_row(
        "SELECT grant_id,state,revision,issued_proof_sha256,consumed_audit_id FROM managed_initial_import_grants WHERE attempt_id=?1",
        [attempt.to_string()], |r| Ok(GrantRow {grant_id:r.get(0)?,state:r.get(1)?,revision:r.get(2)?,issued:r.get(3)?,consumed:r.get(4)?})).optional()?;
    let Some(GrantRow {
        grant_id,
        state,
        revision,
        issued,
        consumed,
    }) = row
    else {
        return Ok(None);
    };
    let grant_id: Uuid = grant_id.parse()?;
    let mut statement = connection.prepare("SELECT phase_sequence,proof_sha256,proof_json FROM managed_initial_import_proofs WHERE attempt_id=?1 ORDER BY phase_sequence LIMIT 9")?;
    let rows = statement.query_map([attempt.to_string()], |r| {
        Ok((
            r.get::<_, u8>(0)?,
            r.get::<_, Vec<u8>>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;
    let mut proofs: Vec<InitialImportProofRecord> = Vec::new();
    for row in rows {
        let (sequence, digest, json) = row?;
        let proof: InitialImportProofRecord = serde_json::from_str(&json)?;
        proof.validate()?;
        anyhow::ensure!(
            usize::from(sequence) == proofs.len()
                && proof.phase.sequence() == sequence
                && proof.attempt_id == attempt
                && proof.grant_id == grant_id
                && proof.proof_sha256.as_slice() == digest
                && proof.issued_proof_sha256.as_slice() == issued,
            "retained initial import lineage invalid"
        );
        if let Some(last) = proofs.last() {
            anyhow::ensure!(
                proof.preceding_proof_sha256 == Some(last.proof_sha256)
                    && proof.consumed_audit_id.map(|v| v.to_string()) == consumed,
                "retained initial import chain invalid"
            );
        }
        proofs.push(proof);
    }
    anyhow::ensure!(
        !proofs.is_empty() && proofs.len() <= 8,
        "retained initial import proofs unavailable"
    );
    anyhow::ensure!(
        proofs.len() != 1 || consumed.is_none(),
        "retained initial import consume invalid"
    );
    let state = match state.as_str() {
        "issued" => InitialImportState::Issued,
        "consumed" => InitialImportState::Consumed,
        "started" => InitialImportState::Started,
        "imported" => InitialImportState::Imported,
        "terminal" => InitialImportState::Terminal,
        _ => return Err(anyhow!("retained initial import state invalid")),
    };
    let expected_revision =
        (proofs.len() - 1) as u64 + u64::from(state == InitialImportState::Terminal);
    anyhow::ensure!(
        revision == expected_revision
            && (state == InitialImportState::Terminal
                || state_for_sequence(proofs.len() - 1)
                    == match state {
                        InitialImportState::Issued => "issued",
                        InitialImportState::Consumed => "consumed",
                        InitialImportState::Started => "started",
                        _ => "imported",
                    }),
        "retained initial import revision invalid"
    );
    let enrollment = managed_enrollment::read(connection, attempt)?
        .ok_or_else(|| anyhow!("retained enrollment unavailable"))?;
    Ok(Some(InitialImportSnapshot {
        enrollment,
        grant_id,
        state,
        revision,
        proofs,
    }))
}

#[cfg(test)]
#[path = "initial_import_tests.rs"]
mod tests;
