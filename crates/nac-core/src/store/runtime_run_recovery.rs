//! Durable accepted-start ownership before a native original commits its prompt.
//! These retained rows are recovery evidence, never execution capabilities.
use super::*;
use crate::sessions::SessionOperationLease;
use std::sync::Arc;

struct PendingStart {
    operation_id: String,
    run_id: String,
    relationship: Option<(String, u64)>,
    goal: Option<(String, i64)>,
}

pub(super) fn create_runtime_run_starts_table(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS runtime_run_starts (
            operation_id TEXT PRIMARY KEY NOT NULL REFERENCES managed_runtime_operations(operation_id),
            session_id TEXT NOT NULL,
            run_id TEXT NOT NULL UNIQUE,
            behavior TEXT NOT NULL CHECK(behavior IN ('orchestrator','direct','direct-with-orchestrator')),
            config_version INTEGER NOT NULL CHECK(config_version >= 0),
            relationship_kind TEXT CHECK(relationship_kind IN ('child','managed')),
            relationship_generation INTEGER CHECK(relationship_generation > 0),
            goal_id TEXT,
            goal_version INTEGER CHECK(goal_version >= 0),
            phase TEXT NOT NULL CHECK(phase IN ('pending','prompted','abandoned')),
            CHECK((relationship_kind IS NULL) = (relationship_generation IS NULL)),
            CHECK((goal_id IS NULL) = (goal_version IS NULL)),
            CHECK(relationship_kind IS NULL OR goal_id IS NULL)
        );
        CREATE INDEX IF NOT EXISTS runtime_run_starts_pending ON runtime_run_starts(session_id) WHERE phase = 'pending';
        CREATE TRIGGER IF NOT EXISTS runtime_run_starts_bind_ack
        BEFORE INSERT ON runtime_run_starts
        WHEN NOT EXISTS(SELECT 1 FROM managed_runtime_operations
            WHERE operation_id = NEW.operation_id AND observation_kind = 'run'
              AND session_id = NEW.session_id AND run_id = NEW.run_id)
        BEGIN SELECT RAISE(ABORT, 'runtime start must bind its immutable run ack'); END;
        CREATE TRIGGER IF NOT EXISTS runtime_run_starts_no_delete
        BEFORE DELETE ON runtime_run_starts
        BEGIN SELECT RAISE(ABORT, 'runtime start history is retained'); END;
        CREATE TRIGGER IF NOT EXISTS runtime_run_starts_fenced
        BEFORE UPDATE ON runtime_run_starts
        WHEN NEW.operation_id IS NOT OLD.operation_id OR NEW.session_id IS NOT OLD.session_id OR
             NEW.run_id IS NOT OLD.run_id OR NEW.behavior IS NOT OLD.behavior OR
             NEW.config_version IS NOT OLD.config_version OR
             NEW.relationship_kind IS NOT OLD.relationship_kind OR
             NEW.relationship_generation IS NOT OLD.relationship_generation OR
             NEW.goal_id IS NOT OLD.goal_id OR NEW.goal_version IS NOT OLD.goal_version OR
             OLD.phase != 'pending' OR NEW.phase NOT IN ('prompted','abandoned')
        BEGIN SELECT RAISE(ABORT, 'runtime start ownership cannot rewind'); END;",
    )?;
    Ok(())
}

pub(super) fn record_start(
    transaction: &Transaction<'_>,
    selected: &runtime_run_start::RuntimeRunStart,
) -> Result<()> {
    let relationship: Option<(String, u64)> = transaction.query_row(
        "SELECT 'child', generation FROM traditional_children WHERE child_session_id = ?1 AND run_id = ?2 AND status = 'running'
         UNION ALL SELECT 'managed', generation FROM managed_orchestrators WHERE orchestrator_session_id = ?1 AND run_id = ?2 AND status = 'running'",
        params![selected.session_id, selected.run_id], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional()?;
    let goal: Option<(String, i64)> = transaction.query_row(
        "SELECT goal_id, version FROM session_goals WHERE session_id = ?1 AND accounting_run_id = ?2",
        params![selected.session_id, selected.run_id], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional()?;
    transaction.execute(
        "INSERT INTO runtime_run_starts (operation_id, session_id, run_id, behavior, config_version,
             relationship_kind, relationship_generation, goal_id, goal_version, phase)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending')",
        params![selected.identity.operation_id.to_string(), selected.session_id, selected.run_id,
            selected.behavior.as_str(), selected.config_version, relationship.as_ref().map(|value| &value.0),
            relationship.as_ref().map(|value| value.1), goal.as_ref().map(|value| &value.0), goal.as_ref().map(|value| value.1)],
    )?;
    Ok(())
}

pub(super) fn mark_prompt_committed(
    transaction: &Transaction<'_>,
    session_id: &str,
    run_id: &str,
) -> Result<()> {
    let phase: Option<String> = transaction
        .query_row(
            "SELECT phase FROM runtime_run_starts WHERE session_id = ?1 AND run_id = ?2",
            params![session_id, run_id],
            |row| row.get(0),
        )
        .optional()?;
    match phase.as_deref() {
        Some("pending") => {
            transaction.execute("UPDATE runtime_run_starts SET phase = 'prompted' WHERE session_id = ?1 AND run_id = ?2 AND phase = 'pending'",
                params![session_id, run_id])?;
        }
        Some("abandoned") => anyhow::bail!("runtime original start was already abandoned"),
        None | Some("prompted") => {}
        Some(_) => anyhow::bail!("invalid runtime original start phase"),
    }
    Ok(())
}

coordinated_command! {
/// Requires the actual selected OS lease throughout reconciliation. A retained
/// operation row or copied UUID cannot prove an original owner is gone.
pub(crate) fn reconcile_runtime_run_starts(path: &Path, session_id: &str,
    lease: &Arc<SessionOperationLease>, admission: &Arc<MutationAdmission>) -> Result<Vec<String>> {
    lease.validate(path, session_id)?;
    admission()?;
    let mut connection = open_runtime_connection(path)?;
    let transaction = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    lease.validate(path, session_id)?;
    admission()?;
    let starts = {
        let mut statement = transaction.prepare("SELECT operation_id, run_id, relationship_kind, relationship_generation, goal_id, goal_version
            FROM runtime_run_starts WHERE session_id = ?1 AND phase = 'pending' ORDER BY rowid")?;
        let starts = statement.query_map([session_id], |row| Ok(PendingStart {
            operation_id: row.get(0)?, run_id: row.get(1)?,
            relationship: row.get::<_, Option<String>>(2)?.zip(row.get(3)?),
            goal: row.get::<_, Option<String>>(4)?.zip(row.get(5)?),
        }))?.collect::<rusqlite::Result<Vec<_>>>()?;
        starts
    };
    let mut recovered = Vec::new();
    for start in starts {
        corroborate_unprompted(&transaction, session_id, &start)?;
        settle_unprompted(&transaction, session_id, &start)?;
        transaction.execute("UPDATE runtime_run_starts SET phase = 'abandoned' WHERE operation_id = ?1 AND phase = 'pending'", [&start.operation_id])?;
        recovered.push(start.run_id);
    }
    admission()?;
    transaction.commit()?;
    Ok(recovered)
}
command ReconcileRuntimeRunStartsCommand {
    session_id: String = session_id.to_owned(),
    lease: Arc<SessionOperationLease> = Arc::clone(lease),
    admission: Arc<MutationAdmission> = Arc::clone(admission),
}
call |command| (&command.session_id, &command.lease, &command.admission)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

fn corroborate_unprompted(
    connection: &Connection,
    session_id: &str,
    start: &PendingStart,
) -> Result<()> {
    let ack_matches: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM managed_runtime_operations
        WHERE operation_id = ?1 AND observation_kind = 'run' AND session_id = ?2 AND run_id = ?3)",
        params![start.operation_id, session_id, start.run_id],
        |row| row.get(0),
    )?;
    anyhow::ensure!(ack_matches, "runtime start ack does not match its owner");
    let prompt_evidence: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM transcript_append_receipts WHERE session_id = ?1 AND run_id = ?2)
        OR EXISTS(SELECT 1 FROM session_run_recovery WHERE session_id = ?1 AND (run_id = ?2 OR status = 'active'))",
        params![session_id, start.run_id], |row| row.get(0))?;
    anyhow::ensure!(
        !prompt_evidence,
        "pending runtime start has conflicting prompt evidence"
    );
    Ok(())
}

fn settle_unprompted(
    transaction: &Transaction<'_>,
    session_id: &str,
    start: &PendingStart,
) -> Result<()> {
    if let Some((kind, generation)) = &start.relationship {
        let current: Option<(u64, Option<String>, String)> = match kind.as_str() {
            "child" => transaction.query_row("SELECT generation, run_id, status FROM traditional_children WHERE child_session_id = ?1", [session_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).optional()?,
            "managed" => transaction.query_row("SELECT generation, run_id, status FROM managed_orchestrators WHERE orchestrator_session_id = ?1", [session_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).optional()?,
            _ => anyhow::bail!("invalid runtime start relationship"),
        };
        let Some((current_generation, current_run, status)) = current else {
            return Ok(());
        };
        // A newer/removed relationship is not owned by this old start. Retain
        // its immutable anchor and ack without touching that target generation.
        if current_generation != *generation
            || current_run.as_deref() != Some(&start.run_id)
            || status != "running"
        {
            return Ok(());
        }
        let failure =
            Some("native run start was interrupted before its prompt committed".to_string());
        if kind == "child" {
            traditional_children::settle_traditional_child_run_in_transaction(
                transaction,
                session_id,
                &start.run_id,
                TraditionalChildTerminal {
                    status: TraditionalChildStatus::Interrupted,
                    report: None,
                    failure,
                    change_summary: None,
                    verification_summary: None,
                },
            )?;
        } else {
            managed_orchestrators::settle_managed_orchestrator_run_in_transaction(
                transaction,
                session_id,
                &start.run_id,
                &mut ManagedOrchestratorTerminal {
                    status: ManagedOrchestratorStatus::Interrupted,
                    report: None,
                    failure,
                },
            )?;
        }
    } else if let Some((goal_id, version)) = &start.goal {
        // Clear only the captured accounting revision. Goal totals, objective,
        // status and any later user's edit remain authoritative.
        let changed = transaction.execute("UPDATE session_goals SET accounting_run_id = NULL, accounting_token_baseline = NULL,
            accounting_started_at_epoch_ms = NULL, continuation_run_id = NULL, updated_at = ?1, version = version + 1
            WHERE session_id = ?2 AND goal_id = ?3 AND version = ?4 AND accounting_run_id = ?5",
            params![now_utc(), session_id, goal_id, version, start.run_id])?;
        if changed == 0 {
            let same_claim: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM session_goals WHERE session_id = ?1 AND goal_id = ?2 AND accounting_run_id = ?3)",
                params![session_id, goal_id, start.run_id], |row| row.get(0))?;
            anyhow::ensure!(
                !same_claim,
                "runtime start goal accounting revision changed; ownership uncertain"
            );
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "runtime_run_recovery_tests.rs"]
mod tests;
