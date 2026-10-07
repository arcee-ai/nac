//! One selected original commits its durable run preconditions and native ack.
use super::*;
use crate::sessions::{SessionBehavior, SessionOperationLease};
use std::sync::Arc;

#[derive(Clone)]
pub(crate) struct RuntimeRunStart {
    pub session_id: String,
    pub run_id: String,
    pub behavior: SessionBehavior,
    pub config_version: i64,
    pub managed_execution_mode: Option<ManagedOrchestratorExecutionMode>,
    pub child_execution_mode: Option<TraditionalChildExecutionMode>,
    pub started_at_epoch_ms: u64,
    pub goal_continuation: bool,
    pub identity: ManagedRuntimeOperationIdentity,
}

coordinated_command! {
pub(crate) fn commit_runtime_run_start(path: &Path, selected: &RuntimeRunStart,
    lease: &Arc<SessionOperationLease>, current: &Arc<MutationAdmission>, initial: &Arc<MutationAdmission>)
    -> Result<TranscriptLogWriter> {
    lease.validate(path, &selected.session_id)?;
    initial()?;
    let mut connection = open_runtime_connection(path)?;
    let transaction = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    initial()?;
    let retained = managed_runtime_admission::read_with_connection(&transaction, &selected.identity)?
        .ok_or_else(|| anyhow!("runtime original barrier unavailable"))?;
    anyhow::ensure!(retained.observation.is_none(), "runtime original was already acknowledged");
    let (actual_behavior, actual_version): (String, i64) = transaction.query_row(
        "SELECT behavior, config_version FROM sessions WHERE session_id = ?1",
        [&selected.session_id], |row| Ok((row.get(0)?, row.get(1)?)))?;
    anyhow::ensure!(actual_behavior == selected.behavior.as_str(), "runtime session behavior changed");
    anyhow::ensure!(actual_version == selected.config_version, "runtime session configuration changed");
    match selected.behavior {
        SessionBehavior::Orchestrator => {
            if let Some(mode) = selected.managed_execution_mode {
                managed_orchestrators::begin_managed_orchestrator_run_in_transaction(
                    &transaction, &selected.session_id, &selected.run_id, mode,
                )?;
            }
        }
        SessionBehavior::Direct | SessionBehavior::DirectWithOrchestrator => {
            if traditional_children::load_child_with_connection(&transaction, &selected.session_id)?.is_some() {
                traditional_children::begin_traditional_child_run_in_transaction(&transaction,
                    &selected.session_id, &selected.run_id,
                    selected.child_execution_mode.unwrap_or(TraditionalChildExecutionMode::Background))?;
            } else {
                session_goals::bind_session_goal_run_with_connection(&transaction, &selected.session_id, &GoalRunBaseline {
                    run_id: selected.run_id.clone(), billable_tokens: 0,
                    started_at_epoch_ms: selected.started_at_epoch_ms, continuation: selected.goal_continuation,
                })?;
            }
        }
    }
    let changed = transaction.execute("UPDATE sessions SET run_count = COALESCE(run_count, 0) + 1 WHERE session_id = ?1", [&selected.session_id])?;
    anyhow::ensure!(changed == 1, "runtime run session disappeared");
    let writer = TranscriptLogWriter::for_run_with_connection(path, &selected.session_id,
        &selected.run_id, lease, &transaction)?.with_runtime_run_admission(Arc::clone(current), Arc::clone(initial));
    let native = ManagedRuntimeObservation::Run { session_id: selected.session_id.parse()?, run_id: selected.run_id.parse()? };
    managed_runtime_admission::acknowledge_with_connection(&transaction, &selected.identity, &native)?;
    runtime_run_recovery::record_start(&transaction, selected)?;
    initial()?;
    transaction.commit()?;
    Ok(writer)
}
command CommitRuntimeRunStartCommand {
    selected: RuntimeRunStart = selected.clone(),
    lease: Arc<SessionOperationLease> = Arc::clone(lease),
    current: Arc<MutationAdmission> = Arc::clone(current),
    initial: Arc<MutationAdmission> = Arc::clone(initial),
}
call |command| (&command.selected, &command.lease, &command.current, &command.initial)
correlation |command| crate::telemetry::Correlation::session(Some(&command.selected.session_id)).with_run(Some(&command.selected.run_id));
port internal;
}
