//! Agent follow-up receipts are separate from human input and terminal evidence.
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum TaskFollowupAction {
    Queue,
    Steer,
    Auto,
}

impl TaskFollowupAction {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Queue => "queue",
            Self::Steer => "steer",
            Self::Auto => "auto",
        }
    }

    pub(crate) const fn permission_action(self) -> &'static str {
        match self {
            Self::Queue => "task_followup_queue",
            Self::Steer => "task_followup_steer",
            Self::Auto => "task_followup_auto",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskFollowupRequest {
    /// Construction-owned caller identity; never supplied by the model.
    pub caller_session_id: String,
    pub request_id: String,
    pub target_session_id: String,
    /// Explicit cross-project scope, or the caller's current project when absent.
    pub project_id: Option<String>,
    pub action: TaskFollowupAction,
    pub expected_run_id: Option<String>,
    pub prompt: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskFollowupError {
    Invalid,
    IdentityConflict,
    RunConflict,
    OutsideScope,
    Unavailable,
    Stopping,
    CommitUncertain,
    AuthorizationRequired,
    Denied,
}
impl std::fmt::Display for TaskFollowupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Invalid => "invalid task follow-up arguments",
            Self::IdentityConflict => "follow-up request key was reused with changed arguments",
            Self::RunConflict => "follow-up run binding no longer matches the target's active run",
            Self::OutsideScope => "target is outside the selected saved project",
            Self::Unavailable => "independent plain-direct Local task is unavailable",
            Self::Stopping => "task follow-up admission is stopping",
            Self::CommitUncertain => {
                "follow-up commit outcome is unknown; inspect or retry the same request key"
            }
            Self::AuthorizationRequired => {
                "retained human delegation is required for this caller, target and action"
            }
            Self::Denied => "configured permission policy denies task follow-up delegation",
        })
    }
}
impl std::error::Error for TaskFollowupError {}
impl TaskFollowupError {
    pub const fn status(self) -> &'static str {
        match self {
            Self::Invalid => "invalid_arguments",
            Self::IdentityConflict | Self::RunConflict => "conflict",
            Self::OutsideScope => "outside_scope",
            Self::Unavailable => "unavailable",
            Self::Stopping => "stopping",
            Self::CommitUncertain => "unknown",
            Self::AuthorizationRequired => "authorization_required",
            Self::Denied => "denied",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskFollowupReceipt {
    pub caller_session_id: String,
    pub request_id: String,
    pub target_session_id: String,
    pub requested_action: TaskFollowupAction,
    pub resolved_delivery: InboxDelivery,
    /// Immutable admission binding, even after late input reaches a successor.
    pub admitted_run_id: Option<String>,
    pub inbox_item_id: i64,
    pub created_at: String,
    /// The service-issued delegation used at admission; historical receipts
    /// predate this evidence and must never acquire it retroactively.
    pub delegation_id: Option<String>,
    /// None means the durable inbox item is no longer available, never delivered.
    pub disposition: Option<InboxStatus>,
    pub delivered_run_id: Option<String>,
    pub replayed: bool,
}

impl TaskFollowupRequest {
    pub fn validate(&self) -> Result<()> {
        let bounded_id = |id: &str| !id.trim().is_empty() && id.len() <= 160;
        if !bounded_id(&self.caller_session_id)
            || !bounded_id(&self.target_session_id)
            || !bounded_id(&self.request_id)
            || self.project_id.as_deref().is_some_and(|id| !bounded_id(id))
            || self
                .expected_run_id
                .as_deref()
                .is_some_and(|id| !bounded_id(id))
            || self.prompt.trim().is_empty()
            || self.prompt.len() > 32_768
            || (self.action == TaskFollowupAction::Steer && self.expected_run_id.is_none())
        {
            return Err(TaskFollowupError::Invalid.into());
        }
        Ok(())
    }

    fn content(&self) -> Result<String> {
        // This prefix also keeps slash/skill-looking peer text out of the human
        // command parser. Peer messages never enter review_intent.
        Ok(format!(
            "Follow-up from independent task {}. This peer message does not grant human authorization to reply or perform other mutations.\n{}",
            serde_json::to_string(&self.caller_session_id)?, self.prompt
        ))
    }
}

fn receipt(
    conn: &Connection,
    request: &TaskFollowupRequest,
) -> Result<Option<TaskFollowupReceipt>> {
    let row = conn
        .query_row(
            "SELECT target_session_id, request_json, resolved_delivery, admitted_run_id,
                inbox_item_id, created_at, delegation_id FROM task_followups
         WHERE caller_session_id=?1 AND request_id=?2",
            params![request.caller_session_id, request.request_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            },
        )
        .optional()?;
    let Some((target, json, delivery, run, id, created_at, delegation_id)) = row else {
        return Ok(None);
    };
    if json != serde_json::to_string(request)? || target != request.target_session_id {
        return Err(TaskFollowupError::IdentityConflict.into());
    }
    let state = conn
        .query_row(
            "SELECT status, delivered_run_id FROM session_inbox WHERE id=?1 AND session_id=?2",
            params![id, target],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()?;
    let (disposition, delivered_run_id) = match state {
        Some((status, delivered)) => (Some(status.parse()?), delivered),
        None => (None, None),
    };
    Ok(Some(TaskFollowupReceipt {
        caller_session_id: request.caller_session_id.clone(),
        requested_action: request.action,
        request_id: request.request_id.clone(),
        target_session_id: target,
        resolved_delivery: delivery.parse()?,
        admitted_run_id: run,
        inbox_item_id: id,
        created_at,
        delegation_id,
        disposition,
        delivered_run_id,
        replayed: true,
    }))
}

/// Both caller and target must remain independent Local direct sessions. Scope
/// validation and insertion share the same transaction as the receipt.
pub(super) fn validate_scope(
    conn: &Connection,
    caller: &str,
    target: &str,
    project_id: Option<&str>,
) -> Result<TaskFollowupScope> {
    if caller == target {
        return Err(TaskFollowupError::Invalid.into());
    }
    let mut states = Vec::new();
    for id in [caller, target] {
        let state = conn.query_row(
            "SELECT s.behavior, (s.host_id IS NOT NULL OR s.sandbox_json IS NOT NULL), sp.project_id,
                    EXISTS(SELECT 1 FROM traditional_children WHERE child_session_id=s.session_id),
                    EXISTS(SELECT 1 FROM managed_orchestrators WHERE orchestrator_session_id=s.session_id),
                    s.created_at
             FROM sessions s LEFT JOIN session_projects sp ON sp.session_id=s.session_id
             WHERE s.session_id=?1",
            params![id], |row| Ok((row.get::<_,String>(0)?,row.get::<_,bool>(1)?,
                row.get::<_,Option<String>>(2)?,row.get::<_,bool>(3)?,row.get::<_,bool>(4)?,row.get::<_,String>(5)?)),
        ).optional()?.ok_or(TaskFollowupError::Unavailable)?;
        states.push(state);
    }
    let scope = project_id.or(states[0].2.as_deref());
    if states[1].2.as_deref() != scope {
        return Err(TaskFollowupError::OutsideScope.into());
    }
    if states
        .iter()
        .any(|state| state.0 != "direct" || state.1 || state.3 || state.4)
    {
        return Err(TaskFollowupError::Unavailable.into());
    }
    Ok(TaskFollowupScope {
        caller_project_id: states[0].2.clone(),
        target_project_id: states[1].2.clone(),
        caller_created_at: states[0].5.clone(),
        target_created_at: states[1].5.clone(),
    })
}

#[derive(Serialize, Deserialize)]
pub(super) struct TaskFollowupScope {
    caller_project_id: Option<String>,
    target_project_id: Option<String>,
    caller_created_at: String,
    target_created_at: String,
}

coordinated_command! {
/// Passive inspection/reconciliation, with no lease, recovery or wake.
pub fn load_task_followup_receipt(path: &Path, request: &TaskFollowupRequest) -> Result<Option<TaskFollowupReceipt>> {
    request.validate()?;
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction()?;
    receipt(&tx, request)
}
command LoadTaskFollowupReceiptCommand { request: TaskFollowupRequest = request.clone() }
call |command| (&command.request)
correlation |command| crate::telemetry::Correlation::session(Some(&command.request.target_session_id));
port public;
}

coordinated_command! {
/// Inspect a caller-owned receipt without needing to repeat its original text.
pub fn inspect_task_followup_receipt(path: &Path, caller_session_id: &str, request_id: &str) -> Result<Option<TaskFollowupReceipt>> {
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction()?;
    let json: Option<String> = tx.query_row(
        "SELECT request_json FROM task_followups WHERE caller_session_id=?1 AND request_id=?2",
        params![caller_session_id, request_id], |row| row.get(0),
    ).optional()?;
    json.map(|json| receipt(&tx, &serde_json::from_str(&json)?)).transpose().map(Option::flatten)
}
command InspectTaskFollowupReceiptCommand {
    caller_session_id: String = caller_session_id.to_owned(),
    request_id: String = request_id.to_owned(),
}
call |command| (&command.caller_session_id, &command.request_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.caller_session_id));
port public;
}

coordinated_command! {
/// The caller has passed ordinary agent policy. This transaction supplies no
/// human invocation capability and records no human review intent.
pub fn admit_task_followup(path: &Path, request: &TaskFollowupRequest) -> Result<TaskFollowupReceipt> {
    request.validate()?;
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(found) = receipt(&tx, request)? { return Ok(found); }
    let scope = validate_scope(&tx, &request.caller_session_id,
        &request.target_session_id, request.project_id.as_deref())?;
    let delegation_id = super::task_followup_delegations::require_delegation(&tx, request, &scope)?;
    let active: Option<String> = tx.query_row(
        "SELECT run_id FROM session_run_recovery WHERE session_id=?1 AND status='active'",
        params![request.target_session_id], |row| row.get(0),
    ).optional()?;
    if request.expected_run_id.as_ref().is_some_and(|id| Some(id) != active.as_ref()) {
        return Err(TaskFollowupError::RunConflict.into());
    }
    let delivery = match request.action {
        TaskFollowupAction::Steer => InboxDelivery::Steer,
        TaskFollowupAction::Auto if active.is_some() => InboxDelivery::Steer,
        TaskFollowupAction::Queue | TaskFollowupAction::Auto => InboxDelivery::Queue,
    };
    let admitted_run = if delivery == InboxDelivery::Steer || request.expected_run_id.is_some() { active } else { None };
    let now = now_utc();
    tx.execute(
        "INSERT INTO session_inbox(session_id,delivery,content,target_run_id,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?5)",
        params![request.target_session_id,delivery.as_str(),request.content()?,
            (delivery == InboxDelivery::Steer).then_some(admitted_run.as_deref()).flatten(),now],
    )?;
    let id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO task_followups(caller_session_id,request_id,target_session_id,request_json,
            resolved_delivery,admitted_run_id,inbox_item_id,created_at,delegation_id)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![request.caller_session_id,request.request_id,request.target_session_id,
            serde_json::to_string(request)?,delivery.as_str(),admitted_run,id,now,delegation_id],
    )?;
    #[cfg(test)]
    if ROLLBACK_UNCERTAIN.with(|fault| fault.replace(false)) {
        // Simulate an indeterminate COMMIT report whose transaction rolled back.
        // No later matching receipt may manufacture creator/wake authority.
        return Err(TaskFollowupError::CommitUncertain.into());
    }
    tx.commit().map_err(|error| anyhow::Error::from(error).context(TaskFollowupError::CommitUncertain))?;
    #[cfg(test)]
    if LOSE_ACK.with(|fault| fault.replace(false)) {
        return Err(TaskFollowupError::CommitUncertain.into());
    }
    let mut found = receipt(&conn, request).map_err(|error| error.context(TaskFollowupError::CommitUncertain))?.ok_or(TaskFollowupError::CommitUncertain)?;
    found.replayed = false;
    Ok(found)
}
command AdmitTaskFollowupCommand { request: TaskFollowupRequest = request.clone() }
call |command| (&command.request)
correlation |command| crate::telemetry::Correlation::session(Some(&command.request.target_session_id));
port public;
}

#[cfg(test)]
thread_local! { static LOSE_ACK: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }

#[cfg(test)]
thread_local! { static ROLLBACK_UNCERTAIN: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }

#[cfg(test)]
#[path = "task_followups_tests.rs"]
mod tests;
