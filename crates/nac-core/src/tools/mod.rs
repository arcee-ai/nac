use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex as StdMutex, Weak as StdWeak};
use std::time::Duration;

use serde_json::Value;
use tokio::sync::{Mutex, Notify, RwLock};

use crate::events::EventSink;
use crate::mcp::McpRegistry;
use crate::sandbox::ExecutionBackend;
use crate::skills::SkillRegistry;
use crate::terminal::TerminalManager;
use crate::types::{ToolContent, ToolDefinition};

pub(crate) const REMOTE_FILE_LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(10);
const REMOTE_FILE_LOCK_BUSY_EXIT_CODE: i32 = 75;
const REMOTE_FILE_LOCK_BUSY_MARKER: &str = "NAC_FILE_LOCK_BUSY";

mod discovery;
pub mod edit;
pub mod exec_command;
pub mod glob;
pub(crate) mod goal;
pub mod grep;
pub mod kernel;
mod mcp_adapter;
pub(crate) mod mutation;
pub(crate) mod orchestrator;
pub mod read;
mod runtime_context;
pub(crate) mod session;
pub(crate) mod subagent;
mod terminal_tools;
pub mod thread;
mod thread_lifecycle;
pub(crate) mod web;
pub mod workset;
pub mod write;

use runtime_context::shared_workspace_gate;
pub(crate) use runtime_context::{remote_file_lock_busy, resolve_workspace_path};
pub use runtime_context::{shared_workspace_gate_for, ToolRuntime};
pub use thread_lifecycle::ActiveThreadRegistry;
pub(crate) use thread_lifecycle::ThreadCancellation;

#[derive(Debug)]
pub struct ToolResult {
    pub content: ToolContent,
    pub is_error: bool,
}

impl ToolResult {
    pub fn text(content: impl Into<String>, is_error: bool) -> Self {
        Self {
            content: ToolContent::text(content),
            is_error,
        }
    }
}

struct ReadTool {
    image_read: bool,
}

impl kernel::NativeTool for ReadTool {
    type Input = read::ReadInput;

    fn definition(&self) -> ToolDefinition {
        read::definition(self.image_read)
    }

    fn admission(&self) -> kernel::ToolAdmission {
        kernel::ToolAdmission::Parallel
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        read::decode(input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        services: kernel::ToolServices<'_>,
    ) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
        let path = services
            .runtime
            .backend
            .resolve_path(input.path())
            .map_err(|error| {
                ToolResult::text(format!("Error: invalid read path: {error}"), true)
            })?;
        Ok(crate::permissions::file_resources(
            "read",
            path,
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
        let path = resources
            .iter()
            .find(|resource| resource.action == "read")
            .ok_or_else(|| ToolResult::text("Error: authorized read target is missing", true))?;
        input.bind_authorized_path(&path.resource);
        Ok(())
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: kernel::ToolServices<'a>,
        _context: &'a kernel::ToolCallContext,
    ) -> futures_util::future::BoxFuture<'a, ToolResult> {
        // Provider capabilities shape the registered definition; the captured
        // tool setting remains authoritative for native callers.
        let _provider_supports_images = services.client.supports_image_tool_results();
        Box::pin(async move {
            let gate = shared_workspace_gate(services.runtime);
            let _read = gate.read().await;
            read::execute_native(input, services.runtime, self.image_read).await
        })
    }
}

pub(crate) const WORKER_TOOL_NAMES: [&str; 8] = [
    "read",
    "write",
    "edit",
    "glob",
    "grep",
    "exec_command",
    "write_stdin",
    "read_command_output",
];

pub(crate) const GOAL_TOOL_NAMES: [&str; 3] = ["create_goal", "get_goal", "update_goal"];
pub(crate) const DIRECT_TOOL_NAMES: [&str; 17] = [
    "read",
    "write",
    "edit",
    "glob",
    "grep",
    "exec_command",
    "write_stdin",
    "read_command_output",
    "create_goal",
    "get_goal",
    "update_goal",
    "session_spawn",
    "session_status",
    "session_steer",
    "session_read",
    "session_wait",
    "session_cancel",
];
pub(crate) const ORCHESTRATOR_CONTROL_TOOL_NAMES: [&str; 6] = [
    "session_spawn",
    "session_status",
    "session_steer",
    "session_read",
    "session_wait",
    "session_cancel",
];
pub(crate) const WEB_TOOL_NAMES: [&str; 2] = ["web_search", "web_fetch"];
pub(crate) const SPAWN_TOOL_NAMES: [&str; 6] = [
    "session_spawn",
    "session_status",
    "session_steer",
    "session_read",
    "session_wait",
    "session_cancel",
];
/// Agent tools minus spawn and `create_goal`, used while an assignment is open.
pub(crate) const RUNNING_ASSIGNED_DIRECT_TOOL_NAMES: [&str; 10] = [
    "read",
    "write",
    "edit",
    "glob",
    "grep",
    "exec_command",
    "write_stdin",
    "read_command_output",
    "get_goal",
    "update_goal",
];
/// Compatibility alias: every Agent now has NAC spawn tools.
pub(crate) const DIRECT_WITH_ORCHESTRATOR_TOOL_NAMES: [&str; 17] = DIRECT_TOOL_NAMES;

fn worker_tool_registry(
    image_read: bool,
) -> Result<kernel::ToolRegistry, kernel::ToolRegistryError> {
    let registry = kernel::ToolRegistry::builder()
        .register(ReadTool { image_read })
        .register(write::WriteTool)
        .register(edit::EditTool)
        .register(glob::GlobTool)
        .register(grep::GrepTool)
        .register(terminal_tools::ExecCommandTool)
        .register(terminal_tools::WriteStdinTool)
        .register(terminal_tools::ReadCommandOutputTool)
        .register(goal::CreateGoalTool)
        .register(goal::GetGoalTool)
        .register(goal::UpdateGoalTool)
        .register(subagent::SubagentTool)
        .register(subagent::SubagentStatusTool)
        .register(subagent::SubagentCancelTool)
        .register(orchestrator::LaunchTool)
        .register(orchestrator::StatusTool)
        .register(orchestrator::SteerTool)
        .register(orchestrator::ReadTool)
        .register(orchestrator::WaitTool)
        .register(orchestrator::CancelTool)
        .register(session::SessionSpawnTool)
        .register(session::SessionStatusTool)
        .register(session::SessionSteerTool)
        .register(session::SessionReadTool)
        .register(session::SessionWaitTool)
        .register(session::SessionCancelTool)
        .register(web::WebSearchTool)
        .register(web::WebFetchTool)
        .finish()?;
    // Keep the native instance retrievable; direct Rust callers do not need a
    // JSON round-trip to execute the same registered read operation.
    let _read_handle = registry.native_handle::<ReadTool>()?;
    Ok(registry)
}

#[expect(
    clippy::expect_used,
    reason = "the static first-party tool registry and worker capability list are collision-checked"
)]
pub fn worker_tool_definitions(image_read: bool) -> Vec<ToolDefinition> {
    worker_tool_registry(image_read)
        .expect("built-in direct tool registration must be collision-free")
        .snapshot_where(|descriptor| {
            WORKER_TOOL_NAMES.contains(&descriptor.name())
                && !GOAL_TOOL_NAMES.contains(&descriptor.name())
        })
        .definitions()
}

fn is_running_assigned_direct_capability(name: &str) -> bool {
    DIRECT_TOOL_NAMES.contains(&name) && name != "create_goal" && !SPAWN_TOOL_NAMES.contains(&name)
}

#[expect(
    clippy::expect_used,
    reason = "the static running-assignment capability list is collision-checked"
)]
pub fn running_assigned_direct_tool_definitions(image_read: bool) -> Vec<ToolDefinition> {
    let definitions = worker_tool_registry(image_read)
        .expect("built-in direct tool registration must be collision-free")
        .snapshot_where(|descriptor| is_running_assigned_direct_capability(descriptor.name()))
        .definitions();
    debug_assert_eq!(
        definitions
            .iter()
            .map(|definition| definition.function.name.as_str())
            .collect::<Vec<_>>(),
        RUNNING_ASSIGNED_DIRECT_TOOL_NAMES
    );
    definitions
}

#[expect(
    clippy::expect_used,
    reason = "the static first-party tool registry and direct capability list are collision-checked"
)]
pub fn direct_tool_definitions(image_read: bool) -> Vec<ToolDefinition> {
    let snapshot = worker_tool_registry(image_read)
        .expect("built-in direct tool registration must be collision-free")
        .snapshot(DIRECT_TOOL_NAMES)
        .expect("built-in direct capability selection must be complete");
    debug_assert!(
        ORCHESTRATOR_CONTROL_TOOL_NAMES
            .iter()
            .all(|name| snapshot.contains(name)),
        "every Agent must expose NAC spawn controls"
    );
    snapshot.definitions()
}

#[cfg(test)]
pub(crate) fn direct_tool_definitions_with_web(
    image_read: bool,
    web_enabled: bool,
) -> Vec<ToolDefinition> {
    let mut definitions = direct_tool_definitions(image_read);
    if web_enabled {
        definitions.extend(web::definitions());
    }
    definitions
}

#[expect(
    clippy::expect_used,
    reason = "the static direct-with-orchestrator capability list is covered by registry tests"
)]
pub fn direct_with_orchestrator_tool_definitions(image_read: bool) -> Vec<ToolDefinition> {
    direct_tool_definitions(image_read)
}

#[cfg(test)]
pub(crate) fn direct_with_orchestrator_tool_definitions_with_web(
    image_read: bool,
    web_enabled: bool,
) -> Vec<ToolDefinition> {
    let mut definitions = direct_with_orchestrator_tool_definitions(image_read);
    if web_enabled {
        definitions.extend(web::definitions());
    }
    definitions
}

fn is_complete_direct_capability(name: &str) -> bool {
    DIRECT_WITH_ORCHESTRATOR_TOOL_NAMES.contains(&name) || WEB_TOOL_NAMES.contains(&name)
}

#[expect(
    clippy::expect_used,
    reason = "the static first-party tool registry is collision-checked during construction"
)]
pub(crate) fn direct_tool_admission(name: &str) -> Option<kernel::ToolAdmission> {
    worker_tool_registry(false)
        .expect("built-in direct tool registration must be collision-free")
        .snapshot_where(|descriptor| is_complete_direct_capability(descriptor.name()))
        .admission(name)
}

pub fn orchestrator_tool_definitions(
    skills: Option<&SkillRegistry>,
    light: Option<&crate::model::ModelClient>,
) -> Vec<ToolDefinition> {
    vec![
        thread::dispatch_definition(skills, light),
        thread::threads_definition(),
        thread::thread_read_definition(),
        thread::thread_delete_definition(),
        workset::define_definition(),
        workset::read_definition(),
        workset::list_definition(),
    ]
}

pub fn require_str(args: &Value, key: &str) -> Result<String, ToolResult> {
    args.get(key)
        .and_then(|value| value.as_str())
        .map(std::string::ToString::to_string)
        .ok_or_else(|| ToolResult {
            content: (format!("Error: '{key}' argument required")).into(),
            is_error: true,
        })
}

pub fn require_string_array(args: &Value, key: &str) -> Result<Vec<String>, ToolResult> {
    let Some(value) = args.get(key) else {
        return Ok(Vec::new());
    };

    let Some(items) = value.as_array() else {
        return Err(ToolResult {
            content: (format!("Error: '{key}' must be an array of strings")).into(),
            is_error: true,
        });
    };

    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let Some(value) = item.as_str() else {
            return Err(ToolResult {
                content: (format!("Error: '{key}' must be an array of strings")).into(),
                is_error: true,
            });
        };
        out.push(value.to_string());
    }

    Ok(out)
}

#[cfg(test)]
pub async fn execute_tool(
    name: &str,
    args: Value,
    runtime: &ToolRuntime,
    client: &crate::model::ModelClient,
) -> ToolResult {
    execute_tool_with_context(
        name,
        args,
        runtime,
        client,
        &kernel::ToolCallContext::default(),
    )
    .await
}

#[expect(
    clippy::expect_used,
    reason = "the static first-party tool registry is collision-checked during construction"
)]
pub async fn execute_tool_with_context(
    name: &str,
    args: Value,
    runtime: &ToolRuntime,
    client: &crate::model::ModelClient,
    context: &kernel::ToolCallContext,
) -> ToolResult {
    if !runtime.allows_tool(name) {
        return ToolResult::text(
            format!("Error: unknown tool '{name}' is not available to this agent"),
            true,
        );
    }
    if name.starts_with("mcp__") {
        let Some(registry) = &runtime.mcp else {
            return ToolResult {
                content: (format!("Error: MCP tool '{name}' is not available")).into(),
                is_error: true,
            };
        };
        return mcp_adapter::invoke(
            Arc::clone(registry),
            name,
            args,
            kernel::ToolServices { runtime, client },
            context,
        )
        .await;
    }

    let direct = worker_tool_registry(client.supports_image_tool_results())
        .expect("built-in direct tool registration must be collision-free")
        .snapshot_where(|descriptor| is_complete_direct_capability(descriptor.name()));
    if direct.contains(name) {
        return direct
            .invoke(
                name,
                args,
                kernel::ToolServices { runtime, client },
                context,
            )
            .await;
    }

    match name {
        "thread" => thread::execute_dispatch(args, runtime, client).await,
        "threads" => thread::execute_threads(runtime).await,
        "thread_read" => thread::execute_thread_read(args, runtime).await,
        "thread_delete" => thread::execute_thread_delete(args, runtime).await,
        "workset_define" => workset::execute_define(args, runtime).await,
        "workset_read" => workset::execute_read(args, runtime).await,
        "workset_list" => workset::execute_list(args, runtime).await,
        unknown => ToolResult {
            content: (format!("Error: unknown tool '{unknown}'")).into(),
            is_error: true,
        },
    }
}

#[cfg(test)]
#[path = "../tools_tests.rs"]
mod tests;

// ------------------------------------------------------------------
// Test helpers (shared across agent::dag, agent::tool_exec, tools::thread)
// ------------------------------------------------------------------

/// Create a `ToolRuntime` suitable for unit tests.  Uses the current
/// directory as the workspace, an empty store path, a dummy session id,
/// and no MCP / skills / worker executable.
#[cfg(test)]
pub(crate) fn test_runtime() -> ToolRuntime {
    let workspace_cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let backend = crate::sandbox::execution_backend_from_sandbox(None, &workspace_cwd);
    ToolRuntime {
        command_cancellation: crate::tools::ThreadCancellation::default(),
        config_cwd: workspace_cwd.clone(),
        workspace_cwd,
        store_path: PathBuf::new(),
        session_id: Some("test-session".to_string()),
        worker_executable: None,
        active_threads: Arc::new(crate::tools::ActiveThreadRegistry::default()),
        event_sink: EventSink::none(),
        backend,
        mcp: None,
        skills: None,
        terminal_manager: TerminalManager::new(),
        thread_timeout_secs: thread::DEFAULT_THREAD_TIMEOUT_SECS,
        worker_usage: Arc::new(Mutex::new(crate::model::TokenUsage::default())),
        light_client: None,
        allowed_tools: None,
        permission_broker: None,
        goal_runtime: None,
        command_environment: None,
        web_credential: None,
        command_redactions: Arc::new(StdMutex::new(HashMap::new())),
    }
}
