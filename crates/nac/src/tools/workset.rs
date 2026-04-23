use serde_json::Value;

use crate::store::{self, WorksetDefinition, WorksetItemDefinition};
use crate::tools::{require_str, ToolResult, ToolRuntime};
use crate::types::ToolDefinition;

pub fn define_definition() -> ToolDefinition {
    use serde_json::json;
    def(
        "workset_define",
        "Create or replace a durable coordination workset for this session. Use worksets for multi-step batch, plan, or review efforts, not trivial one-off tasks.",
        json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "Stable workset id." },
                "kind": { "type": "string", "description": "Workset kind such as batch, plan, or review." },
                "instruction": { "type": "string", "description": "Original top-level instruction for the workset." },
                "status": { "type": "string", "description": "Overall workset status." },
                "summary": { "type": "string", "description": "Compact summary of the current plan or state." },
                "verification_recipe": { "type": "string", "description": "Optional end-to-end or verification recipe." },
                "items": {
                    "type": "array",
                    "description": "Ordered work items in this workset.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": { "type": "string" },
                            "thread_name": { "type": "string" },
                            "scope": { "type": "string" },
                            "description": { "type": "string" },
                            "item_kind": { "type": "string" },
                            "status": { "type": "string" },
                            "source_threads": {
                                "type": "array",
                                "items": { "type": "string" }
                            },
                            "last_summary": { "type": "string" }
                        },
                        "required": ["title", "thread_name", "scope", "description", "item_kind", "status"]
                    }
                }
            },
            "required": ["id", "kind", "instruction", "status", "summary", "items"]
        }),
    )
}

pub fn read_definition() -> ToolDefinition {
    use serde_json::json;
    def(
        "workset_read",
        "Read the full structured definition of one workset in the current session.",
        json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "Workset id." }
            },
            "required": ["id"]
        }),
    )
}

pub fn list_definition() -> ToolDefinition {
    use serde_json::json;
    def(
        "workset_list",
        "List persisted worksets in the current session.",
        json!({
            "type": "object",
            "properties": {
                "kind": { "type": "string", "description": "Optional kind filter such as batch, plan, or review." }
            }
        }),
    )
}

pub async fn execute_define(args: Value, runtime: &ToolRuntime) -> ToolResult {
    let session_id = match require_session(runtime) {
        Ok(session_id) => session_id.to_string(),
        Err(error) => return error,
    };
    let id = match require_str(&args, "id") {
        Ok(id) => id,
        Err(error) => return error,
    };
    let kind = match require_str(&args, "kind") {
        Ok(kind) => kind,
        Err(error) => return error,
    };
    let instruction = match require_str(&args, "instruction") {
        Ok(instruction) => instruction,
        Err(error) => return error,
    };
    let status = match require_str(&args, "status") {
        Ok(status) => status,
        Err(error) => return error,
    };
    let summary = match require_str(&args, "summary") {
        Ok(summary) => summary,
        Err(error) => return error,
    };
    let verification_recipe = match optional_string(&args, "verification_recipe") {
        Ok(recipe) => recipe,
        Err(error) => return error,
    };
    let items = match parse_items(args.get("items")) {
        Ok(items) => items,
        Err(error) => return error,
    };

    let definition = WorksetDefinition {
        id: id.clone(),
        kind,
        instruction,
        status,
        summary,
        verification_recipe,
        items,
    };

    match store::define_workset(&runtime.store_path, &session_id, &definition) {
        Ok(()) => ToolResult {
            content: format!(
                "Saved workset '{}' with {} item(s).",
                id,
                definition.items.len()
            ),
            is_error: false,
        },
        Err(error) => ToolResult {
            content: format!("Error saving workset '{}': {}", id, error),
            is_error: true,
        },
    }
}

pub async fn execute_read(args: Value, runtime: &ToolRuntime) -> ToolResult {
    let session_id = match require_session(runtime) {
        Ok(session_id) => session_id.to_string(),
        Err(error) => return error,
    };
    let id = match require_str(&args, "id") {
        Ok(id) => id,
        Err(error) => return error,
    };

    match store::read_workset(&runtime.store_path, &session_id, &id) {
        Ok(Some(workset)) => ToolResult {
            content: store::render_workset_document(&workset),
            is_error: false,
        },
        Ok(None) => ToolResult {
            content: format!("Workset '{}' does not exist in this session.", id),
            is_error: true,
        },
        Err(error) => ToolResult {
            content: format!("Error reading workset '{}': {}", id, error),
            is_error: true,
        },
    }
}

pub async fn execute_list(args: Value, runtime: &ToolRuntime) -> ToolResult {
    let session_id = match require_session(runtime) {
        Ok(session_id) => session_id.to_string(),
        Err(error) => return error,
    };
    let kind = match optional_string(&args, "kind") {
        Ok(kind) => kind,
        Err(error) => return error,
    };

    match store::list_worksets(&runtime.store_path, &session_id, kind.as_deref()) {
        Ok(worksets) => ToolResult {
            content: store::render_workset_list(&worksets),
            is_error: false,
        },
        Err(error) => ToolResult {
            content: format!("Error listing worksets: {}", error),
            is_error: true,
        },
    }
}

fn def(name: &str, description: &str, parameters: serde_json::Value) -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: crate::types::FunctionDef {
            name: name.to_string(),
            description: description.to_string(),
            parameters,
        },
    }
}

fn require_session(runtime: &ToolRuntime) -> Result<&str, ToolResult> {
    runtime.session_id.as_deref().ok_or_else(|| ToolResult {
        content: "Error: workset tools require an active session".to_string(),
        is_error: true,
    })
}

fn optional_string(args: &Value, key: &str) -> Result<Option<String>, ToolResult> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(ToolResult {
            content: format!("Error: '{}' must be a string", key),
            is_error: true,
        }),
    }
}

fn parse_items(value: Option<&Value>) -> Result<Vec<WorksetItemDefinition>, ToolResult> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let Some(items) = value.as_array() else {
        return Err(ToolResult {
            content: "Error: 'items' must be an array".to_string(),
            is_error: true,
        });
    };

    let mut parsed = Vec::with_capacity(items.len());
    for item in items {
        let title = match require_item_str(item, "title") {
            Ok(value) => value,
            Err(error) => return Err(error),
        };
        let thread_name = match require_item_str(item, "thread_name") {
            Ok(value) => value,
            Err(error) => return Err(error),
        };
        let scope = match require_item_str(item, "scope") {
            Ok(value) => value,
            Err(error) => return Err(error),
        };
        let description = match require_item_str(item, "description") {
            Ok(value) => value,
            Err(error) => return Err(error),
        };
        let item_kind = match require_item_str(item, "item_kind") {
            Ok(value) => value,
            Err(error) => return Err(error),
        };
        let status = match require_item_str(item, "status") {
            Ok(value) => value,
            Err(error) => return Err(error),
        };
        let source_threads = match optional_string_array(item, "source_threads") {
            Ok(value) => value,
            Err(error) => return Err(error),
        };
        let last_summary = match optional_string(item, "last_summary") {
            Ok(value) => value,
            Err(error) => return Err(error),
        };
        parsed.push(WorksetItemDefinition {
            title,
            thread_name,
            scope,
            description,
            item_kind,
            status,
            source_threads,
            last_summary,
        });
    }

    Ok(parsed)
}

fn require_item_str(value: &Value, key: &str) -> Result<String, ToolResult> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| ToolResult {
            content: format!("Error: workset item '{}' is required", key),
            is_error: true,
        })
}

fn optional_string_array(value: &Value, key: &str) -> Result<Vec<String>, ToolResult> {
    let Some(value) = value.get(key) else {
        return Ok(Vec::new());
    };
    let Some(items) = value.as_array() else {
        return Err(ToolResult {
            content: format!("Error: '{}' must be an array of strings", key),
            is_error: true,
        });
    };
    let mut parsed = Vec::with_capacity(items.len());
    for item in items {
        let Some(value) = item.as_str() else {
            return Err(ToolResult {
                content: format!("Error: '{}' must be an array of strings", key),
                is_error: true,
            });
        };
        parsed.push(value.to_string());
    }
    Ok(parsed)
}
