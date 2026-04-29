use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;
use tokio::sync::Mutex;

use crate::events::EventSink;
use crate::mcp::McpRegistry;
use crate::sandbox::SandboxSession;
use crate::skills::SkillRegistry;
use crate::terminal::TerminalManager;
use crate::types::ToolDefinition;

pub mod edit;
pub mod exec_command;
pub mod read;
pub mod thread;
pub mod workset;
pub mod write;

pub struct ToolResult {
    pub content: String,
    pub is_error: bool,
}

#[derive(Clone)]
pub struct ToolRuntime {
    pub store_path: PathBuf,
    pub session_id: Option<String>,
    pub active_threads: Arc<Mutex<HashSet<String>>>,
    pub event_sink: EventSink,
    pub sandbox: Option<SandboxSession>,
    pub mcp: Option<Arc<McpRegistry>>,
    pub skills: Option<Arc<SkillRegistry>>,
    pub activated_skills: Arc<Mutex<HashSet<String>>>,
    pub terminal_manager: TerminalManager,
}

static WRITE_LOCK: Mutex<()> = Mutex::const_new(());

pub async fn acquire_write_lock() -> tokio::sync::MutexGuard<'static, ()> {
    WRITE_LOCK.lock().await
}

pub fn worker_tool_definitions() -> Vec<ToolDefinition> {
    use serde_json::json;

    let mut tools = vec![
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
    ];

    tools.push(exec_command::exec_command_definition());
    tools.push(exec_command::write_stdin_definition());

    tools
}

pub fn orchestrator_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        thread::dispatch_definition(),
        thread::threads_definition(),
        thread::thread_read_definition(),
        thread::thread_delete_definition(),
        workset::define_definition(),
        workset::read_definition(),
        workset::list_definition(),
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

pub fn require_string_array(args: &Value, key: &str) -> Result<Vec<String>, ToolResult> {
    let Some(value) = args.get(key) else {
        return Ok(Vec::new());
    };

    let Some(items) = value.as_array() else {
        return Err(ToolResult {
            content: format!("Error: '{}' must be an array of strings", key),
            is_error: true,
        });
    };

    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let Some(value) = item.as_str() else {
            return Err(ToolResult {
                content: format!("Error: '{}' must be an array of strings", key),
                is_error: true,
            });
        };
        out.push(value.to_string());
    }

    Ok(out)
}

pub async fn execute_tool(
    name: &str,
    args: Value,
    runtime: &ToolRuntime,
    client: &crate::api::ModelClient,
) -> ToolResult {
    if name.starts_with("mcp__") {
        let Some(registry) = &runtime.mcp else {
            return ToolResult {
                content: format!("Error: MCP tool '{}' is not available", name),
                is_error: true,
            };
        };
        return registry.call_tool(name, args).await;
    }

    match name {
        "activate_skill" => crate::skills::execute_activate_skill(args, runtime).await,
        "read" => read::execute(args, runtime).await,
        "write" => write::execute(args, runtime).await,
        "edit" => edit::execute(args, runtime).await,
        "exec_command" => {
            match exec_command::execute_exec_command(&args, runtime).await {
                Ok(content) => ToolResult { content, is_error: false },
                Err(e) => ToolResult { content: format!("Error: {:#}", e), is_error: true },
            }
        }
        "write_stdin" => {
            match exec_command::execute_write_stdin(&args, runtime).await {
                Ok(content) => ToolResult { content, is_error: false },
                Err(e) => ToolResult { content: format!("Error: {:#}", e), is_error: true },
            }
        }
        "thread" => thread::execute_dispatch(args, runtime, client).await,
        "threads" => thread::execute_threads(runtime).await,
        "thread_read" => thread::execute_thread_read(args, runtime).await,
        "thread_delete" => thread::execute_thread_delete(args, runtime).await,
        "workset_define" => workset::execute_define(args, runtime).await,
        "workset_read" => workset::execute_read(args, runtime).await,
        "workset_list" => workset::execute_list(args, runtime).await,
        unknown => ToolResult {
            content: format!("Error: unknown tool '{}'", unknown),
            is_error: true,
        },
    }
}
