//! Current-chat heartbeat operations through the ordinary prepared kernel.
use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::{json, Value};

use super::kernel::{NativeTool, PermissionResource, ToolAdmission, ToolCallContext, ToolServices};
use super::ToolResult;
use crate::store::{self, HeartbeatAction, HeartbeatOccurrenceState, HeartbeatOutcome};
use crate::types::{FunctionDef, ToolDefinition};

mod control_input;

pub(crate) const CONTROL_HEARTBEAT: &str = "heartbeat_control";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ControlInput {
    pub request_id: String,
    pub operation: HeartbeatAction,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct EmptyInput {}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ReadInput {
    schedule_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ReportInput {
    occurrence_id: String,
    generation: String,
    expected_revision: i64,
    outcome: HeartbeatOutcome,
    evidence: String,
}

fn definition(name: &str, description: &str, parameters: Value) -> ToolDefinition {
    ToolDefinition {
        def_type: "function".into(),
        function: FunctionDef {
            name: name.into(),
            description: description.into(),
            parameters,
        },
    }
}
fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, ToolResult> {
    serde_json::from_value(value).map_err(|e| error(format!("invalid heartbeat arguments: {e}")))
}
fn error(message: impl std::fmt::Display) -> ToolResult {
    ToolResult::text(format!("Error: {message}"), true)
}
fn result(value: impl serde::Serialize) -> ToolResult {
    match serde_json::to_string(&value) {
        Ok(value) => ToolResult::text(value, false),
        Err(e) => error(e),
    }
}
async fn store_call<R: Send + 'static>(
    services: ToolServices<'_>,
    operation: impl FnOnce(&std::path::Path) -> anyhow::Result<R> + Send + 'static,
) -> Result<R, ToolResult> {
    let path = services.runtime.store_path.clone();
    store::spawn_blocking_store_caller(move || operation(&path))
        .await
        .map_err(error)?
        .map_err(|e| error(format!("{e:#}")))
}
fn resource(services: ToolServices<'_>, action: &str) -> Vec<PermissionResource> {
    let runtime = services.runtime;
    let mut resource = PermissionResource::new(
        action,
        format!(
            "session:{}",
            runtime.session_id.as_deref().unwrap_or("unpersisted")
        ),
    );
    if runtime.session_id.is_none()
        || runtime.permission_broker.is_none()
        || runtime.command_environment.is_some()
        || !matches!(
            runtime.backend.as_ref(),
            crate::sandbox::ExecutionBackend::Local { .. }
        )
    {
        resource = resource.with_hard_denial(
            "heartbeats require an independent direct chat on the selected ordinary Local backend",
        );
    }
    vec![resource]
}
async fn session(services: ToolServices<'_>) -> Result<String, ToolResult> {
    let runtime = services.runtime;
    let id = runtime
        .session_id
        .clone()
        .ok_or_else(|| error("heartbeat session identity is unavailable"))?;
    let broker = runtime
        .permission_broker
        .as_ref()
        .ok_or_else(|| error("heartbeat policy binding is unavailable"))?;
    // This existing preflight checks canonical store/session/backend/config and
    // child ownership without attachment, recovery, wake or approval changes.
    broker
        .validate_execution_observation_binding(&runtime.store_path, Some(&id), &runtime.backend)
        .await
        .map_err(error)?;
    let checked = id.clone();
    store_call(services, move |path| {
        store::heartbeat_binding(path, &checked)
    })
    .await?;
    Ok(id)
}

pub(crate) struct HeartbeatControlTool {
    human: bool,
}
impl HeartbeatControlTool {
    pub(crate) fn native() -> Self {
        Self { human: false }
    }
    pub(crate) fn submitted(_intent: &crate::session_service::SubmittedHeartbeat) -> Self {
        Self { human: true }
    }
}

impl NativeTool for HeartbeatControlTool {
    type Input = ControlInput;
    fn definition(&self) -> ToolDefinition {
        definition(CONTROL_HEARTBEAT,
            "Create or control a durable interval heartbeat in this exact chat. Create/edit/resume/Run now only when the human explicitly requests scheduling or that change; never infer scheduling from ordinary work. Reuse the exact request_id on a retry. Create first fires after interval_ms; Run now retains the anchor. Read the current version before controls. Pause withdraws unstarted checks; stop also cancels the exact active check; delete reports active work and does not cancel it. Automatic turns cannot create or renew scheduling authority/limits. Ordinary heartbeats create neither goals nor new chats.",
            json!({"type":"object","additionalProperties":false,"required":["request_id","operation"],"properties":{
                "request_id":{"type":"string","description":"A fresh canonical UUID for this intentional operation; retain it for identical retries."},
                "operation":{"type":"object","additionalProperties":false,"required":["action"],"properties":{
                    "action":{"type":"string","enum":["create","edit","pause","resume","stop","delete","run_now"]},
                    "schedule_id":{"type":["string","null"]},"expected_version":{"type":["integer","null"],"minimum":1},
                    "spec":{"type":["object","null"],"additionalProperties":false,"required":["name","instructions","interval_ms","end_condition"],"properties":{
                        "name":{"type":"string","maxLength":120},"instructions":{"type":"string","maxLength":8000},
                        "skills":{"type":"array","maxItems":8,"items":{"type":"string"}},
                        "interval_ms":{"type":"integer","minimum":60000,"maximum":31536000000i64},
                        "end_condition":{"type":"string","maxLength":1000},"goal_id":{"type":["string","null"]},
                        "execution_timeout_ms":{"type":"integer","minimum":1000,"maximum":3600000,"default":300000},
                        "max_occurrences":{"type":"integer","minimum":1,"maximum":100000,"default":1000},
                        "token_allowance":{"type":["integer","null"],"minimum":1}
                    }}
                }}
            }}))
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Exclusive
    }
    fn decode(&self, value: Value) -> Result<Self::Input, ToolResult> {
        control_input::project(value)
    }

    fn permission_resources(
        &self,
        _: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(resource(services, "heartbeat_manage"))
    }
    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let id = match session(services).await {
                Ok(id) => id,
                Err(e) => return e,
            };
            let relinquishing = matches!(
                input.operation,
                HeartbeatAction::Pause { .. }
                    | HeartbeatAction::Stop { .. }
                    | HeartbeatAction::Delete { .. }
            );
            let request = if self.human {
                Some(format!(
                    "Human configured this heartbeat operation: {}",
                    serde_json::to_string(&input.operation).unwrap_or_default()
                ))
            } else {
                services.runtime.heartbeat_human_request.clone()
            };
            if request.is_none() {
                if !relinquishing || !services.runtime.heartbeat_execution {
                    return error("this automatic turn has no new human scheduling request; it can only relinquish its own active heartbeat");
                }
                let Some(run) = services.runtime.active_threads.run_id() else {
                    return error("automatic heartbeat control has no active run binding");
                };
                let target = input
                    .operation
                    .target()
                    .map(|(id, version)| (id.to_owned(), version));
                let session_id = id.clone();
                if let Err(denied)=store_call(services, move |path| {
                    let active=store::heartbeat_for_run(path,&session_id,&run)?;
                    anyhow::ensure!(active.is_some_and(|active|active.state==HeartbeatOccurrenceState::Admitted && target==Some((active.schedule_id,active.schedule_version))),"automatic heartbeat control cannot target another schedule or an edited version");
                    Ok(())
                }).await {return denied;}
            }
            if let HeartbeatAction::Create { spec } | HeartbeatAction::Edit { spec, .. } =
                &input.operation
            {
                for name in &spec.skills {
                    if !services
                        .runtime
                        .skills
                        .as_ref()
                        .is_some_and(|skills| skills.has_skill(name))
                    {
                        return error(format!("requested heartbeat skill '{name}' is unavailable"));
                    }
                }
            }
            let saved = request
                .unwrap_or_else(|| "Relinquish existing heartbeat scheduling authority.".into());
            let execution_cwd = services
                .runtime
                .backend
                .default_terminal_cwd()
                .to_string_lossy()
                .into_owned();
            let expected_version = services
                .runtime
                .permission_broker
                .as_ref()
                .map(|broker| broker.heartbeat_control_config_version())
                .unwrap_or(-1);
            let session_id = id.clone();
            let expected_binding = match store_call(services, move |path| {
                let mut binding = store::heartbeat_binding(path, &session_id)?;
                anyhow::ensure!(
                    binding.config_version == expected_version,
                    "heartbeat control runtime configuration changed"
                );
                binding.execution_cwd = Some(execution_cwd);
                Ok(binding)
            })
            .await
            {
                Ok(binding) => binding,
                Err(error) => return error,
            };
            match store_call(services, move |path| {
                store::control_heartbeat(
                    path,
                    &id,
                    &input.request_id,
                    &input.operation,
                    &saved,
                    &expected_binding,
                    epoch_ms(),
                )
            })
            .await
            {
                Ok(receipt) => result(receipt),
                Err(e) => e,
            }
        })
    }
}

pub(crate) struct ListHeartbeatsTool;
impl NativeTool for ListHeartbeatsTool {
    type Input = EmptyInput;
    fn definition(&self) -> ToolDefinition {
        definition("list_heartbeats","Passively list durable interval heartbeats in this exact chat, including limits, saved purpose and current reasons. This read never wakes a chat or goal.",json!({"type":"object","additionalProperties":false,"properties":{}}))
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }
    fn decode(&self, value: Value) -> Result<Self::Input, ToolResult> {
        decode(value)
    }
    fn permission_resources(
        &self,
        _: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(resource(services, "heartbeat_read"))
    }
    fn execute<'a>(
        &'a self,
        _: Self::Input,
        services: ToolServices<'a>,
        _: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let id = match session(services).await {
                Ok(id) => id,
                Err(e) => return e,
            };
            match store_call(services, move |path| {
                store::list_heartbeats(path, Some(&id))
            })
            .await
            {
                Ok(value) => result(value),
                Err(e) => e,
            }
        })
    }
}

pub(crate) struct ReadHeartbeatTool;
impl NativeTool for ReadHeartbeatTool {
    type Input = ReadInput;
    fn definition(&self) -> ToolDefinition {
        definition("read_heartbeat","Passively read one current-chat heartbeat and bounded occurrence history, with exact run links and uncertain/unknown usage. Read its current revision before control or active result reporting.",json!({"type":"object","additionalProperties":false,"required":["schedule_id"],"properties":{"schedule_id":{"type":"string"}}}))
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }
    fn decode(&self, value: Value) -> Result<Self::Input, ToolResult> {
        decode(value)
    }
    fn permission_resources(
        &self,
        _: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(resource(services, "heartbeat_read"))
    }
    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let id = match session(services).await {
                Ok(id) => id,
                Err(e) => return e,
            };
            match store_call(services,move|path|Ok(json!({"schedule":store::read_heartbeat(path,&id,&input.schedule_id)?,"history":store::heartbeat_history(path,&id,&input.schedule_id)?}))).await {Ok(value)=>result(value),Err(e)=>e}
        })
    }
}

pub(crate) struct ReportHeartbeatTool;
impl NativeTool for ReportHeartbeatTool {
    type Input = ReportInput;
    fn definition(&self) -> ToolDefinition {
        definition("report_heartbeat","Report only this active heartbeat occurrence with evidence. Unchanged retains history without routine attention; meaningful/finished/needs_human_action stays visible. Finished ends only this heartbeat after successful settlement. A report is provisional: final cancellation, failure or denied action overrides it. Read the active occurrence revision first.",json!({"type":"object","additionalProperties":false,"required":["occurrence_id","generation","expected_revision","outcome","evidence"],"properties":{"occurrence_id":{"type":"string"},"generation":{"type":"string"},"expected_revision":{"type":"integer","minimum":1},"outcome":{"type":"string","enum":["unchanged","meaningful","finished","needs_human_action"]},"evidence":{"type":"string","maxLength":2000}}}))
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Exclusive
    }
    fn decode(&self, value: Value) -> Result<Self::Input, ToolResult> {
        decode(value)
    }
    fn permission_resources(
        &self,
        _: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(resource(services, "heartbeat_report"))
    }
    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let id = match session(services).await {
                Ok(id) => id,
                Err(e) => return e,
            };
            let Some(run) = services.runtime.active_threads.run_id() else {
                return error("no active heartbeat run");
            };
            let environment = match services.runtime.command_environment_snapshot().await {
                Ok(environment) => environment,
                Err(error) => {
                    return self::error(format!(
                        "heartbeat evidence redaction is unavailable: {error}"
                    ))
                }
            };
            let evidence =
                crate::model::redact_credentials(&environment.redact(&input.evidence), &[]);
            match store_call(services, move |path| {
                let active = store::heartbeat_for_run(path, &id, &run)?
                    .filter(|o| o.state == HeartbeatOccurrenceState::Admitted)
                    .ok_or_else(|| anyhow::anyhow!("this run is not an active heartbeat"))?;
                anyhow::ensure!(
                    active.occurrence_id == input.occurrence_id,
                    "heartbeat report cannot target another occurrence"
                );
                store::heartbeat_report(
                    path,
                    &id,
                    &input.occurrence_id,
                    &run,
                    &input.generation,
                    input.expected_revision,
                    input.outcome,
                    &evidence,
                )
            })
            .await
            {
                Ok(value) => result(value),
                Err(e) => e,
            }
        })
    }
}

fn epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX)
}

/// Latch before attempting persistence: a transient store failure cannot let
/// an otherwise successful settlement hide a denied unattended operation.
pub(super) async fn record_denial(services: ToolServices<'_>) {
    services
        .runtime
        .heartbeat_needs_human_action
        .store(true, std::sync::atomic::Ordering::Release);
    let (Some(id), Some(run)) = (
        services.runtime.session_id.clone(),
        services.runtime.active_threads.run_id(),
    ) else {
        return;
    };
    let _ = store_call(services, move |path| {
        store::mark_heartbeat_action_denied(path, &id, &run)
    })
    .await;
}
