//! Native independent-task capabilities. Composition stays behind the inward port.
use super::{
    kernel::{
        NativeTool, PermissionResource, ToolAdmission, ToolCallContext, ToolServices, ToolTimeout,
        ToolTimeoutDisposition,
    },
    ToolResult,
};
use crate::{
    task_launch_control::{self, NativeTaskRequest},
    types::{FunctionDef, ToolDefinition},
};
use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::{json, Value};

pub(crate) struct ListProjectsTool;
pub(crate) struct LaunchTaskTool;
pub(crate) struct TaskLaunchStatusTool;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ProjectsInput {
    query: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct StatusInput {
    request_id: String,
}

fn definition(
    name: &str,
    description: &str,
    properties: Value,
    required: &[&str],
) -> ToolDefinition {
    ToolDefinition {
        def_type: "function".into(),
        function: FunctionDef {
            name: name.into(),
            description: description.into(),
            parameters: json!({"type":"object","properties":properties,"required":required,"additionalProperties":false}),
        },
    }
}
fn error(error: impl std::fmt::Display) -> ToolResult {
    ToolResult::text(format!("Error: {error}"), true)
}
fn result(value: impl serde::Serialize) -> ToolResult {
    match serde_json::to_string(&value) {
        Ok(value) => ToolResult::text(value, false),
        Err(e) => error(e),
    }
}
fn caller(services: ToolServices<'_>) -> Result<&str, ToolResult> {
    if !matches!(
        services.runtime.backend.as_ref(),
        crate::sandbox::ExecutionBackend::Local { .. }
    ) || services.runtime.permission_broker.is_none()
    {
        return Err(error("independent task launch requires a persisted Local direct primary; backend substitution is unavailable"));
    }
    services
        .runtime
        .session_id
        .as_deref()
        .ok_or_else(|| error("independent task launch requires a persisted direct primary"))
}

impl NativeTool for ListProjectsTool {
    type Input = ProjectsInput;
    fn definition(&self) -> ToolDefinition {
        definition("list_projects", "Discover saved project IDs, names, locations, configured defaults and backend eligibility. Optional query filters names/IDs/locations; multiple matches are candidates, never a selected project. Reads saved records only; does not scan or initialize directories. Use a returned project_id for cross-project launch.", json!({"query":{"type":"string","maxLength":256}}), &[])
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }
    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        let input: ProjectsInput = serde_json::from_value(input).map_err(error)?;
        if input
            .query
            .as_ref()
            .is_some_and(|q| q.trim().is_empty() || q.len() > 256)
        {
            return Err(error("query must contain 1 to 256 bytes"));
        }
        Ok(input)
    }
    fn permission_resources(
        &self,
        _: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        caller(services)?;
        Ok(vec![PermissionResource::new(
            "project_read",
            "saved_projects",
        )])
    }
    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let caller = match caller(services) {
                Ok(c) => c,
                Err(e) => return e,
            };
            let controller = match task_launch_control::controller_for(&services.runtime.store_path)
            {
                Ok(c) => c,
                Err(e) => return error(e),
            };
            match controller.projects(caller).await {
                Ok(projects) => {
                    let projects: Vec<_> = projects
                        .into_iter()
                        .filter(|p| {
                            input.query.as_ref().is_none_or(|q| {
                                let q = q.to_lowercase();
                                p.project_id.to_lowercase().contains(&q)
                                    || p.name.to_lowercase().contains(&q)
                                    || p.cwd.to_string_lossy().to_lowercase().contains(&q)
                            })
                        })
                        .collect();
                    result(
                        json!({"status":"ok","ambiguous":projects.len()>1,"candidates":projects}),
                    )
                }
                Err(e) => error(e),
            }
        })
    }
}

impl NativeTool for LaunchTaskTool {
    type Input = NativeTaskRequest;
    fn definition(&self) -> ToolDefinition {
        definition("launch_task", "Launch one independent visible goal-free direct task with fresh context. Use only when the human requested a separate task. Supply a fresh canonical UUID request_id for each intentional task; retry the exact same arguments/key after response loss. Changed arguments with a reused key conflict. Explicit project_id wins; omission uses this chat's saved project, never a guessed directory. Git auto defaults to a fresh retained worktree: same-project committed caller HEAD, cross-project configured default branch. Source edits are excluded. Existing_checkout must be explicit. Non-Git auto uses its saved local directory. Destination model/reasoning defaults apply unless supplied. Include all handoff facts in prompt and the requested skill in skill. No transcript cloning, automatic goal or peer steering. Preparation continues after receipt; read task_launch_status passively.", json!({
            "request_id":{"type":"string","description":"Fresh canonical UUID per intentional request; stable across exact retries"},
            "project_id":{"type":["string","null"]}, "title":{"type":"string"}, "prompt":{"type":"string","maxLength":131072},
            "skill":{"type":["string","null"]}, "model":{"type":["string","null"]}, "reasoning_effort":{"type":["string","null"]},
            "workspace":{"type":"string","enum":["auto","clean_ref","existing_checkout"],"default":"auto"},
            "git_ref":{"type":["string","null"]}, "default_ref":{"type":["string","null"],"description":"Destination's configured default branch when first binding a Git project"}
        }), &["request_id","title","prompt"])
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }
    fn timeout(
        &self,
        _: &mut Value,
        requested: Option<std::time::Duration>,
    ) -> Result<ToolTimeout, ToolResult> {
        Ok(ToolTimeout {
            duration: requested.unwrap_or(super::kernel::DEFAULT_TOOL_TIMEOUT),
            disposition: ToolTimeoutDisposition::Settle,
            remote_outcome_uncertain: false,
        })
    }
    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        let input: NativeTaskRequest = serde_json::from_value(input).map_err(error)?;
        input.validate().map_err(error)?;
        Ok(input)
    }
    fn permission_resources(
        &self,
        input: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        caller(services)?;
        // Concrete destination and path are authorized after read-only resolution below.
        Ok(vec![PermissionResource::new(
            "task_launch",
            format!(
                "project:{}",
                input.project_id.as_deref().unwrap_or("current")
            ),
        )])
    }
    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let caller = match caller(services) {
                Ok(c) => c,
                Err(e) => return e,
            };
            let controller = match task_launch_control::controller_for(&services.runtime.store_path)
            {
                Ok(c) => c,
                Err(e) => return error(e),
            };
            let target = match controller.resolve(caller, &input).await {
                Ok(t) => t,
                Err(e) => return error(e),
            };
            let mut resources = crate::permissions::file_resources(
                "task_launch_path",
                target.cwd.clone(),
                services.runtime.backend.as_ref(),
                &services.runtime.store_path,
                false,
            );
            resources.push(PermissionResource::new(
                "task_launch",
                format!("project:{}", target.project_id),
            ));
            let Some(broker) = services.runtime.permission_broker.as_ref() else {
                return error("agent authorization is unavailable");
            };
            match context
                .authorize_during_execution(broker.authorize(
                    "launch_task",
                    &resources,
                    context,
                    context.cancellation(services.runtime),
                ))
                .await
            {
                crate::permissions::AuthorizationOutcome::Denied(reason) => {
                    return error(format!("permission denied for launch_task: {reason}"))
                }
                crate::permissions::AuthorizationOutcome::Allowed => {}
            }
            if context.cancellation(services.runtime).is_cancelled() {
                return error("task launch cancelled before admission");
            }
            match controller
                .launch(
                    caller,
                    input,
                    target,
                    task_launch_control::NativeTaskAuthorization::new(services.runtime, context),
                )
                .await
            {
                Ok(receipt) => {
                    let failed = matches!(receipt.launch.phase.as_str(), "failed" | "cancelled")
                        || receipt.launch.error.is_some();
                    let mut output = result(receipt);
                    output.is_error |= failed;
                    output
                }
                Err(e) => error(e),
            }
        })
    }
}

impl NativeTool for TaskLaunchStatusTool {
    type Input = StatusInput;
    fn definition(&self) -> ToolDefinition {
        definition("task_launch_status", "Passively read this chat's launch request receipt, exact /session route, preparation failure/cancellation and committed task/run state. Does not attach, wake, recover, answer approvals or control the target. Live approvals are unknown; open the task to see them.",json!({"request_id":{"type":"string"}}), &["request_id"])
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }
    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        let input: StatusInput = serde_json::from_value(input).map_err(error)?;
        if uuid::Uuid::parse_str(&input.request_id).is_err() {
            return Err(error("request_id must be a UUID"));
        }
        Ok(input)
    }
    fn permission_resources(
        &self,
        input: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        caller(services)?;
        Ok(vec![PermissionResource::new(
            "task_read",
            format!("launch:{}", input.request_id),
        )])
    }
    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let caller = match caller(services) {
                Ok(c) => c,
                Err(e) => return e,
            };
            let controller = match task_launch_control::controller_for(&services.runtime.store_path)
            {
                Ok(c) => c,
                Err(e) => return error(e),
            };
            match controller.status(caller, &input.request_id).await {
                Ok(receipt) => {
                    let Some(broker) = services.runtime.permission_broker.as_ref() else {
                        return error("agent authorization unavailable");
                    };
                    let resources = [
                        PermissionResource::new(
                            "task_read",
                            format!("project:{}", receipt.launch.project_id),
                        ),
                        PermissionResource::new(
                            "task_read",
                            format!("session:{}", receipt.launch.session_id),
                        ),
                    ];
                    match context
                        .authorize_during_execution(broker.authorize(
                            "task_launch_status",
                            &resources,
                            context,
                            context.cancellation(services.runtime),
                        ))
                        .await
                    {
                        crate::permissions::AuthorizationOutcome::Allowed => result(receipt),
                        crate::permissions::AuthorizationOutcome::Denied(reason) => error(format!(
                            "permission denied for task_launch_status: {reason}"
                        )),
                    }
                }
                Err(e) => error(e),
            }
        })
    }
}

#[cfg(test)]
#[path = "task_launch_tests.rs"]
mod tests;
