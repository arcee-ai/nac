//! Argument-bound peer start receipts. Goal truth stays in session_goals and
//! the existing bounded task evidence owner; a receipt is an immutable reply.
use super::goal_changes::{committed, GoalChangeKind};
use super::*;
use crate::peer_goal_control::PeerGoalError;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct PeerGoalStart {
    pub caller_session_id: String,
    pub request_id: String,
    pub target_session_id: String,
    pub project_id: Option<String>,
    pub objective: String,
    pub token_budget: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct PeerGoalStartReceipt {
    pub request: PeerGoalStart,
    /// Original admission response, never rewritten by subsequent goal activity.
    pub admitted_goal: SessionGoalRecord,
}

fn receipt(
    connection: &Connection,
    request: &PeerGoalStart,
) -> Result<Option<PeerGoalStartReceipt>> {
    let stored: Option<(String, String)> = connection
        .query_row(
            "SELECT request_json, response_json FROM peer_goal_starts
         WHERE caller_session_id = ?1 AND request_id = ?2",
            params![request.caller_session_id, request.request_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    stored
        .map(|(arguments, response)| {
            let arguments: PeerGoalStart = serde_json::from_str(&arguments)?;
            anyhow::ensure!(
                arguments == *request,
                PeerGoalError::Conflict("peer goal request reused with different arguments")
            );
            Ok(PeerGoalStartReceipt {
                request: arguments,
                admitted_goal: serde_json::from_str(&response)?,
            })
        })
        .transpose()
}

coordinated_command! {
pub(crate) fn lookup_peer_goal_start(path: &Path, request: &PeerGoalStart) -> Result<Option<PeerGoalStartReceipt>> {
    let connection = open_runtime_connection(path)?;
    receipt(&connection, request)
}
command LookupPeerGoalStartCommand { request: PeerGoalStart = request.clone() }
call |command| (&command.request)
correlation |command| crate::telemetry::Correlation::session(Some(&command.request.target_session_id));
port internal;
}

coordinated_command! {
pub(crate) fn start_peer_goal(path: &Path, request: &PeerGoalStart, active_run: Option<&GoalRunBaseline>, config_version: i64) -> Result<PeerGoalStartReceipt> {
    let mut connection = open_runtime_connection(path)?;
    let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(receipt) = receipt(&tx, request)? { return Ok(receipt); }
    require_configuration(&tx, &request.target_session_id, config_version)?;
    require_project(&tx, &request.target_session_id, request.project_id.as_deref())?;
    // Revalidate topology in the write transaction, not just at discovery.
    require_peer(&tx, &request.target_session_id)?;
    if let Some(current) = super::session_goals::load_with_connection(&tx, &request.target_session_id)? {
        anyhow::ensure!(!current.status.is_unfinished(), PeerGoalError::Conflict("target already has an unfinished goal"));
        anyhow::ensure!(current.accounting_run_id.is_none(), PeerGoalError::Unavailable("previous goal accounting has not settled"));
    }
    let (goal, retired) = super::session_goals::create_with_connection(
        &tx, &request.target_session_id, &request.objective, request.token_budget, active_run,
    )?;
    tx.execute("INSERT INTO peer_goal_starts VALUES (?1, ?2, ?3, ?4, ?5)", params![
        request.caller_session_id, request.request_id, request.target_session_id,
        serde_json::to_string(request)?, serde_json::to_string(&goal)?,
    ])?;
    tx.commit()?;
    if let Some(retired) = &retired {
        committed(path, retired, GoalChangeKind::Replaced);
    }
    committed(path, &goal, GoalChangeKind::Current);
    Ok(PeerGoalStartReceipt { request: request.clone(), admitted_goal: goal })
}
command StartPeerGoalCommand { request: PeerGoalStart = request.clone(), active_run: Option<GoalRunBaseline> = active_run.cloned(), config_version: i64 = config_version }
call |command| (&command.request, command.active_run.as_ref(), command.config_version)
correlation |command| crate::telemetry::Correlation::session(Some(&command.request.target_session_id));
port internal;
}

fn require_peer(connection: &Connection, session_id: &str) -> Result<()> {
    let eligible: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions s WHERE s.session_id = ?1 AND s.behavior = 'direct'
         AND s.sandbox_json IS NULL AND s.host_id IS NULL
         AND NOT EXISTS(SELECT 1 FROM traditional_children c WHERE c.child_session_id = s.session_id)
         AND NOT EXISTS(SELECT 1 FROM managed_orchestrators m WHERE m.orchestrator_session_id = s.session_id))",
        [session_id], |row| row.get(0),
    )?;
    anyhow::ensure!(
        eligible,
        PeerGoalError::Unavailable("target is not an independent plain direct task")
    );
    Ok(())
}

#[derive(Clone)]
pub(crate) struct PeerGoalTransition {
    pub session_id: String,
    pub goal_id: String,
    pub expected_version: i64,
    pub resume: bool,
    pub active_run_id: Option<String>,
    pub project_id: Option<String>,
    pub config_version: i64,
}

coordinated_command! {
pub(crate) fn transition_peer_goal(path: &Path, transition: &PeerGoalTransition) -> Result<SessionGoalRecord> {
    let PeerGoalTransition {session_id, goal_id, expected_version, resume, active_run_id, project_id, config_version} = transition;
    let expected_version = *expected_version;
    let resume = *resume;
    let mut connection = open_runtime_connection(path)?;
    let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    require_configuration(&tx, session_id, *config_version)?;
    require_peer(&tx, session_id)?;
    require_project(&tx, session_id, project_id.as_deref())?;
    let goal = super::session_goals::load_with_connection(&tx, session_id)?.ok_or_else(|| anyhow!(PeerGoalError::Conflict("target has no current goal")))?;
    anyhow::ensure!(goal.goal_id == *goal_id && goal.version == expected_version, PeerGoalError::Conflict("goal identity/version changed"));
    anyhow::ensure!(if resume { matches!(goal.status, GoalStatus::Paused | GoalStatus::Blocked | GoalStatus::UsageLimited) } else { goal.status == GoalStatus::Active }, PeerGoalError::Conflict("goal status cannot make this transition"));
    anyhow::ensure!(!resume || goal.remaining_tokens() != Some(0), PeerGoalError::Conflict("goal budget is exhausted"));
    anyhow::ensure!(goal.accounting_run_id == *active_run_id, PeerGoalError::Unavailable("goal accounting owner differs from the active run"));
    // Resume during accounting could omit already spent tokens. Wait for exact
    // settlement; pause preserves the accounting binding for the active run.
    anyhow::ensure!(!resume || goal.accounting_run_id.is_none(), PeerGoalError::Unavailable("active goal accounting has not settled"));
    let updated = super::session_goals::update_with_connection(&tx, session_id, goal_id, expected_version, UserGoalUpdate {
        status: Some(if resume {GoalStatus::Active} else {GoalStatus::Paused}),
        ..Default::default()
    })?;
    tx.commit()?;
    committed(path, &updated, GoalChangeKind::Current);
    Ok(updated)
}
command TransitionPeerGoalCommand { transition: PeerGoalTransition = transition.clone() }
call |command| (&command.transition)
correlation |command| crate::telemetry::Correlation::session(Some(&command.transition.session_id));
port internal;
}

fn require_project(
    connection: &Connection,
    session_id: &str,
    project_id: Option<&str>,
) -> Result<()> {
    let actual: Option<String> = connection
        .query_row(
            "SELECT project_id FROM session_projects WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )
        .optional()?;
    anyhow::ensure!(
        actual.as_deref() == project_id,
        PeerGoalError::Conflict("target project changed")
    );
    Ok(())
}

#[cfg(test)]
#[path = "peer_goals_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "peer_goal_hint_tests.rs"]
mod hint_tests;

fn require_configuration(connection: &Connection, session_id: &str, expected: i64) -> Result<()> {
    let matches: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE session_id=?1 AND config_version=?2)",
        params![session_id, expected],
        |row| row.get(0),
    )?;
    anyhow::ensure!(
        matches,
        PeerGoalError::Conflict("target configuration changed before goal commit")
    );
    Ok(())
}
