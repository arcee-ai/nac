//! Service-only launch capability. It shares the prepared tool authorization
//! kernel but is deliberately absent from every model-visible tool registry.

use super::kernel::{self, NativeTool};
use super::{ToolResult, ToolRuntime};
use crate::types::{FunctionDef, ToolDefinition};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;

pub(crate) const OPEN_USER_TERMINAL: &str = "open_user_terminal";
const SHELL_COMMAND: &str = "exec bash -i";

pub(crate) struct UserTerminalLaunchTool {
    pub expected_config_version: i64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct LaunchInput {
    terminal_id: String,
    cols: u16,
    rows: u16,
    #[serde(skip)]
    cwd: Option<PathBuf>,
}

impl NativeTool for UserTerminalLaunchTool {
    type Input = LaunchInput;

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            def_type: "function".into(),
            function: FunctionDef {
                name: OPEN_USER_TERMINAL.into(),
                description: "Open a session-owned human shell with ongoing input authority".into(),
                parameters: json!({
                    "type": "object", "additionalProperties": false,
                    "required": ["terminal_id", "cols", "rows"],
                    "properties": {
                        "terminal_id": {"type": "string"},
                        "cols": {"type": "integer", "minimum": 2, "maximum": 500},
                        "rows": {"type": "integer", "minimum": 1, "maximum": 300}
                    }
                }),
            },
        }
    }

    fn admission(&self) -> kernel::ToolAdmission {
        kernel::ToolAdmission::Exclusive
    }

    fn decode(&self, value: Value) -> Result<LaunchInput, ToolResult> {
        let input: LaunchInput =
            serde_json::from_value(value).map_err(|_| error("invalid user terminal launch"))?;
        crate::terminal::validate_user_geometry(input.cols, input.rows)
            .map_err(|_| error("invalid user terminal geometry"))?;
        Ok(input)
    }

    fn permission_resources(
        &self,
        input: &LaunchInput,
        services: kernel::ToolServices<'_>,
    ) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
        let runtime = services.runtime;
        if !runtime
            .terminal_manager
            .owns_user_terminal_name(&input.terminal_id)
        {
            return Err(error("invalid user terminal owner identity"));
        }
        let cwd = runtime.backend.default_terminal_cwd();
        let mut resources =
            crate::permissions::shell_resources(SHELL_COMMAND, &cwd, runtime.backend.as_ref());
        let mut ongoing = kernel::PermissionResource::new("terminal_input", input.terminal_id.clone())
            .with_display("open an interactive bash shell and authorize ongoing human input on the selected Local backend; arbitrary commands can change the same files as the agent");
        if runtime.permission_broker.is_none() {
            ongoing = ongoing
                .with_hard_denial("a human terminal requires a direct-session permission broker");
        }
        if !matches!(
            runtime.backend.as_ref(),
            crate::sandbox::ExecutionBackend::Local { .. }
        ) {
            ongoing = ongoing.with_hard_denial(
                "human terminal support is currently limited to the selected Local backend",
            );
        }
        for resource in &mut resources {
            resource.save_resource = None;
        }
        // No save_resource: opening a shell never remembers broad user authority.
        resources.push(ongoing);
        Ok(resources)
    }

    fn bind_authorized_resources(
        &self,
        input: &mut LaunchInput,
        resources: &[kernel::PermissionResource],
        _services: kernel::ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        input.cwd = Some(PathBuf::from(
            resources
                .iter()
                .find(|resource| resource.action == "execute_cwd")
                .ok_or_else(|| error("authorized terminal working directory is missing"))?
                .resource
                .clone(),
        ));
        Ok(())
    }

    fn execute<'a>(
        &'a self,
        input: LaunchInput,
        services: kernel::ToolServices<'a>,
        context: &'a kernel::ToolCallContext,
    ) -> futures_util::future::BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let runtime: &ToolRuntime = services.runtime;
            let Some(cwd) = input.cwd else {
                return error("terminal launch was not bound by authorization");
            };
            let environment = match runtime.command_environment_snapshot().await {
                Ok(environment) => environment,
                Err(_) => return error("terminal environment snapshot is unavailable"),
            };
            let name = input.terminal_id.clone();
            match runtime
                .terminal_manager
                .create_user_terminal(
                    name.clone(),
                    SHELL_COMMAND,
                    cwd,
                    input.cols,
                    input.rows,
                    &runtime.backend,
                    environment,
                    Some(self.expected_config_version),
                    context.cancellation(runtime),
                )
                .await
            {
                Ok(()) => ToolResult::text(json!({"terminal_id": name}).to_string(), false),
                Err(failure) => error(format!("terminal launch failed: {failure:#}")),
            }
        })
    }
}

fn error(message: impl Into<String>) -> ToolResult {
    ToolResult::text(message.into(), true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn human_launch_is_headless_fail_closed_and_absent_from_model_registry() {
        let model_registry = super::super::worker_tool_registry(true).unwrap();
        assert!(model_registry.snapshot([OPEN_USER_TERMINAL]).is_err());
        let runtime = crate::tools::test_runtime();
        let name = runtime
            .terminal_manager
            .user_terminal_name(uuid::Uuid::new_v4());
        let registry = kernel::ToolRegistry::builder()
            .register(UserTerminalLaunchTool {
                expected_config_version: 0,
            })
            .finish()
            .unwrap();
        let snapshot = registry.snapshot([OPEN_USER_TERMINAL]).unwrap();
        let result = snapshot
            .invoke(
                OPEN_USER_TERMINAL,
                json!({"terminal_id": name, "cols": 80, "rows": 24}),
                kernel::ToolServices {
                    runtime: &runtime,
                    client: &crate::model::ModelClient::new_for_test(),
                },
                &kernel::ToolCallContext::default(),
            )
            .await;
        assert!(result.is_error);
        assert!(result
            .content
            .as_text()
            .unwrap()
            .contains("permission broker"));
        assert!(runtime
            .terminal_manager
            .user_terminal_names()
            .await
            .is_empty());
    }
}
