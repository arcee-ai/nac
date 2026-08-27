use serde_json::Value;

use crate::tools::{discovery, kernel, shared_workspace_gate, ToolResult, ToolRuntime};
use crate::types::{FunctionDef, ToolDefinition};

pub(crate) struct GrepTool;

impl kernel::NativeTool for GrepTool {
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
        let roots = input
            .get("roots")
            .and_then(Value::as_array)
            .map(|roots| {
                roots
                    .iter()
                    .map(|root| root.as_str().expect("grep roots are decoded"))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_else(|| vec!["."]);
        roots
            .into_iter()
            .map(|root| {
                let root = services
                    .runtime
                    .backend
                    .resolve_path(root)
                    .map_err(|error| invalid(format!("invalid grep path: {error}")))?;
                Ok(crate::permissions::file_resources(
                    "grep",
                    root,
                    services.runtime.backend.as_ref(),
                    &services.runtime.store_path,
                    false,
                ))
            })
            .collect::<Result<Vec<_>, _>>()
            .map(|resources| resources.into_iter().flatten().collect())
    }

    fn bind_authorized_resources(
        &self,
        input: &mut Self::Input,
        resources: &[kernel::PermissionResource],
        _services: kernel::ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        let roots = resources
            .iter()
            .filter(|resource| resource.action == "grep")
            .map(|resource| Value::String(resource.resource.clone()))
            .collect::<Vec<_>>();
        if roots.is_empty() {
            return Err(invalid("authorized grep roots are missing"));
        }
        input
            .as_object_mut()
            .expect("grep input is decoded as an object")
            .insert("roots".to_string(), Value::Array(roots));
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
    let allowed = [
        "pattern",
        "roots",
        "regex",
        "case",
        "globs",
        "context",
        "multiline",
        "gitignore",
        "hidden",
        "limit",
        "cursor",
    ];
    if let Some(key) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(invalid(format!("unknown '{key}' argument")));
    }
    match object.get("pattern") {
        Some(Value::String(value)) if !value.is_empty() && value.len() <= 65_536 => {}
        Some(Value::String(_)) => {
            return Err(invalid(
                "'pattern' argument must contain between 1 and 65536 bytes",
            ))
        }
        _ => return Err(invalid("'pattern' argument must be a string")),
    }
    validate_string_array(object, "roots", 1, 32, 1024)?;
    validate_string_array(object, "globs", 0, 128, 1024)?;
    for key in ["regex", "multiline", "gitignore", "hidden"] {
        if object.get(key).is_some_and(|value| !value.is_boolean()) {
            return Err(invalid(format!("'{key}' argument must be a boolean")));
        }
    }
    validate_optional_u64(object, "context", 0, 100)?;
    validate_optional_u64(object, "limit", 1, 1000)?;
    if let Some(value) = object.get("cursor") {
        if value.as_str().is_none_or(|value| value.len() > 4096) {
            return Err(invalid(
                "'cursor' argument must be a string of at most 4096 bytes",
            ));
        }
    }
    if object
        .get("case")
        .is_some_and(|value| !matches!(value.as_str(), Some("smart" | "sensitive" | "insensitive")))
    {
        return Err(invalid(
            "'case' argument must be smart, sensitive, or insensitive",
        ));
    }
    Ok(())
}

fn validate_string_array(
    object: &serde_json::Map<String, Value>,
    key: &str,
    minimum: usize,
    maximum: usize,
    item_maximum: usize,
) -> Result<(), ToolResult> {
    let Some(value) = object.get(key) else {
        return Ok(());
    };
    let values = value
        .as_array()
        .ok_or_else(|| invalid(format!("'{key}' argument must be an array of strings")))?;
    if values.len() < minimum || values.len() > maximum {
        return Err(invalid(format!(
            "'{key}' must contain between {minimum} and {maximum} strings"
        )));
    }
    if values.iter().any(|value| {
        value
            .as_str()
            .is_none_or(|value| value.len() > item_maximum)
    }) {
        return Err(invalid(format!(
            "'{key}' must contain only strings of at most {item_maximum} bytes"
        )));
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
            name: "grep".to_string(),
            description: "Search workspace file contents with literal or regular-expression matching. Respects .gitignore and excludes hidden paths by default. Returns stable structured matches with bounded cursor pagination. Prefer this over shell content search with grep or rg."
                .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "minLength": 1, "maxLength": 65536, "description": "Literal text or regular expression to find" },
                    "roots": { "type": "array", "items": { "type": "string", "maxLength": 1024 }, "minItems": 1, "maxItems": 32, "description": "Workspace-relative files or directories to search", "default": ["."] },
                    "regex": { "type": "boolean", "description": "Interpret pattern as a regular expression", "default": true },
                    "case": { "type": "string", "enum": ["smart", "sensitive", "insensitive"], "description": "Case matching mode; smart is insensitive only when pattern has no uppercase characters", "default": "smart" },
                    "globs": { "type": "array", "items": { "type": "string", "maxLength": 1024 }, "maxItems": 128, "description": "Optional workspace-relative path glob filters" },
                    "context": { "type": "integer", "minimum": 0, "maximum": 100, "description": "Lines of before and after context", "default": 0 },
                    "multiline": { "type": "boolean", "description": "Allow matches to span lines", "default": false },
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
    discovery::execute("grep", args, runtime).await
}
