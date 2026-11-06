//! Exact retained delegation, issued only by the human product service.
use super::*;
use crate::session_service::SubmittedTaskFollowupDelegation;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct TaskFollowupDelegationRequest {
    pub request_id: String,
    pub target_session_id: String,
    pub action: TaskFollowupAction,
    pub project_id: Option<String>,
}

impl TaskFollowupDelegationRequest {
    pub(crate) fn validate(&self) -> Result<()> {
        for id in [
            Some(self.request_id.as_str()),
            Some(self.target_session_id.as_str()),
            self.project_id.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if id.trim().is_empty() || id.len() > 160 {
                return Err(TaskFollowupError::Invalid.into());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct TaskFollowupDelegation {
    pub id: String,
    pub caller_session_id: String,
    pub human_request_id: String,
    pub target_session_id: String,
    pub action: TaskFollowupAction,
    pub issued_config_version: i64,
    pub origin: String,
    pub created_at: String,
    pub revoked_at: Option<String>,
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskFollowupDelegation> {
    let action: String = row.get(4)?;
    let action = match action.as_str() {
        "queue" => TaskFollowupAction::Queue,
        "steer" => TaskFollowupAction::Steer,
        "auto" => TaskFollowupAction::Auto,
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    Ok(TaskFollowupDelegation {
        id: row.get(0)?,
        caller_session_id: row.get(1)?,
        human_request_id: row.get(2)?,
        target_session_id: row.get(3)?,
        action,
        issued_config_version: row.get(5)?,
        origin: row.get(6)?,
        created_at: row.get(7)?,
        revoked_at: row.get(8)?,
    })
}

const COLUMNS: &str = "id,caller_session_id,human_request_id,target_session_id,action,issued_config_version,origin,created_at,revoked_at";

pub(super) fn require_delegation(
    conn: &Connection,
    request: &TaskFollowupRequest,
    scope: &super::task_followups::TaskFollowupScope,
) -> Result<String> {
    let bound: Option<(String, String)> = conn
        .query_row(
            "SELECT id,scope_json FROM task_followup_delegations
         WHERE caller_session_id=?1 AND target_session_id=?2 AND action=?3
         AND revoked_at IS NULL",
            params![
                request.caller_session_id,
                request.target_session_id,
                request.action.as_str()
            ],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    match bound {
        Some((id, binding)) if binding == serde_json::to_string(scope)? => Ok(id),
        _ => Err(TaskFollowupError::AuthorizationRequired.into()),
    }
}

coordinated_command! {
/// Only a private lifecycle-issued capability can create retained delegation.
pub(crate) fn issue_task_followup_delegation(path: &Path, submission: &SubmittedTaskFollowupDelegation) -> Result<TaskFollowupDelegation> {
    if super::schema::resolved_store_path(path)? != super::schema::resolved_store_path(submission.store_path())? {
        return Err(TaskFollowupError::Unavailable.into());
    }
    let request = submission.request();
    request.validate()?;
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let existing: Option<(String,String)> = tx.query_row(
        "SELECT id,request_json FROM task_followup_delegations WHERE caller_session_id=?1 AND human_request_id=?2",
        params![submission.caller(),request.request_id], |row| Ok((row.get(0)?,row.get(1)?)),
    ).optional()?;
    let json = serde_json::to_string(request)?;
    if let Some((id, original)) = existing {
        if original != json { return Err(TaskFollowupError::IdentityConflict.into()); }
        return load_with_connection(&tx, submission.caller(), &id)?.ok_or_else(|| TaskFollowupError::Unavailable.into());
    }
    let scope = super::task_followups::validate_scope(&tx, submission.caller(), &request.target_session_id, request.project_id.as_deref())?;
    let version: i64 = tx.query_row("SELECT config_version FROM sessions WHERE session_id=?1", [submission.caller()], |row| row.get(0))?;
    if version != submission.config_version() { return Err(TaskFollowupError::Unavailable.into()); }
    let now = now_utc();
    // A new explicit human request replaces the exact tuple's previous grant.
    // Retrying a revoked request above never resurrects it.
    tx.execute("UPDATE task_followup_delegations SET revoked_at=?1 WHERE caller_session_id=?2 AND target_session_id=?3 AND action=?4 AND revoked_at IS NULL",
        params![now,submission.caller(),request.target_session_id,request.action.as_str()])?;
    tx.execute("INSERT INTO task_followup_delegations(id,caller_session_id,human_request_id,target_session_id,action,request_json,scope_json,issued_config_version,origin,created_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'human_product_request',?9)",
        params![submission.id(),submission.caller(),request.request_id,request.target_session_id,request.action.as_str(),json,serde_json::to_string(&scope)?,version,now])?;
    tx.commit().map_err(|e| anyhow::Error::from(e).context(TaskFollowupError::CommitUncertain))?;
    #[cfg(test)]
    if LOSE_ACK.with(|fault| fault.replace(false)) { return Err(TaskFollowupError::CommitUncertain.into()); }
    load_with_connection(&conn, submission.caller(), submission.id())?
        .ok_or_else(|| TaskFollowupError::CommitUncertain.into())
}
command IssueTaskFollowupDelegationCommand { submission: SubmittedTaskFollowupDelegation = submission.clone() }
call |command| (&command.submission)
correlation |command| crate::telemetry::Correlation::session(Some(command.submission.caller()));
port internal;
}

fn load_with_connection(
    conn: &Connection,
    caller: &str,
    id: &str,
) -> Result<Option<TaskFollowupDelegation>> {
    Ok(conn.query_row(&format!("SELECT {COLUMNS} FROM task_followup_delegations WHERE caller_session_id=?1 AND id=?2"),
        params![caller,id], row_to_record).optional()?)
}

coordinated_command! {
/// Passive exact inspection of durable delegation evidence; no attachment.
pub fn load_task_followup_delegation(path: &Path, caller: &str, id: &str) -> Result<Option<TaskFollowupDelegation>> {
    let conn = open_runtime_connection(path)?;
    load_with_connection(&conn, caller, id)
}
command LoadTaskFollowupDelegationCommand { caller: String = caller.to_owned(), id: String = id.to_owned() }
call |command| (&command.caller,&command.id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.caller));
port public;
}

coordinated_command! {
/// Revocation reduces authority and never cancels already accepted input.
pub fn revoke_task_followup_delegation(path: &Path, caller: &str, id: &str) -> Result<Option<TaskFollowupDelegation>> {
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    tx.execute("UPDATE task_followup_delegations SET revoked_at=COALESCE(revoked_at,?1) WHERE caller_session_id=?2 AND id=?3",params![now_utc(),caller,id])?;
    let result = load_with_connection(&tx, caller, id)?;
    tx.commit()?;
    Ok(result)
}
command RevokeTaskFollowupDelegationCommand { caller: String = caller.to_owned(), id: String = id.to_owned() }
call |command| (&command.caller,&command.id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.caller));
port public;
}

#[cfg(test)]
thread_local! { static LOSE_ACK: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }

#[cfg(test)]
pub(crate) fn issue_test_task_followup_delegation(
    path: &Path,
    caller: &str,
    target: &str,
    action: TaskFollowupAction,
) -> TaskFollowupDelegation {
    let conn = open_runtime_connection(path).unwrap();
    let project_id = conn
        .query_row(
            "SELECT project_id FROM session_projects WHERE session_id=?1",
            [target],
            |r| r.get(0),
        )
        .optional()
        .unwrap();
    drop(conn);
    let submission = SubmittedTaskFollowupDelegation::for_test(
        path,
        caller,
        TaskFollowupDelegationRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            target_session_id: target.into(),
            action,
            project_id,
        },
    );
    issue_task_followup_delegation(path, &submission).unwrap()
}

#[cfg(test)]
#[path = "task_followup_delegations_tests.rs"]
mod tests;
