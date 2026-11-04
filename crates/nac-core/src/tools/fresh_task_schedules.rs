//! Exact saved-project interval schedules through ordinary prepared policy.
use super::kernel::{NativeTool, PermissionResource, ToolAdmission, ToolCallContext, ToolServices};
use super::{heartbeat, ToolResult};
use crate::{
    store::{self, FreshTaskDestination, HeartbeatAction, HeartbeatOccurrenceState},
    types::ToolDefinition,
};
use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Choices {
    pinned_commit: Option<String>,
    default_ref: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    retained_limit: Option<i64>,
}
impl Choices {
    fn destination(self, project: String) -> FreshTaskDestination {
        FreshTaskDestination {
            project_id: project,
            pinned_commit: self.pinned_commit,
            default_ref: self.default_ref,
            model: self.model,
            reasoning_effort: self.reasoning_effort,
            retained_limit: self.retained_limit.unwrap_or(10),
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireControl {
    request_id: String,
    project_id: Option<String>,
    operation: Value,
    destination: Option<Choices>,
}
pub(crate) struct ControlInput {
    request_id: String,
    project_id: Option<String>,
    operation: HeartbeatAction,
    destination: Option<Choices>,
    authorized_project: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ReadInput {
    project_id: Option<String>,
    schedule_id: Option<String>,
    inventory_offset: Option<usize>,
    #[serde(skip)]
    authorized_project: Option<String>,
}

fn selected(project: Option<&str>, services: ToolServices<'_>) -> Option<String> {
    project
        .or_else(|| {
            services
                .runtime
                .permission_broker
                .as_ref()
                .and_then(|broker| broker.caller_project())
        })
        .filter(|id| !id.is_empty() && id.len() <= 256)
        .map(str::to_owned)
}
fn resources(
    project: Option<&str>,
    services: ToolServices<'_>,
    action: &str,
) -> Vec<PermissionResource> {
    let mut resources = heartbeat::resource(services, action);
    let project = selected(project, services);
    for resource in &mut resources {
        resource.resource = format!("project:{}", project.as_deref().unwrap_or("unbound"));
        resource.display = resource.resource.clone();
        if project.is_none() {
            resource.hard_denial =
                Some("supply an exact saved project or invoke from a chat bound to one".into());
        }
    }
    resources
}
fn bind(resources: &[PermissionResource]) -> Result<String, ToolResult> {
    resources
        .first()
        .and_then(|resource| resource.resource.strip_prefix("project:"))
        .filter(|id| *id != "unbound")
        .map(str::to_owned)
        .ok_or_else(|| heartbeat::error("prepared project binding is unavailable"))
}
async fn caller(
    project: &str,
    explicit: bool,
    services: ToolServices<'_>,
) -> Result<String, ToolResult> {
    let id = heartbeat::session(services).await?;
    if !explicit {
        let expected = project.to_owned();
        let session = id.clone();
        heartbeat::store_call(services, move |path| {
            anyhow::ensure!(
                store::heartbeat_binding(path, &session)?
                    .project_id
                    .as_deref()
                    == Some(expected.as_str()),
                "the invoking chat's exact saved project changed"
            );
            Ok(())
        })
        .await?;
    }
    Ok(id)
}

pub(crate) struct ControlFreshTaskScheduleTool;
impl NativeTool for ControlFreshTaskScheduleTool {
    type Input = ControlInput;
    fn definition(&self) -> ToolDefinition {
        let mut operation = heartbeat::HeartbeatControlTool::native()
            .definition()
            .function
            .parameters["properties"]["operation"]
            .clone();
        operation["properties"]["spec"]["properties"]["goal_id"] = json!({"type":"null"});
        heartbeat::definition("fresh_task_schedule_control","Create or control a standalone interval schedule that launches a fresh retained, visible, goal-free direct task in one exact saved Local project. Only schedule or enlarge authority after an explicit human request. Omit project_id to use this chat's exact bound saved project; this tool does not discover projects. Creation first fires after interval_ms; Run now preserves cadence. Git uses the saved destination default branch, resolved once per occurrence; a full pinned commit wins. Source edits are excluded. Non-Git Local directories are shared, visibly. Reuse request_id for identical retries. Pause withdraws unstarted occurrences; stop cancels only the exact active scheduled initial run; delete preserves active receipts/resources. No automatic cleanup, goals, host/backend fallback or implicit renewal.",json!({"type":"object","additionalProperties":false,"required":["request_id","operation"],"properties":{
            "request_id":{"type":"string"},"project_id":{"type":["string","null"]},"operation":operation,
            "destination":{"type":["object","null"],"additionalProperties":false,"properties":{
                "pinned_commit":{"type":["string","null"],"description":"Complete immutable commit ID; absent selects the saved destination branch."},
                "default_ref":{"type":["string","null"],"description":"Only to establish an unbound Git project's saved default branch."},
                "model":{"type":["string","null"]},"reasoning_effort":{"type":["string","null"]},"retained_limit":{"type":["integer","null"],"minimum":1,"maximum":1000,"default":10}
            }}
        }}))
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Exclusive
    }
    fn decode(&self, value: Value) -> Result<ControlInput, ToolResult> {
        let wire: WireControl = heartbeat::decode(value)?;
        let common = heartbeat::HeartbeatControlTool::native()
            .decode(json!({"request_id":wire.request_id,"operation":wire.operation}))?;
        Ok(ControlInput {
            request_id: common.request_id,
            project_id: wire.project_id,
            operation: common.operation,
            destination: wire.destination,
            authorized_project: None,
        })
    }
    fn permission_resources(
        &self,
        input: &ControlInput,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        let mut projected = resources(input.project_id.as_deref(), services, "heartbeat_manage");
        if services.runtime.heartbeat_human_request.is_none() {
            let target = input
                .operation
                .target()
                .map(|(id, version)| (id.to_owned(), version));
            let own_relinquishing = services.runtime.heartbeat_execution
                && matches!(
                    input.operation,
                    HeartbeatAction::Pause { .. }
                        | HeartbeatAction::Stop { .. }
                        | HeartbeatAction::Delete { .. }
                )
                && target.is_some()
                && target == services.runtime.heartbeat_schedule
                && selected(input.project_id.as_deref(), services).as_deref()
                    == services
                        .runtime
                        .permission_broker
                        .as_ref()
                        .and_then(|broker| broker.caller_project());
            if !own_relinquishing {
                for resource in &mut projected {
                    resource.hard_denial.get_or_insert_with(||"fresh scheduling authority requires a new human request; an automatic turn can only relinquish its exact active schedule".into());
                }
            }
        }
        Ok(projected)
    }
    fn bind_authorized_resources(
        &self,
        input: &mut ControlInput,
        resources: &[PermissionResource],
        _: ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        input.authorized_project = Some(bind(resources)?);
        Ok(())
    }
    fn execute<'a>(
        &'a self,
        input: ControlInput,
        services: ToolServices<'a>,
        _: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(project) = input.authorized_project else {
                return heartbeat::error("fresh schedule project was not prepared");
            };
            let caller = match caller(&project, input.project_id.is_some(), services).await {
                Ok(caller) => caller,
                Err(error) => return error,
            };
            let relinquishing = matches!(
                input.operation,
                HeartbeatAction::Pause { .. }
                    | HeartbeatAction::Stop { .. }
                    | HeartbeatAction::Delete { .. }
            );
            let request = services.runtime.heartbeat_human_request.clone();
            if request.is_none() {
                let Some(run) = services
                    .runtime
                    .active_threads
                    .run_id()
                    .filter(|_| relinquishing && services.runtime.heartbeat_execution)
                else {
                    return heartbeat::error("a new human scheduling request is required; an automatic occurrence can only relinquish its own schedule");
                };
                let id = caller.clone();
                let target = input
                    .operation
                    .target()
                    .map(|(id, version)| (id.to_owned(), version));
                if let Err(error) = heartbeat::store_call(services, move |path| {
                    anyhow::ensure!(
                        store::heartbeat_for_run(path, &id, &run)?
                            .is_some_and(|active| active.state
                                == HeartbeatOccurrenceState::Admitted
                                && target == Some((active.schedule_id, active.schedule_version))),
                        "automatic schedule control cannot target another occurrence/version"
                    );
                    Ok(())
                })
                .await
                {
                    return error;
                }
            }
            let saved =
                request.unwrap_or_else(|| "Relinquish this exact scheduled occurrence.".into());
            let result = heartbeat::store_call(services, move |path| {
                let scope = format!("project:{project}");
                let prior = input
                    .operation
                    .target()
                    .map(|(id, _)| store::read_heartbeat(path, &scope, id))
                    .transpose()?;
                let binding = if relinquishing {
                    prior.context("standalone schedule was not found")?.binding
                } else {
                    let destination = if let Some(choices) = input.destination {
                        choices.destination(project.clone())
                    } else {
                        prior
                            .as_ref()
                            .and_then(|prior| prior.binding.fresh_task.clone())
                            .unwrap_or_else(|| Choices::default().destination(project.clone()))
                    };
                    let target =
                        crate::projects::load_project_launch_context(path, &project)?.project;
                    anyhow::ensure!(
                        target.ssh_host.is_none(),
                        "fresh schedules require a saved Local project"
                    );
                    let cwd = std::fs::canonicalize(target.cwd)?;
                    store::fresh_heartbeat_binding(
                        path,
                        &destination,
                        Some(&caller),
                        cwd.to_str().context("project cwd is not UTF-8")?,
                    )?
                };
                store::control_heartbeat(
                    path,
                    &scope,
                    &input.request_id,
                    &input.operation,
                    &saved,
                    &binding,
                    epoch_ms(),
                )
            })
            .await;
            match result {
                Ok(receipt) => heartbeat::result(receipt),
                Err(error) => error,
            }
        })
    }
}

pub(crate) struct ReadFreshTaskScheduleTool;
impl NativeTool for ReadFreshTaskScheduleTool {
    type Input = ReadInput;
    fn definition(&self) -> ToolDefinition {
        heartbeat::definition("fresh_task_schedule_read","Passively list standalone interval schedules for an exact saved project, or inspect one schedule and its bounded history plus retained resource inventory. Omit project_id to use this chat's bound project. Reads never attach/recover/wake tasks. Inventory pages contain five resources; continue with next_inventory_offset. Initial scheduled results remain separate from later human runs and retained inventory includes deleted tasks/partial preparations.",json!({"type":"object","additionalProperties":false,"properties":{"project_id":{"type":["string","null"]},"schedule_id":{"type":["string","null"]},"inventory_offset":{"type":["integer","null"],"minimum":0,"maximum":10000}}}))
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }
    fn decode(&self, value: Value) -> Result<ReadInput, ToolResult> {
        heartbeat::decode(value)
    }
    fn permission_resources(
        &self,
        input: &ReadInput,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(resources(
            input.project_id.as_deref(),
            services,
            "heartbeat_read",
        ))
    }
    fn bind_authorized_resources(
        &self,
        input: &mut ReadInput,
        resources: &[PermissionResource],
        _: ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        input.authorized_project = Some(bind(resources)?);
        Ok(())
    }
    fn execute<'a>(
        &'a self,
        input: ReadInput,
        services: ToolServices<'a>,
        _: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(project) = input.authorized_project else {
                return heartbeat::error("project read was not prepared");
            };
            if let Err(error) = caller(&project, input.project_id.is_some(), services).await {
                return error;
            }
            let result=heartbeat::store_call(services,move|path| {
                let host_limit=store::fresh_heartbeat_host_retained_limit(path)?;
                let host_allowance=store::fresh_heartbeat_retained_allowance(path)?;
                if let Some(id)=input.schedule_id {
                    let scope=format!("project:{project}");let schedule=store::read_heartbeat(path,&scope,&id)?;
                    let inventory=store::fresh_heartbeat_inventory(path,&project,Some(&id))?;let count=inventory.len();let offset=input.inventory_offset.unwrap_or(0);
                    anyhow::ensure!(offset<=10_000,"inventory offset exceeds the bounded host allowance");
                    let page=inventory.into_iter().skip(offset).take(5).collect::<Vec<_>>();let next=offset.saturating_add(page.len());
                    Ok(json!({"schedule":schedule,"history":store::heartbeat_history(path,&scope,&id)?,"inventory":page,"retained_count":count,"host_retained_limit":host_limit,"host_allowance":host_allowance,"next_inventory_offset":if next<count {Some(next)}else{None}}))
                } else {
                    let schedules=store::list_heartbeats(path,None)?.into_iter().filter(|schedule|schedule.session_id.is_none() && schedule.binding.project_id.as_deref()==Some(project.as_str())).collect::<Vec<_>>();
                    Ok(json!({"schedules":schedules,"host_retained_limit":host_limit,"host_allowance":host_allowance}))
                }
            }).await;
            match result {
                Ok(value) => heartbeat::result(value),
                Err(error) => error,
            }
        })
    }
}
use anyhow::Context;
fn epoch_ms() -> i64 {
    i64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_fresh_control_rejects_forged_authority_and_requires_person_or_exact_relinquish_before_policy(
    ) {
        let tool = ControlFreshTaskScheduleTool;
        for authority in ["human", "origin", "authorized_project", "backend"] {
            let mut input = json!({"request_id":uuid::Uuid::new_v4().to_string(),"operation":{"action":"stop","schedule_id":"schedule","expected_version":2}});
            input[authority] = json!("forged");
            assert!(tool.decode(input).is_err(), "{authority}");
        }
        let mut runtime = super::super::test_runtime();
        runtime.session_id = Some("caller".into());
        let broker = std::sync::Arc::new(crate::permissions::PermissionBroker::new(
            runtime.store_path.clone(),
            "caller".into(),
            crate::permissions::PermissionBackend::Local,
            0,
            Vec::new(),
        ));
        broker.remember_caller_project("project");
        runtime.permission_broker = Some(broker);
        let client = crate::model::ModelClient::new_for_test();
        let input=tool.decode(json!({"request_id":uuid::Uuid::new_v4().to_string(),"operation":{"action":"stop","schedule_id":"schedule","expected_version":2}})).unwrap();
        assert!(tool
            .permission_resources(
                &input,
                ToolServices {
                    runtime: &runtime,
                    client: &client
                }
            )
            .unwrap()[0]
            .hard_denial
            .is_some());
        runtime.heartbeat_execution = true;
        runtime.heartbeat_schedule = Some(("schedule".into(), 2));
        assert!(tool
            .permission_resources(
                &input,
                ToolServices {
                    runtime: &runtime,
                    client: &client
                }
            )
            .unwrap()[0]
            .hard_denial
            .is_none());
        runtime.heartbeat_schedule = Some(("schedule".into(), 3));
        assert!(tool
            .permission_resources(
                &input,
                ToolServices {
                    runtime: &runtime,
                    client: &client
                }
            )
            .unwrap()[0]
            .hard_denial
            .is_some());
    }
}
