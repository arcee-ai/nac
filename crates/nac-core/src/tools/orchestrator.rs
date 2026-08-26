use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::json;

use crate::orchestration_control::{ManagedOrchestratorReadKind, ManagedOrchestratorStartRequest};
use crate::store::{
    ManagedOrchestratorExecutionMode, ManagedOrchestratorRecord, ManagedOrchestratorStatus,
};
use crate::types::{FunctionDef, ToolDefinition};

use super::kernel::{NativeTool, PermissionResource, ToolAdmission, ToolCallContext, ToolServices};
use super::ToolResult;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LaunchInput {
    description: String,
    prompt: String,
    #[serde(default)]
    orchestrator_session_id: Option<String>,
    #[serde(default)]
    background: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionInput {
    orchestrator_session_id: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SteerInput {
    orchestrator_session_id: String,
    instruction: String,
    #[serde(default)]
    thread_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadInput {
    orchestrator_session_id: String,
    kind: String,
    #[serde(default = "default_limit")]
    limit: usize,
}

fn default_limit() -> usize {
    24
}

pub struct LaunchTool;
pub struct StatusTool;
pub struct SteerTool;
pub struct ReadTool;
pub struct WaitTool;
pub struct CancelTool;

fn definition(
    name: &str,
    description: &str,
    properties: serde_json::Value,
    required: &[&str],
) -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: name.to_string(),
            description: description.to_string(),
            parameters: json!({
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": false
            }),
        },
    }
}

fn decode<T: serde::de::DeserializeOwned>(
    name: &str,
    input: serde_json::Value,
) -> Result<T, ToolResult> {
    serde_json::from_value(input)
        .map_err(|error| ToolResult::text(format!("Error: invalid {name} input: {error}"), true))
}

fn controller(
    services: ToolServices<'_>,
) -> Result<
    (
        String,
        std::sync::Arc<dyn crate::orchestration_control::OrchestrationController>,
    ),
    ToolResult,
> {
    let parent = services.runtime.session_id.clone().ok_or_else(|| {
        ToolResult::text(
            "Error: orchestrator control requires a persistent session",
            true,
        )
    })?;
    let controller = crate::orchestration_control::controller_for(&services.runtime.store_path)
        .map_err(|error| ToolResult::text(format!("Error: {error:#}"), true))?;
    Ok((parent, controller))
}

fn record_result(record: ManagedOrchestratorRecord) -> ToolResult {
    let is_error = matches!(
        record.status,
        ManagedOrchestratorStatus::Failed
            | ManagedOrchestratorStatus::Cancelled
            | ManagedOrchestratorStatus::Interrupted
    );
    ToolResult::text(
        serde_json::to_string(&record).expect("managed orchestrator outcome serializes"),
        is_error,
    )
}

impl NativeTool for LaunchTool {
    type Input = LaunchInput;

    fn definition(&self) -> ToolDefinition {
        definition(
            "orchestrator_launch",
            "Launch or continue a separate durable NAC orchestrator session. Foreground waits for its final report; background returns immediately and delivers completion automatically. Use the returned orchestrator_session_id to steer, inspect, wait, cancel, or continue it.",
            json!({
                "description": {"type":"string","minLength":1,"maxLength":120},
                "prompt": {"type":"string","minLength":1},
                "orchestrator_session_id": {"type":"string","minLength":1},
                "background": {"type":"boolean","default":false}
            }),
            &["description", "prompt"],
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn decode(&self, input: serde_json::Value) -> Result<Self::Input, ToolResult> {
        decode("orchestrator_launch", input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(vec![PermissionResource::new(
            "orchestrator_launch",
            input.orchestrator_session_id.as_deref().unwrap_or("new"),
        )])
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let (parent, controller) = match controller(services) {
                Ok(value) => value,
                Err(error) => return error,
            };
            let background = input.background;
            let started = match controller
                .start(ManagedOrchestratorStartRequest {
                    parent_session_id: parent.clone(),
                    orchestrator_session_id: input.orchestrator_session_id,
                    description: input.description,
                    prompt: input.prompt,
                    execution_mode: if background {
                        ManagedOrchestratorExecutionMode::Background
                    } else {
                        ManagedOrchestratorExecutionMode::Foreground
                    },
                })
                .await
            {
                Ok(record) => record,
                Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
            };
            if background {
                return ToolResult::text(
                    json!({
                        "orchestrator_session_id": started.orchestrator_session_id,
                        "generation": started.generation,
                        "status": "running",
                        "message": "The orchestrator is running in the background. Completion will be delivered automatically; do not poll or duplicate its work."
                    })
                    .to_string(),
                    false,
                );
            }
            let session_id = started.orchestrator_session_id.clone();
            let outcome = tokio::select! {
                outcome = controller.wait(&session_id, started.generation) => outcome,
                _ = services.runtime.command_cancellation.cancelled() => {
                    let cancel_controller = controller.clone();
                    let cancel_parent = parent.clone();
                    let cancel_session = session_id.clone();
                    let cancellation = tokio::spawn(async move {
                        cancel_controller.cancel(&cancel_parent, &cancel_session).await
                    });
                    match cancellation.await {
                        Ok(Ok(cancelled)) => Ok(cancelled),
                        Ok(Err(error)) => Err(error.context(
                            "parent cancellation could not cancel foreground orchestrator",
                        )),
                        Err(error) => Err(anyhow::anyhow!(
                            "foreground orchestrator cancellation task failed: {error}"
                        )),
                    }
                }
            };
            match outcome {
                Ok(record) => record_result(record),
                Err(error) => ToolResult::text(
                    format!(
                        "Error: foreground orchestrator failed (orchestrator_session_id: {session_id}): {error:#}"
                    ),
                    true,
                ),
            }
        })
    }
}

impl NativeTool for StatusTool {
    type Input = SessionInput;

    fn definition(&self) -> ToolDefinition {
        definition(
            "orchestrator_status",
            "Read durable status and the latest outcome for one orchestrator owned by this session.",
            json!({"orchestrator_session_id":{"type":"string","minLength":1}}),
            &["orchestrator_session_id"],
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }
    fn decode(&self, input: serde_json::Value) -> Result<Self::Input, ToolResult> {
        decode("orchestrator_status", input)
    }
    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(vec![PermissionResource::new(
            "orchestrator_read",
            &input.orchestrator_session_id,
        )])
    }
    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(parent) = services.runtime.session_id.as_deref() else {
                return ToolResult::text("Error: persistent session required", true);
            };
            match owned(services.runtime, parent, &input.orchestrator_session_id) {
                Ok(record) => record_result(record),
                Err(error) => ToolResult::text(format!("Error: {error:#}"), true),
            }
        })
    }
}

impl NativeTool for SteerTool {
    type Input = SteerInput;
    fn definition(&self) -> ToolDefinition {
        definition(
            "orchestrator_steer",
            "Steer a running managed orchestrator or one of its worker threads.",
            json!({
                "orchestrator_session_id":{"type":"string","minLength":1},
                "instruction":{"type":"string","minLength":1},
                "thread_name":{"type":"string","minLength":1}
            }),
            &["orchestrator_session_id", "instruction"],
        )
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }
    fn decode(&self, input: serde_json::Value) -> Result<Self::Input, ToolResult> {
        decode("orchestrator_steer", input)
    }
    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(vec![PermissionResource::new(
            "orchestrator_steer",
            &input.orchestrator_session_id,
        )])
    }
    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let (parent, controller) = match controller(services) {
                Ok(value) => value,
                Err(error) => return error,
            };
            match controller
                .steer(
                    &parent,
                    &input.orchestrator_session_id,
                    &input.instruction,
                    input.thread_name.as_deref(),
                )
                .await
            {
                Ok(record) => record_result(record),
                Err(error) => ToolResult::text(format!("Error: {error:#}"), true),
            }
        })
    }
}

impl NativeTool for ReadTool {
    type Input = ReadInput;
    fn definition(&self) -> ToolDefinition {
        definition("orchestrator_read", "Read transcript messages, retained worker episodes, or recent worker events from a managed orchestrator.", json!({
            "orchestrator_session_id":{"type":"string","minLength":1},
            "kind":{"type":"string","enum":["messages","episodes","events"]},
            "limit":{"type":"integer","minimum":1,"maximum":200,"default":24}
        }), &["orchestrator_session_id", "kind"])
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }
    fn decode(&self, input: serde_json::Value) -> Result<Self::Input, ToolResult> {
        decode("orchestrator_read", input)
    }
    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(vec![PermissionResource::new(
            "orchestrator_read",
            &input.orchestrator_session_id,
        )])
    }
    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let kind = match input.kind.as_str() {
                "messages" => ManagedOrchestratorReadKind::Messages,
                "episodes" => ManagedOrchestratorReadKind::Episodes,
                "events" => ManagedOrchestratorReadKind::Events,
                _ => {
                    return ToolResult::text(
                        "Error: kind must be messages, episodes, or events",
                        true,
                    )
                }
            };
            if !(1..=200).contains(&input.limit) {
                return ToolResult::text("Error: limit must be 1-200", true);
            }
            let (parent, controller) = match controller(services) {
                Ok(value) => value,
                Err(error) => return error,
            };
            match controller
                .read(&parent, &input.orchestrator_session_id, kind, input.limit)
                .await
            {
                Ok(value) => ToolResult::text(value.to_string(), false),
                Err(error) => ToolResult::text(format!("Error: {error:#}"), true),
            }
        })
    }
}

macro_rules! session_control_tool {
    ($tool:ty, $name:literal, $description:literal, $action:literal, $body:expr) => {
        impl NativeTool for $tool {
            type Input = SessionInput;
            fn definition(&self) -> ToolDefinition { definition($name, $description, json!({"orchestrator_session_id":{"type":"string","minLength":1}}), &["orchestrator_session_id"]) }
            fn admission(&self) -> ToolAdmission { ToolAdmission::Exclusive }
            fn decode(&self, input: serde_json::Value) -> Result<Self::Input, ToolResult> { decode($name, input) }
            fn permission_resources(&self, input: &Self::Input, _services: ToolServices<'_>) -> Result<Vec<PermissionResource>, ToolResult> { Ok(vec![PermissionResource::new($action, &input.orchestrator_session_id)]) }
            fn execute<'a>(&'a self, input: Self::Input, services: ToolServices<'a>, _context: &'a ToolCallContext) -> BoxFuture<'a, ToolResult> { Box::pin(async move { $body(input, services).await }) }
        }
    };
}

async fn wait(input: SessionInput, services: ToolServices<'_>) -> ToolResult {
    let (parent, controller) = match controller(services) {
        Ok(value) => value,
        Err(error) => return error,
    };
    let record = match owned(services.runtime, &parent, &input.orchestrator_session_id) {
        Ok(record) => record,
        Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
    };
    match controller
        .wait(&record.orchestrator_session_id, record.generation)
        .await
    {
        Ok(record) => record_result(record),
        Err(error) => ToolResult::text(format!("Error: {error:#}"), true),
    }
}

async fn cancel(input: SessionInput, services: ToolServices<'_>) -> ToolResult {
    let (parent, controller) = match controller(services) {
        Ok(value) => value,
        Err(error) => return error,
    };
    if let Err(error) = owned(services.runtime, &parent, &input.orchestrator_session_id) {
        return ToolResult::text(format!("Error: {error:#}"), true);
    }
    match controller
        .cancel(&parent, &input.orchestrator_session_id)
        .await
    {
        Ok(record) => record_result(record),
        Err(error) => ToolResult::text(format!("Error: {error:#}"), true),
    }
}

session_control_tool!(
    WaitTool,
    "orchestrator_wait",
    "Wait for the active generation of a managed orchestrator and return its durable outcome.",
    "orchestrator_read",
    wait
);
session_control_tool!(
    CancelTool,
    "orchestrator_cancel",
    "Cancel the active generation of a managed orchestrator.",
    "orchestrator_cancel",
    cancel
);

fn owned(
    runtime: &super::ToolRuntime,
    parent: &str,
    orchestrator: &str,
) -> anyhow::Result<ManagedOrchestratorRecord> {
    crate::store::load_managed_orchestrator_for_parent(&runtime.store_path, parent, orchestrator)?
        .ok_or_else(|| anyhow::anyhow!("managed orchestrator was not found"))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::orchestration_control::{OrchestrationController, OrchestrationFuture};

    struct FakeController {
        starts: Mutex<Vec<ManagedOrchestratorStartRequest>>,
        block_wait: AtomicBool,
        cancels: AtomicUsize,
    }

    fn record(
        status: ManagedOrchestratorStatus,
        mode: ManagedOrchestratorExecutionMode,
    ) -> ManagedOrchestratorRecord {
        ManagedOrchestratorRecord {
            orchestrator_session_id: "orchestrator-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            root_session_id: "parent-1".to_string(),
            description: "implement persistence".to_string(),
            status,
            generation: 1,
            run_id: Some("run-1".to_string()),
            execution_mode: Some(mode),
            report: status
                .is_terminal()
                .then(|| "implementation complete".to_string()),
            failure: None,
            completion_inbox_id: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            version: 1,
        }
    }

    impl OrchestrationController for FakeController {
        fn start<'a>(
            &'a self,
            request: ManagedOrchestratorStartRequest,
        ) -> OrchestrationFuture<'a, ManagedOrchestratorRecord> {
            let mode = request.execution_mode;
            self.starts.lock().unwrap().push(request);
            Box::pin(async move { Ok(record(ManagedOrchestratorStatus::Running, mode)) })
        }

        fn wait<'a>(
            &'a self,
            _orchestrator_session_id: &'a str,
            _generation: u64,
        ) -> OrchestrationFuture<'a, ManagedOrchestratorRecord> {
            if self.block_wait.load(Ordering::SeqCst) {
                return Box::pin(std::future::pending());
            }
            Box::pin(async {
                Ok(record(
                    ManagedOrchestratorStatus::Completed,
                    ManagedOrchestratorExecutionMode::Foreground,
                ))
            })
        }

        fn steer<'a>(
            &'a self,
            _parent_session_id: &'a str,
            _orchestrator_session_id: &'a str,
            _instruction: &'a str,
            _thread_name: Option<&'a str>,
        ) -> OrchestrationFuture<'a, ManagedOrchestratorRecord> {
            Box::pin(async {
                Ok(record(
                    ManagedOrchestratorStatus::Running,
                    ManagedOrchestratorExecutionMode::Background,
                ))
            })
        }

        fn read<'a>(
            &'a self,
            _parent_session_id: &'a str,
            _orchestrator_session_id: &'a str,
            _kind: ManagedOrchestratorReadKind,
            _limit: usize,
        ) -> OrchestrationFuture<'a, serde_json::Value> {
            Box::pin(async { Ok(json!({"messages": []})) })
        }

        fn cancel<'a>(
            &'a self,
            _parent_session_id: &'a str,
            _orchestrator_session_id: &'a str,
        ) -> OrchestrationFuture<'a, ManagedOrchestratorRecord> {
            self.cancels.fetch_add(1, Ordering::SeqCst);
            Box::pin(async {
                Ok(record(
                    ManagedOrchestratorStatus::Cancelled,
                    ManagedOrchestratorExecutionMode::Foreground,
                ))
            })
        }

        fn wake<'a>(&'a self, _session_id: &'a str) -> OrchestrationFuture<'a, ()> {
            Box::pin(async { Ok(()) })
        }
    }

    #[tokio::test]
    async fn model_visible_launch_uses_native_controller_for_both_execution_modes() {
        let store_path = std::env::temp_dir().join(format!(
            "nac_orchestrator_native_{}.db",
            uuid::Uuid::new_v4()
        ));
        let controller = Arc::new(FakeController {
            starts: Mutex::new(Vec::new()),
            block_wait: AtomicBool::new(false),
            cancels: AtomicUsize::new(0),
        });
        crate::orchestration_control::register_controller(store_path.clone(), controller.clone());
        let mut runtime = crate::tools::test_runtime();
        runtime.store_path = store_path;
        runtime.session_id = Some("parent-1".to_string());
        runtime.allowed_tools = Some(Arc::new(
            crate::tools::DIRECT_WITH_ORCHESTRATOR_TOOL_NAMES
                .into_iter()
                .map(str::to_string)
                .collect(),
        ));
        let client = crate::model::ModelClient::new_for_test();

        let foreground = crate::tools::execute_tool(
            "orchestrator_launch",
            json!({
                "description": "implement persistence",
                "prompt": "implement and verify",
                "background": false
            }),
            &runtime,
            &client,
        )
        .await;
        assert!(!foreground.is_error, "{}", foreground.content);
        let foreground: ManagedOrchestratorRecord =
            serde_json::from_str(foreground.content.as_text().unwrap()).unwrap();
        assert_eq!(foreground.status, ManagedOrchestratorStatus::Completed);

        let background = crate::tools::execute_tool(
            "orchestrator_launch",
            json!({
                "description": "implement persistence",
                "prompt": "continue in background",
                "background": true
            }),
            &runtime,
            &client,
        )
        .await;
        assert!(!background.is_error, "{}", background.content);
        let background: serde_json::Value =
            serde_json::from_str(background.content.as_text().unwrap()).unwrap();
        assert_eq!(background["status"], "running");
        assert!(background["message"]
            .as_str()
            .unwrap()
            .contains("do not poll"));

        let starts = controller.starts.lock().unwrap();
        assert_eq!(starts.len(), 2);
        assert_eq!(
            starts[0].execution_mode,
            ManagedOrchestratorExecutionMode::Foreground
        );
        assert_eq!(
            starts[1].execution_mode,
            ManagedOrchestratorExecutionMode::Background
        );
    }

    #[tokio::test]
    async fn parent_cancellation_cancels_foreground_orchestrator_generation() {
        let store_path = std::env::temp_dir().join(format!(
            "nac_orchestrator_cancel_{}.db",
            uuid::Uuid::new_v4()
        ));
        let controller = Arc::new(FakeController {
            starts: Mutex::new(Vec::new()),
            block_wait: AtomicBool::new(true),
            cancels: AtomicUsize::new(0),
        });
        crate::orchestration_control::register_controller(store_path.clone(), controller.clone());
        let mut runtime = crate::tools::test_runtime();
        runtime.store_path = store_path;
        runtime.session_id = Some("parent-1".to_string());
        runtime.allowed_tools = Some(Arc::new(
            crate::tools::DIRECT_WITH_ORCHESTRATOR_TOOL_NAMES
                .into_iter()
                .map(str::to_string)
                .collect(),
        ));
        let cancellation = runtime.command_cancellation.clone();
        let client = crate::model::ModelClient::new_for_test();

        let launch = tokio::spawn(async move {
            crate::tools::execute_tool(
                "orchestrator_launch",
                json!({
                    "description": "implement persistence",
                    "prompt": "implement and verify",
                    "background": false
                }),
                &runtime,
                &client,
            )
            .await
        });
        tokio::task::yield_now().await;
        cancellation.cancel();
        let result = tokio::time::timeout(std::time::Duration::from_secs(1), launch)
            .await
            .expect("foreground launch must settle after parent cancellation")
            .unwrap();
        assert!(result.is_error, "cancelled foreground work is a tool error");
        let record: ManagedOrchestratorRecord =
            serde_json::from_str(result.content.as_text().unwrap()).unwrap();
        assert_eq!(record.status, ManagedOrchestratorStatus::Cancelled);
        assert_eq!(controller.cancels.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn native_status_wait_and_cancel_hide_foreign_orchestrator_ownership() {
        let root =
            std::env::temp_dir().join(format!("nac_orchestrator_opaque_{}", uuid::Uuid::new_v4()));
        let store_path = root.join("store.db");
        crate::store::initialize(&store_path).unwrap();
        for session_id in ["parent-a", "parent-b", "orchestrator-a"] {
            crate::store::insert_test_session(&store_path, session_id);
        }
        let connection = crate::store::open_runtime_connection(&store_path).unwrap();
        connection
            .execute(
                "UPDATE sessions SET behavior = 'direct-with-orchestrator' WHERE session_id IN ('parent-a', 'parent-b')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE sessions SET behavior = 'orchestrator' WHERE session_id = 'orchestrator-a'",
                [],
            )
            .unwrap();
        crate::store::create_managed_orchestrator_relationship(
            &store_path,
            "parent-a",
            "orchestrator-a",
            "review ownership",
        )
        .unwrap();
        let controller = Arc::new(FakeController {
            starts: Mutex::new(Vec::new()),
            block_wait: AtomicBool::new(false),
            cancels: AtomicUsize::new(0),
        });
        crate::orchestration_control::register_controller(store_path.clone(), controller.clone());
        let mut runtime = crate::tools::test_runtime();
        runtime.store_path = store_path.clone();
        runtime.session_id = Some("parent-b".to_string());
        runtime.allowed_tools = Some(Arc::new(
            crate::tools::DIRECT_WITH_ORCHESTRATOR_TOOL_NAMES
                .into_iter()
                .map(str::to_string)
                .collect(),
        ));
        let client = crate::model::ModelClient::new_for_test();

        for tool in [
            "orchestrator_status",
            "orchestrator_wait",
            "orchestrator_cancel",
        ] {
            let foreign = crate::tools::execute_tool(
                tool,
                json!({"orchestrator_session_id": "orchestrator-a"}),
                &runtime,
                &client,
            )
            .await;
            let missing = crate::tools::execute_tool(
                tool,
                json!({"orchestrator_session_id": "missing"}),
                &runtime,
                &client,
            )
            .await;
            assert!(foreign.is_error && missing.is_error);
            assert_eq!(
                foreign.content.as_text(),
                missing.content.as_text(),
                "{tool}"
            );
            assert_eq!(
                foreign.content.as_text(),
                Some("Error: managed orchestrator was not found")
            );
        }
        assert_eq!(controller.cancels.load(Ordering::SeqCst), 0);

        let _ = std::fs::remove_dir_all(root);
    }
}
