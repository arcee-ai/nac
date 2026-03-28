use serde_json::Value;
use tokio::sync::Mutex;

use crate::types::ToolDefinition;

pub mod bash;
pub mod edit;
pub mod read;
pub mod write;

pub struct ToolResult {
    pub content: String,
    pub is_error: bool,
}

static WRITE_LOCK: Mutex<()> = Mutex::const_new(());

pub async fn acquire_write_lock() -> tokio::sync::MutexGuard<'static, ()> {
    WRITE_LOCK.lock().await
}

pub fn tool_definitions() -> Vec<ToolDefinition> {
    use serde_json::json;

    vec![
        def(
            "read",
            "Read file contents with line numbers. Supports offset and limit.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to file" },
                    "offset": { "type": "integer", "description": "Line number to start from (0-indexed, optional)" },
                    "limit": { "type": "integer", "description": "Max lines to read (optional, default 2000)" }
                },
                "required": ["path"]
            }),
        ),
        def(
            "write",
            "Write content to a file. Creates parent directories automatically.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to file" },
                    "content": { "type": "string", "description": "Content to write" }
                },
                "required": ["path", "content"]
            }),
        ),
        def(
            "edit",
            "Replace exact text in a file.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to file" },
                    "old_text": { "type": "string", "description": "Text to find and replace" },
                    "new_text": { "type": "string", "description": "Replacement text" }
                },
                "required": ["path", "old_text", "new_text"]
            }),
        ),
        def(
            "bash",
            "Execute a shell command and return output.",
            json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Shell command to execute" },
                    "timeout": { "type": "integer", "description": "Timeout in seconds (default 120)" }
                },
                "required": ["command"]
            }),
        ),
    ]
}

fn def(name: &str, description: &str, parameters: Value) -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: crate::types::FunctionDef {
            name: name.to_string(),
            description: description.to_string(),
            parameters,
        },
    }
}

pub fn require_str(args: &Value, key: &str) -> Result<String, ToolResult> {
    args.get(key)
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .ok_or_else(|| ToolResult {
            content: format!("Error: '{}' argument required", key),
            is_error: true,
        })
}

pub async fn execute_tool(name: &str, args: Value) -> ToolResult {
    match name {
        "read" => read::execute(args).await,
        "write" => write::execute(args).await,
        "edit" => edit::execute(args).await,
        "bash" => bash::execute(args).await,
        unknown => ToolResult {
            content: format!(
                "Error: unknown tool '{}'. Available tools: read, write, edit, bash",
                unknown
            ),
            is_error: true,
        },
    }
}
