//! Exact peer goal operations, with separate manual human authority per call.
use super::kernel::{NativeTool, PermissionResource, ToolAdmission, ToolCallContext, ToolServices};
use super::{mutation::argument_error, ToolResult};
use crate::peer_goal_control::{AuthorizedPeerGoal, PeerGoalAction};
use crate::permissions::AuthorizationOutcome;
use crate::types::{FunctionDef, ToolDefinition};
use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Input {
    Read {
        session_id: String,
        project_id: String,
    },
    Start {
        session_id: String,
        project_id: String,
        request_id: String,
        objective: String,
        token_budget: Option<u64>,
    },
    Pause {
        session_id: String,
        project_id: String,
        goal_id: String,
        expected_version: i64,
    },
    Resume {
        session_id: String,
        project_id: String,
        goal_id: String,
        expected_version: i64,
    },
}
impl Input {
    fn scope(&self) -> (&str, &str, &str) {
        match self {
            Self::Read {
                session_id,
                project_id,
            } => ("read", session_id, project_id),
            Self::Start {
                session_id,
                project_id,
                ..
            } => ("start", session_id, project_id),
            Self::Pause {
                session_id,
                project_id,
                ..
            } => ("pause", session_id, project_id),
            Self::Resume {
                session_id,
                project_id,
                ..
            } => ("resume", session_id, project_id),
        }
    }
    fn resources(&self) -> Vec<PermissionResource> {
        let (action, session, project) = self.scope();
        let detail = match self {
            Self::Start {request_id, objective, token_budget, ..} => {
                let budget = token_budget.map_or_else(|| "no token limit requested".to_owned(), |budget| budget.to_string());
                format!("Start finite goal: {objective}\nToken budget: {budget}; request: {request_id}")
            },
            Self::Pause {goal_id, expected_version, ..} => format!("Pause goal {goal_id} at version {expected_version}. The active turn and tools continue; future autonomous continuation stops."),
            Self::Resume {goal_id, expected_version, ..} => format!("Resume goal {goal_id} at version {expected_version} using its remaining budget."),
            Self::Read {..} => "Read current and retained goal identity/evidence without waking the task.".into(),
        };
        let mut resources = vec![
            PermissionResource::new(format!("task_goal_{action}"), format!("session:{session}"))
                .with_display(format!("Task {session} in project {project}: {detail}")),
            PermissionResource::new(format!("task_goal_{action}"), format!("project:{project}")),
        ];
        // Mutations also return goal state; goal authority must not bypass a
        // configured read denial on the same target/project.
        resources.push(PermissionResource::new(
            "task_read",
            format!("session:{session}"),
        ));
        resources.push(PermissionResource::new(
            "task_read",
            format!("project:{project}"),
        ));
        resources
    }
}
fn failure(error: impl Into<anyhow::Error>) -> ToolResult {
    let error = error.into();
    let status = match error.downcast_ref::<crate::peer_goal_control::PeerGoalError>() {
        Some(crate::peer_goal_control::PeerGoalError::Conflict(_)) => "conflict",
        _ => "unavailable",
    };
    ToolResult::text(
        json!({"status":status,"detail":error.to_string()}).to_string(),
        true,
    )
}
pub(crate) struct PeerGoalTool;
impl NativeTool for PeerGoalTool {
    type Input = Input;
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {def_type:"function".into(), function:FunctionDef {
            name:"task_goal".into(),
            description:"Read, start, pause or resume a finite goal on an exact independent plain direct Local task. Each new goal action requires ordinary permission evaluation AND an explicit human reply for this exact action/target/arguments. An exact previously admitted start request replays its immutable receipt under ordinary policy without a fresh mutation or approval. General coordination intent, read access, auto-approval and peer messages grant no goal authority. Start only for explicitly requested finite objective/budget intent; omit token_budget unless supplied. Persist request_id and reuse identical arguments after lost acknowledgement; the immutable receipt describes original admission, never current completion. Pause/resume require current goal_id and expected_version. Pause prevents future continuation without cancelling active tools/turns. Resume preserves remaining budget and cannot restart terminal/exhausted goals. Only the target can mark complete/blocked. No replacement, clear or budget editing. Pass null for arguments that do not apply to this action and for an unrequested token budget.".into(),
            parameters:json!({"type":"object","additionalProperties":false,"properties":{
                "action":{"type":"string","enum":["read","start","pause","resume"]},
                "session_id":{"type":"string","maxLength":160},"project_id":{"type":"string","maxLength":160},
                "request_id":{"type":["string","null"],"maxLength":160,"description":"Required for start; durable caller-scoped idempotency key"},
                "objective":{"type":["string","null"],"maxLength":8000},"token_budget":{"type":["integer","null"],"minimum":1},
                "goal_id":{"type":["string","null"],"maxLength":160},"expected_version":{"type":["integer","null"],"minimum":0}
            },"required":["action","session_id","project_id","request_id","objective","token_budget","goal_id","expected_version"]}),
        }}
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Exclusive
    }
    fn decode(&self, mut value: Value) -> Result<Input, ToolResult> {
        // Strict Responses represents optional/action-inapplicable arguments as
        // null. Preserve omission for ordinary callers, and reject unknown
        // fields even when null. The tagged decoder enforces action requirements.
        if let Some(object) = value.as_object_mut() {
            for key in [
                "request_id",
                "objective",
                "token_budget",
                "goal_id",
                "expected_version",
            ] {
                if object.get(key).is_some_and(Value::is_null) {
                    object.remove(key);
                }
            }
        }
        let input: Input =
            serde_json::from_value(value).map_err(|e| argument_error(e.to_string()))?;
        let (_, target, project) = input.scope();
        let valid_id = |s: &str| !s.trim().is_empty() && s.len() <= 160;
        if !valid_id(target) || !valid_id(project) {
            return Err(argument_error(
                "exact session_id and project_id are required",
            ));
        }
        match &input {
            Input::Start {
                request_id,
                objective,
                token_budget,
                ..
            } if !valid_id(request_id)
                || objective.trim().is_empty()
                || objective.len() > 8000
                || token_budget.is_some_and(|n| n == 0 || n > i64::MAX as u64) =>
            {
                return Err(argument_error("invalid finite goal start arguments"))
            }
            Input::Pause {
                goal_id,
                expected_version,
                ..
            }
            | Input::Resume {
                goal_id,
                expected_version,
                ..
            } if !valid_id(goal_id) || *expected_version < 0 => {
                return Err(argument_error(
                    "exact goal_id and nonnegative expected_version are required",
                ))
            }
            _ => (),
        }
        Ok(input)
    }
    fn permission_resources(
        &self,
        input: &Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        if services.runtime.permission_broker.is_none()
            || services.runtime.session_id.is_none()
            || !matches!(
                services.runtime.backend.as_ref(),
                crate::sandbox::ExecutionBackend::Local { .. }
            )
        {
            return Err(failure(anyhow::anyhow!(
                "peer goals require an attached Local direct primary"
            )));
        }
        Ok(input.resources())
    }
    fn execute<'a>(
        &'a self,
        input: Input,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(broker) = services.runtime.permission_broker.as_ref() else {
                return failure(anyhow::anyhow!("missing ordinary permission broker"));
            };
            if let Err(e) = broker
                .validate_execution_observation_binding(
                    &services.runtime.store_path,
                    services.runtime.session_id.as_deref(),
                    services.runtime.backend.as_ref(),
                )
                .await
            {
                return failure(e);
            }
            // An exact immutable receipt is already an accepted human-authorized
            // start, not fresh mutation authority. Reconcile it after ordinary
            // policy even headlessly; never attach, wake or ask to start again.
            if let Input::Start {
                session_id,
                project_id,
                request_id,
                objective,
                token_budget,
            } = &input
            {
                let request = crate::store::PeerGoalStart {
                    caller_session_id: services.runtime.session_id.clone().unwrap(),
                    request_id: request_id.clone(),
                    target_session_id: session_id.clone(),
                    project_id: project_id.clone(),
                    objective: objective.clone(),
                    token_budget: *token_budget,
                };
                let path = services.runtime.store_path.clone();
                match crate::store::spawn_blocking_store_caller(move || {
                    crate::store::peer_goals::lookup_peer_goal_start(&path, &request)
                })
                .await
                {
                    Ok(Ok(Some(receipt))) => {
                        let mut value = json!({"status":"replayed","receipt":receipt});
                        redact(&mut value);
                        return ToolResult::text(value.to_string(), false);
                    }
                    Ok(Ok(None)) => (),
                    Ok(Err(error)) => return failure(error),
                    Err(error) => return failure(error),
                }
            }
            match context
                .authorize_during_execution(broker.authorize_peer_goal(
                    &input.resources(),
                    context,
                    context.cancellation(services.runtime),
                ))
                .await
            {
                AuthorizationOutcome::Denied(reason) => {
                    return ToolResult::text(
                        json!({"status":"denied","detail":reason}).to_string(),
                        true,
                    )
                }
                AuthorizationOutcome::Allowed => (),
            }
            if let Err(e) = broker
                .validate_execution_observation_binding(
                    &services.runtime.store_path,
                    services.runtime.session_id.as_deref(),
                    services.runtime.backend.as_ref(),
                )
                .await
            {
                return failure(e);
            }
            let (_, target, project) = input.scope();
            let path = services.runtime.store_path.clone();
            let target = target.to_owned();
            let project = project.to_owned();
            let caller = services.runtime.session_id.clone().unwrap();
            // Passive exact revalidation after the approval wait, including caller
            // binding; authenticated-human tool contexts cannot skip the reply.
            let is_read = matches!(&input, Input::Read { .. });
            let check_target = target.clone();
            let check_project = project.clone();
            let checked =
                crate::store::spawn_blocking_store_caller(move || -> anyhow::Result<_> {
                    anyhow::ensure!(
                        crate::store::load_session_project_id(&path, &check_target)?.as_deref()
                            == Some(&check_project),
                        "target is outside the named project"
                    );
                    if is_read {
                        let summary = crate::sessions::load_session_summary(&path, &check_target)?
                            .ok_or_else(|| anyhow::anyhow!("target is unavailable"))?;
                        anyhow::ensure!(
                            !summary.sandboxed && summary.ssh.is_none(),
                            "target requires Local execution"
                        );
                    }
                    match crate::store::load_direct_task(&path, &check_target)? {
                        crate::store::TaskLookup::Found(snapshot)
                            if snapshot.behavior == "direct" =>
                        {
                            Ok(snapshot)
                        }
                        _ => anyhow::bail!(
                            "unavailable: target is not an independent plain direct task"
                        ),
                    }
                })
                .await;
            let snapshot = match checked {
                Ok(Ok(snapshot)) => snapshot,
                Ok(Err(e)) => return failure(e),
                Err(e) => return failure(e),
            };
            if let Input::Read { .. } = input {
                return ToolResult::text(json!({"status":"found","session_id":target,"as_of":crate::store::now_utc(),"goal":snapshot.goal,"goal_objective_truncated":snapshot.goal_objective_truncated,"goal_last_run_id":snapshot.goal_last_run_id,"prior_goals":snapshot.prior_goals,"provenance":"passive durable goal owner; no attachment or wake"}).to_string(), false);
            }
            let action = match input {
                Input::Start {
                    request_id,
                    objective,
                    token_budget,
                    ..
                } => PeerGoalAction::Start {
                    request_id,
                    objective,
                    token_budget,
                },
                Input::Pause {
                    goal_id,
                    expected_version,
                    ..
                } => PeerGoalAction::Pause {
                    goal_id,
                    expected_version,
                },
                Input::Resume {
                    goal_id,
                    expected_version,
                    ..
                } => PeerGoalAction::Resume {
                    goal_id,
                    expected_version,
                },
                Input::Read { .. } => unreachable!(),
            };
            let controller =
                match crate::peer_goal_control::controller_for(&services.runtime.store_path) {
                    Ok(controller) => controller,
                    Err(e) => return failure(e),
                };
            match controller
                .control(AuthorizedPeerGoal {
                    caller,
                    target,
                    project,
                    action,
                })
                .await
            {
                Ok(outcome) => match serde_json::to_value(outcome) {
                    Ok(mut value) => {
                        redact(&mut value);
                        ToolResult::text(value.to_string(), false)
                    }
                    Err(error) => failure(error),
                },
                Err(e) => failure(e),
            }
        })
    }
}

#[cfg(test)]
#[path = "peer_goals_tests.rs"]
mod tests;

fn redact(value: &mut Value) {
    match value {
        Value::String(text) => *text = crate::model::redact_credentials(text, &[]),
        Value::Array(values) => values.iter_mut().for_each(redact),
        Value::Object(values) => {
            values.values_mut().for_each(redact);
            if let Some(Value::String(objective)) = values.get_mut("objective") {
                let boundary = objective
                    .char_indices()
                    .nth(crate::store::GOAL_OBJECTIVE_CHARS)
                    .map(|(index, _)| index);
                if let Some(boundary) = boundary {
                    objective.truncate(boundary);
                }
                values.insert(
                    "objective_truncated".into(),
                    Value::Bool(boundary.is_some()),
                );
            }
        }
        _ => (),
    }
}
