use serde_json::Value;

use crate::tools::{discovery, kernel, shared_workspace_gate, ToolResult, ToolRuntime};
use crate::types::{FunctionDef, ToolDefinition};

pub(crate) struct GlobTool;

impl kernel::NativeTool for GlobTool {
    type Input = Value;

    fn definition(&self) -> ToolDefinition {
        definition()
    }

    fn admission(&self) -> kernel::ToolAdmission {
        kernel::ToolAdmission::Parallel
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        validate_input(&input)?;
        Ok(input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        services: kernel::ToolServices<'_>,
    ) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
        let root = input.get("root").and_then(Value::as_str).unwrap_or(".");
        let root = services
            .runtime
            .backend
            .resolve_path(root)
            .map_err(|error| invalid(format!("invalid glob path: {error}")))?;
        Ok(crate::permissions::file_resources(
            "glob",
            root,
            services.runtime.backend.as_ref(),
            &services.runtime.store_path,
            false,
        ))
    }

    fn bind_authorized_resources(
        &self,
        input: &mut Self::Input,
        resources: &[kernel::PermissionResource],
        _services: kernel::ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        let root = resources
            .iter()
            .find(|resource| resource.action == "glob")
            .ok_or_else(|| invalid("authorized glob root is missing"))?;
        input
            .as_object_mut()
            .ok_or_else(|| invalid("decoded glob input is not an object"))?
            .insert("root".to_string(), Value::String(root.resource.clone()));
        Ok(())
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: kernel::ToolServices<'a>,
        _context: &'a kernel::ToolCallContext,
    ) -> futures_util::future::BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let gate = shared_workspace_gate(services.runtime);
            let _read = gate.read().await;
            execute(input, services.runtime).await
        })
    }
}

fn invalid(message: impl Into<String>) -> ToolResult {
    ToolResult::text(format!("Error: {}", message.into()), true)
}

fn validate_input(input: &Value) -> Result<(), ToolResult> {
    let object = input
        .as_object()
        .ok_or_else(|| invalid("tool arguments must be an object"))?;
    let allowed = ["pattern", "root", "gitignore", "hidden", "limit", "cursor"];
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(invalid(format!("unknown '{key}' argument")));
    }
    match object.get("pattern") {
        Some(Value::String(value)) if !value.is_empty() && value.len() <= 1024 => {}
        Some(Value::String(_)) => {
            return Err(invalid(
                "'pattern' argument must contain between 1 and 1024 bytes",
            ));
        }
        _ => return Err(invalid("'pattern' argument must be a string")),
    }
    validate_optional_string(object, "root", 1024)?;
    validate_optional_string(object, "cursor", 4096)?;
    validate_optional_bool(object, "gitignore")?;
    validate_optional_bool(object, "hidden")?;
    validate_optional_u64(object, "limit", 1, 1000)?;
    Ok(())
}

fn validate_optional_string(
    object: &serde_json::Map<String, Value>,
    key: &str,
    maximum: usize,
) -> Result<(), ToolResult> {
    match object.get(key) {
        None => Ok(()),
        Some(Value::String(value)) if value.len() <= maximum => Ok(()),
        Some(Value::String(_)) => Err(invalid(format!(
            "'{key}' argument must contain between 0 and {maximum} bytes"
        ))),
        Some(_) => Err(invalid(format!("'{key}' argument must be a string"))),
    }
}

fn validate_optional_bool(
    object: &serde_json::Map<String, Value>,
    key: &str,
) -> Result<(), ToolResult> {
    if object.get(key).is_some_and(|value| !value.is_boolean()) {
        return Err(invalid(format!("'{key}' argument must be a boolean")));
    }
    Ok(())
}

fn validate_optional_u64(
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

pub fn definition() -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: "glob".to_string(),
            description: "Find workspace paths by glob pattern. Respects .gitignore and excludes hidden paths by default. Returns stable structured results with bounded cursor pagination. Prefer this over shell path discovery with find, fd, or ls."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "minLength": 1, "maxLength": 1024, "description": "Glob pattern relative to root, for example crates/**/*.rs" },
                    "root": { "type": "string", "maxLength": 1024, "description": "Workspace-relative directory to search", "default": "." },
                    "gitignore": { "type": "boolean", "description": "Respect workspace .gitignore rules and default generated-directory exclusions", "default": true },
                    "hidden": { "type": "boolean", "description": "Include paths with hidden components", "default": false },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 1000, "description": "Maximum records returned on this page", "default": 200 },
                    "cursor": { "type": "string", "maxLength": 4096, "description": "Opaque continuation cursor returned by an earlier identical request" }
                },
                "required": ["pattern"],
                "additionalProperties": false
            }),
        },
    }
}

pub async fn execute(args: Value, runtime: &ToolRuntime) -> ToolResult {
    discovery::execute("glob", args, runtime).await
}
