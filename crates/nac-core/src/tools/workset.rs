use serde_json::Value;

use crate::store::{self, WorksetDefinition, WorksetItemDefinition};
use crate::tools::{require_str, ToolResult, ToolRuntime};
use crate::types::ToolDefinition;

pub fn define_definition() -> ToolDefinition {
    use serde_json::json;
    def(
        "workset_define",
        "Create or replace a durable high-level plan workset for this session.",
        json!({
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "description": "Short stable handle for this workset. This is what the user passes to /run <workset>, so prefer lowercase words separated by hyphens."
                },
                "goal": {
                    "type": "string",
                    "description": "Durable user-facing objective for the whole plan. Capture what should be true when the workset is complete, not the orchestrator's current focus."
                },
                "status": {
                    "type": "string",
                    "description": "Whole-plan state, such as planned, running, blocked, completed, or abandoned."
                },
                "summary": {
                    "type": "string",
                    "description": "Compact synopsis of the plan and its current state. Keep it short enough to scan in the worksets pane."
                },
                "verification_recipe": {
                    "type": "string",
                    "description": "Optional end-to-end validation recipe for the workset, such as tests or manual checks that prove the goal was met."
                },
                "items": {
                    "type": "array",
                    "description": "Ordered high-level plan items. Order should reflect dependencies and the natural execution sequence.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {
                                "type": "string",
                                "description": "Concise label for this item. Make it stable enough to reference from depends_on."
                            },
                            "scope": {
                                "type": "string",
                                "description": "Owned files, modules, product area, or system boundary for this item. Use this to prevent overlapping implementation ownership."
                            },
                            "description": {
                                "type": "string",
                                "description": "Concrete work to do for this item, including important constraints or context."
                            },
                            "role": {
                                "type": "string",
                                "description": "Intended mode for the item, such as research, implementation, verification, cleanup, or coordination."
                            },
                            "depends_on": {
                                "type": "array",
                                "description": "Prerequisite workset item titles or ids that should be satisfied before this item starts. Use an empty array when there are none.",
                                "items": { "type": "string" }
                            },
                            "acceptance": {
                                "type": "string",
                                "description": "Concrete condition that makes this item complete. Prefer observable outcomes over vague intent."
                            },
                            "notes": {
                                "type": "string",
                                "description": "Optional durable context, risks, discoveries, or execution notes for this item."
                            }
                        },
                        "required": ["title", "scope", "description", "role", "depends_on", "acceptance"]
                    }
                }
            },
            "required": ["id", "goal", "status", "summary", "items"]
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
            "properties": {}
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
    let goal = match require_str(&args, "goal") {
        Ok(goal) => goal,
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
        goal,
        status,
        summary,
        verification_recipe,
        items,
    };

    let store_path = runtime.store_path.clone();
    let sid = session_id.clone();
    let items_len = definition.items.len();
    match tokio::task::spawn_blocking(move || store::define_workset(&store_path, &sid, &definition))
        .await
    {
        Ok(Ok(())) => ToolResult {
            content: format!("Saved workset '{}' with {} item(s).", id, items_len),
            is_error: false,
        },
        Ok(Err(error)) => ToolResult {
            content: format!("Error saving workset '{}': {}", id, error),
            is_error: true,
        },
        Err(join_error) => ToolResult {
            content: format!("Internal error saving workset '{}': {}", id, join_error),
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

    let store_path = runtime.store_path.clone();
    let sid = session_id.clone();
    let wid = id.clone();
    match tokio::task::spawn_blocking(move || store::read_workset(&store_path, &sid, &wid)).await {
        Ok(Ok(Some(workset))) => ToolResult {
            content: store::render_workset_document(&workset),
            is_error: false,
        },
        Ok(Ok(None)) => ToolResult {
            content: format!("Workset '{}' does not exist in this session.", id),
            is_error: true,
        },
        Ok(Err(error)) => ToolResult {
            content: format!("Error reading workset '{}': {}", id, error),
            is_error: true,
        },
        Err(join_error) => ToolResult {
            content: format!("Internal error reading workset '{}': {}", id, join_error),
            is_error: true,
        },
    }
}

pub async fn execute_list(_args: Value, runtime: &ToolRuntime) -> ToolResult {
    let session_id = match require_session(runtime) {
        Ok(session_id) => session_id.to_string(),
        Err(error) => return error,
    };

    let store_path = runtime.store_path.clone();
    let sid = session_id.clone();
    match tokio::task::spawn_blocking(move || store::list_worksets(&store_path, &sid)).await {
        Ok(Ok(worksets)) => ToolResult {
            content: store::render_workset_list(&worksets),
            is_error: false,
        },
        Ok(Err(error)) => ToolResult {
            content: format!("Error listing worksets: {}", error),
            is_error: true,
        },
        Err(join_error) => ToolResult {
            content: format!("Internal error listing worksets: {}", join_error),
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
        return Err(ToolResult {
            content: "Error: 'items' is required".to_string(),
            is_error: true,
        });
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
        let scope = match require_item_str(item, "scope") {
            Ok(value) => value,
            Err(error) => return Err(error),
        };
        let description = match require_item_str(item, "description") {
            Ok(value) => value,
            Err(error) => return Err(error),
        };
        let role = match require_item_str(item, "role") {
            Ok(value) => value,
            Err(error) => return Err(error),
        };
        let depends_on = match require_string_array(item, "depends_on") {
            Ok(value) => value,
            Err(error) => return Err(error),
        };
        let acceptance = match require_item_str(item, "acceptance") {
            Ok(value) => value,
            Err(error) => return Err(error),
        };
        let notes = match optional_string(item, "notes") {
            Ok(value) => value,
            Err(error) => return Err(error),
        };
        parsed.push(WorksetItemDefinition {
            title,
            scope,
            description,
            role,
            depends_on,
            acceptance,
            notes,
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

fn require_string_array(value: &Value, key: &str) -> Result<Vec<String>, ToolResult> {
    let Some(value) = value.get(key) else {
        return Err(ToolResult {
            content: format!("Error: '{}' is required", key),
            is_error: true,
        });
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
