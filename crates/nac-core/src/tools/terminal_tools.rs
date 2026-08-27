use serde_json::Value;

use super::{exec_command, kernel, shared_workspace_gate, ToolResult, ToolRuntime};
use crate::types::ToolDefinition;

pub(super) struct ExecCommandTool;
pub(super) struct WriteStdinTool;
pub(super) struct ReadCommandOutputTool;

impl kernel::NativeTool for ExecCommandTool {
    type Input = Value;

    fn definition(&self) -> ToolDefinition {
        exec_command::exec_command_definition()
    }

    fn admission(&self) -> kernel::ToolAdmission {
        kernel::ToolAdmission::Exclusive
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        validate_exec_command(&input)?;
        Ok(input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        services: kernel::ToolServices<'_>,
    ) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
        exec_command_resources(input, services.runtime)
    }

    fn bind_authorized_resources(
        &self,
        input: &mut Self::Input,
        resources: &[kernel::PermissionResource],
        _services: kernel::ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        bind_exec_command_resources(input, resources)
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: kernel::ToolServices<'a>,
        _context: &'a kernel::ToolCallContext,
    ) -> futures_util::future::BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let gate = shared_workspace_gate(services.runtime);
            let _write = gate.write().await;
            exec_command::execute_exec_command(&input, services.runtime).await
        })
    }
}

pub(super) fn bind_exec_command_resources(
    input: &mut Value,
    resources: &[kernel::PermissionResource],
) -> Result<(), ToolResult> {
    let cwd = resources
        .iter()
        .find(|resource| resource.action == "execute_cwd")
        .map(|resource| resource.resource.clone())
        .ok_or_else(|| invalid("authorized command working directory is missing"))?;
    let object = input
        .as_object_mut()
        .expect("exec_command input is decoded as an object");
    let command = object
        .get("cmd")
        .and_then(Value::as_str)
        .expect("exec_command input has a decoded command");
    let command = crate::permissions::bind_authorized_shell_command(
        command,
        std::path::Path::new(&cwd),
        resources,
    )
    .map_err(|error| {
        invalid(format!(
            "authorized command paths could not be bound: {error:#}"
        ))
    })?;
    object.insert("workdir".to_string(), Value::String(cwd));
    object.insert("cmd".to_string(), Value::String(command));
    Ok(())
}

impl kernel::NativeTool for WriteStdinTool {
    type Input = Value;

    fn definition(&self) -> ToolDefinition {
        exec_command::write_stdin_definition()
    }

    fn admission(&self) -> kernel::ToolAdmission {
        kernel::ToolAdmission::Exclusive
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        validate_write_stdin(&input)?;
        Ok(input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        services: kernel::ToolServices<'_>,
    ) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
        write_stdin_resources(input, services.runtime)
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: kernel::ToolServices<'a>,
        _context: &'a kernel::ToolCallContext,
    ) -> futures_util::future::BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let gate = shared_workspace_gate(services.runtime);
            let _write = gate.write().await;
            exec_command::execute_write_stdin(&input, services.runtime).await
        })
    }
}

impl kernel::NativeTool for ReadCommandOutputTool {
    type Input = Value;

    fn definition(&self) -> ToolDefinition {
        exec_command::read_command_output_definition()
    }

    fn admission(&self) -> kernel::ToolAdmission {
        kernel::ToolAdmission::Parallel
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        validate_read_command_output(&input)?;
        Ok(input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: kernel::ToolServices<'_>,
    ) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
        Ok(vec![kernel::PermissionResource::new(
            "command_output",
            required_string(input, "output_id")?,
        )])
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: kernel::ToolServices<'a>,
        _context: &'a kernel::ToolCallContext,
    ) -> futures_util::future::BoxFuture<'a, ToolResult> {
        Box::pin(async move { exec_command::execute_read_command_output(&input, services.runtime) })
    }
}

fn exec_command_resources(
    input: &Value,
    runtime: &ToolRuntime,
) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
    let command = required_string(input, "cmd")?;
    let tty = input.get("tty").and_then(Value::as_bool).unwrap_or(false);
    let requested = input.get("workdir").and_then(Value::as_str);
    let cwd = runtime
        .backend
        .resolve_terminal_cwd(requested)
        .map_err(|error| invalid(format!("invalid command working directory: {error}")))?
        .unwrap_or_else(|| runtime.backend.default_terminal_cwd());
    let mut resources =
        crate::permissions::shell_resources(command, &cwd, runtime.backend.as_ref());
    if tty
        && crate::permissions::unbounded_interactive_input(command)
        && runtime.permission_broker.is_none()
    {
        resources.push(
            kernel::PermissionResource::new("terminal_input", "unbounded-interpreter")
                .with_display(
                    "interactive opaque commands and broad interpreters require direct-session approval",
                )
                .with_hard_denial(
                    "interactive opaque commands and broad interpreters are unavailable to brokerless workers because follow-up input requires direct-session approval",
                ),
        );
    }
    Ok(resources)
}

fn write_stdin_resources(
    input: &Value,
    runtime: &ToolRuntime,
) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
    let session_id = required_string(input, "session_id")?;
    let chars = input.get("chars").and_then(Value::as_str).unwrap_or("");
    let retain = input
        .get("retain")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let resource = if !chars.is_empty() {
        let backend = match runtime.backend.as_ref() {
            crate::sandbox::ExecutionBackend::Local { .. } => "local",
            crate::sandbox::ExecutionBackend::Sandbox(_) => "podman",
            crate::sandbox::ExecutionBackend::Ssh(_) => "ssh",
        };
        let resource = kernel::PermissionResource::new("terminal_input", session_id)
            .with_display(format!(
                "send exact input {} to terminal handle '{session_id}' on the {backend} backend; the running process may interpret these bytes as commands",
                serde_json::to_string(chars)
                    .expect("a Rust string always has a JSON string representation")
            ));
        if runtime.permission_broker.is_none() {
            resource.with_hard_denial(
                "nonempty terminal input is unavailable to brokerless workers because it requires direct-session approval",
            )
        } else {
            resource
        }
    } else if retain {
        kernel::PermissionResource::new("terminal_retain", session_id)
    } else {
        kernel::PermissionResource::new("terminal_observe", session_id)
    };
    Ok(vec![resource])
}

fn validate_exec_command(input: &Value) -> Result<(), ToolResult> {
    let object = object(input)?;
    reject_unknown(
        object,
        &["cmd", "workdir", "tty", "yield_time_ms", "max_output_chars"],
    )?;
    required_string(input, "cmd")?;
    optional_string(object, "workdir")?;
    optional_bool(object, "tty")?;
    optional_u64(object, "yield_time_ms", 0, 3_600_000)?;
    optional_u64(object, "max_output_chars", 0, usize::MAX as u64)
}

fn validate_write_stdin(input: &Value) -> Result<(), ToolResult> {
    let object = object(input)?;
    reject_unknown(
        object,
        &[
            "session_id",
            "chars",
            "retain",
            "yield_time_ms",
            "max_output_chars",
        ],
    )?;
    required_string(input, "session_id")?;
    optional_string(object, "chars")?;
    optional_bool(object, "retain")?;
    if object
        .get("chars")
        .and_then(Value::as_str)
        .is_some_and(|chars| !chars.is_empty())
        && object
            .get("retain")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return Err(invalid(
            "'retain=true' requires empty 'chars'; send input and retain in separate calls",
        ));
    }
    optional_u64(object, "yield_time_ms", 0, 3_600_000)?;
    optional_u64(object, "max_output_chars", 0, usize::MAX as u64)
}

fn validate_read_command_output(input: &Value) -> Result<(), ToolResult> {
    let object = object(input)?;
    reject_unknown(object, &["output_id", "offset", "limit", "stream"])?;
    required_string(input, "output_id")?;
    optional_u64(object, "offset", 0, u64::MAX)?;
    optional_u64(
        object,
        "limit",
        1,
        crate::terminal::MAX_OUTPUT_PAGE_BYTES as u64,
    )?;
    if object
        .get("stream")
        .is_some_and(|stream| !matches!(stream.as_str(), Some("combined" | "stdout" | "stderr")))
    {
        return Err(invalid(
            "'stream' argument must be combined, stdout, or stderr",
        ));
    }
    Ok(())
}

fn invalid(message: impl Into<String>) -> ToolResult {
    ToolResult::text(format!("Error: {}", message.into()), true)
}

fn object(input: &Value) -> Result<&serde_json::Map<String, Value>, ToolResult> {
    input
        .as_object()
        .ok_or_else(|| invalid("tool arguments must be an object"))
}

fn required_string<'a>(input: &'a Value, key: &str) -> Result<&'a str, ToolResult> {
    input
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("'{key}' argument must be a string")))
}

fn reject_unknown(
    object: &serde_json::Map<String, Value>,
    allowed: &[&str],
) -> Result<(), ToolResult> {
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(invalid(format!("unknown '{key}' argument")));
    }
    Ok(())
}

fn optional_string(object: &serde_json::Map<String, Value>, key: &str) -> Result<(), ToolResult> {
    if object.get(key).is_some_and(|value| !value.is_string()) {
        return Err(invalid(format!("'{key}' argument must be a string")));
    }
    Ok(())
}

fn optional_bool(object: &serde_json::Map<String, Value>, key: &str) -> Result<(), ToolResult> {
    if object.get(key).is_some_and(|value| !value.is_boolean()) {
        return Err(invalid(format!("'{key}' argument must be a boolean")));
    }
    Ok(())
}

fn optional_u64(
    object: &serde_json::Map<String, Value>,
    key: &str,
    minimum: u64,
    maximum: u64,
) -> Result<(), ToolResult> {
    if object.get(key).is_some_and(|value| {
        value
            .as_u64()
            .is_none_or(|value| value < minimum || value > maximum)
    }) {
        return Err(invalid(format!(
            "'{key}' argument must be an integer between {minimum} and {maximum}"
        )));
    }
    Ok(())
}
