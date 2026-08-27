use std::sync::Arc;

use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::json;

use crate::store::{
    TraditionalChildExecutionMode, TraditionalChildRecord, TraditionalChildStatus,
    GENERAL_CHILD_PROFILE,
};
use crate::traditional_children::TraditionalChildStartRequest;
use crate::types::{FunctionDef, ToolDefinition};

use super::kernel::{NativeTool, PermissionResource, ToolAdmission, ToolCallContext, ToolServices};
use super::ToolResult;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubagentInput {
    profile: String,
    description: String,
    prompt: String,
    #[serde(default)]
    child_session_id: Option<String>,
    #[serde(default)]
    background: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChildIdInput {
    child_session_id: String,
}

pub struct SubagentTool;
pub struct SubagentStatusTool;
pub struct SubagentCancelTool;

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

impl NativeTool for SubagentTool {
    type Input = SubagentInput;

    fn definition(&self) -> ToolDefinition {
        definition(
            "subagent",
            "Launch or continue a durable traditional child session. New children have fresh context and inherit the parent model/backend/workspace ceiling. Foreground waits for a structured outcome; background returns immediately and delivers exactly one completion through the parent inbox. A child_session_id continues that exact child; if it is running, the prompt steers its current generation. Available profiles:\n- general: general coding work with the eight native coding tools; nesting, goals, and orchestrator control are disabled.",
            json!({
                "profile": {"type": "string", "enum": [GENERAL_CHILD_PROFILE], "description": "The immutable child profile."},
                "description": {"type": "string", "minLength": 1, "maxLength": 120, "description": "A short 3-5 word task label shown to the user."},
                "prompt": {"type": "string", "minLength": 1, "description": "Complete task and context for a new child, or steering/continuation text for an existing child."},
                "child_session_id": {"type": "string", "minLength": 1, "description": "Continue or steer this child. Omit to create a fresh child conversation."},
                "background": {"type": "boolean", "default": false, "description": "Return immediately and deliver completion durably to the parent inbox."}
            }),
            &["profile", "description", "prompt"],
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn decode(&self, input: serde_json::Value) -> Result<Self::Input, ToolResult> {
        serde_json::from_value(input).map_err(|error| {
            ToolResult::text(format!("Error: invalid subagent input: {error}"), true)
        })
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(vec![
            PermissionResource::new("subagent", &input.profile).with_save_resource(&input.profile)
        ])
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(parent_session_id) = services.runtime.session_id.clone() else {
                return ToolResult::text(
                    "Error: subagent requires a persistent parent session",
                    true,
                );
            };
            let controller =
                match crate::traditional_children::controller_for(&services.runtime.store_path) {
                    Ok(controller) => controller,
                    Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
                };
            let background = input.background;
            let started = controller
                .start(TraditionalChildStartRequest {
                    parent_session_id: parent_session_id.clone(),
                    child_session_id: input.child_session_id,
                    profile: input.profile,
                    description: input.description,
                    prompt: input.prompt,
                    execution_mode: if background {
                        TraditionalChildExecutionMode::Background
                    } else {
                        TraditionalChildExecutionMode::Foreground
                    },
                })
                .await;
            let started = match started {
                Ok(started) => started,
                Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
            };
            if background {
                return ToolResult::text(
                    serde_json::to_string(&json!({
                        "child_session_id": started.child_session_id,
                        "generation": started.generation,
                        "status": "running",
                        "message": "The child is running in the background. Completion will be delivered automatically; do not poll or duplicate its work."
                    }))
                    .expect("subagent background output serializes"),
                    false,
                );
            }

            let child_session_id = started.child_session_id.clone();
            let generation = started.generation;
            let outcome = tokio::select! {
                outcome = controller.wait(&child_session_id, generation) => outcome,
                _ = services.runtime.command_cancellation.cancelled() => {
                    let cancel_controller = Arc::clone(&controller);
                    let cancel_parent = parent_session_id.clone();
                    let cancel_child = child_session_id.clone();
                    let cancellation = tokio::spawn(async move {
                        cancel_controller.cancel(&cancel_parent, &cancel_child).await
                    });
                    match cancellation.await {
                        Ok(Ok(cancelled)) => Ok(cancelled),
                        Ok(Err(error)) => Err(error.context("parent cancellation could not cancel foreground child")),
                        Err(error) => Err(anyhow::anyhow!("foreground child cancellation task failed: {error}")),
                    }
                }
            };
            match outcome {
                Ok(outcome) => outcome_result(outcome),
                Err(error) => ToolResult::text(
                    format!("Error: foreground subagent failed (child_session_id: {child_session_id}): {error:#}"),
                    true,
                ),
            }
        })
    }
}

impl NativeTool for SubagentStatusTool {
    type Input = ChildIdInput;

    fn definition(&self) -> ToolDefinition {
        definition(
            "subagent_status",
            "Read durable status and the latest structured outcome for one child of the current session. Background completion is delivered automatically; use this only when current status is genuinely needed, not to poll.",
            json!({"child_session_id": {"type": "string", "minLength": 1}}),
            &["child_session_id"],
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn decode(&self, input: serde_json::Value) -> Result<Self::Input, ToolResult> {
        serde_json::from_value(input).map_err(|error| {
            ToolResult::text(
                format!("Error: invalid subagent_status input: {error}"),
                true,
            )
        })
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(vec![PermissionResource::new(
            "subagent_read",
            &input.child_session_id,
        )])
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(parent_session_id) = services.runtime.session_id.as_deref() else {
                return ToolResult::text(
                    "Error: subagent_status requires a persistent session",
                    true,
                );
            };
            match owned_child(services.runtime, parent_session_id, &input.child_session_id) {
                Ok(child) => outcome_result(child),
                Err(error) => ToolResult::text(format!("Error: {error:#}"), true),
            }
        })
    }
}

impl NativeTool for SubagentCancelTool {
    type Input = ChildIdInput;

    fn definition(&self) -> ToolDefinition {
        definition(
            "subagent_cancel",
            "Cancel the active run of one durable child owned by the current session. Cancellation propagates to the child's foreground commands and records a durable cancelled outcome.",
            json!({"child_session_id": {"type": "string", "minLength": 1}}),
            &["child_session_id"],
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Exclusive
    }

    fn decode(&self, input: serde_json::Value) -> Result<Self::Input, ToolResult> {
        serde_json::from_value(input).map_err(|error| {
            ToolResult::text(
                format!("Error: invalid subagent_cancel input: {error}"),
                true,
            )
        })
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(vec![PermissionResource::new(
            "subagent_cancel",
            &input.child_session_id,
        )])
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let Some(parent_session_id) = services.runtime.session_id.clone() else {
                return ToolResult::text(
                    "Error: subagent_cancel requires a persistent session",
                    true,
                );
            };
            let controller =
                match crate::traditional_children::controller_for(&services.runtime.store_path) {
                    Ok(controller) => controller,
                    Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
                };
            if let Err(error) = owned_child(
                services.runtime,
                &parent_session_id,
                &input.child_session_id,
            ) {
                return ToolResult::text(format!("Error: {error:#}"), true);
            }
            match controller
                .cancel(&parent_session_id, &input.child_session_id)
                .await
            {
                Ok(child) => outcome_result(child),
                Err(error) => ToolResult::text(format!("Error: {error:#}"), true),
            }
        })
    }
}

fn owned_child(
    runtime: &super::ToolRuntime,
    parent_session_id: &str,
    child_session_id: &str,
) -> anyhow::Result<TraditionalChildRecord> {
    crate::store::load_traditional_child_for_parent(
        &runtime.store_path,
        parent_session_id,
        child_session_id,
    )?
    .ok_or_else(|| anyhow::anyhow!("traditional child was not found"))
}

fn outcome_result(child: TraditionalChildRecord) -> ToolResult {
    let is_error = matches!(
        child.status,
        TraditionalChildStatus::Failed
            | TraditionalChildStatus::Cancelled
            | TraditionalChildStatus::Interrupted
    );
    ToolResult::text(
        serde_json::to_string(&child).expect("traditional child outcome serializes"),
        is_error,
    )
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::traditional_children::{ChildFuture, TraditionalChildController};

    struct FakeController {
        starts: Mutex<Vec<TraditionalChildStartRequest>>,
    }

    fn child(
        status: TraditionalChildStatus,
        mode: TraditionalChildExecutionMode,
    ) -> TraditionalChildRecord {
        TraditionalChildRecord {
            child_session_id: "child-1".to_string(),
            parent_session_id: "parent-1".to_string(),
            root_session_id: "parent-1".to_string(),
            profile: GENERAL_CHILD_PROFILE.to_string(),
            description: "review store".to_string(),
            nesting_depth: 1,
            status,
            generation: 1,
            run_id: Some("run-1".to_string()),
            execution_mode: Some(mode),
            report: status.is_terminal().then(|| "review complete".to_string()),
            failure: None,
            change_summary: None,
            verification_summary: None,
            completion_inbox_id: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            version: 1,
        }
    }

    impl TraditionalChildController for FakeController {
        fn start<'a>(
            &'a self,
            request: TraditionalChildStartRequest,
        ) -> ChildFuture<'a, TraditionalChildRecord> {
            let mode = request.execution_mode;
            self.starts.lock().unwrap().push(request);
            Box::pin(async move { Ok(child(TraditionalChildStatus::Running, mode)) })
        }

        fn wait<'a>(
            &'a self,
            _child_session_id: &'a str,
            _generation: u64,
        ) -> ChildFuture<'a, TraditionalChildRecord> {
            Box::pin(async {
                Ok(child(
                    TraditionalChildStatus::Completed,
                    TraditionalChildExecutionMode::Foreground,
                ))
            })
        }

        fn cancel<'a>(
            &'a self,
            _parent_session_id: &'a str,
            _child_session_id: &'a str,
        ) -> ChildFuture<'a, TraditionalChildRecord> {
            Box::pin(async {
                Ok(child(
                    TraditionalChildStatus::Cancelled,
                    TraditionalChildExecutionMode::Foreground,
                ))
            })
        }

        fn wake<'a>(&'a self, _session_id: &'a str) -> ChildFuture<'a, ()> {
            Box::pin(async { Ok(()) })
        }
    }

    #[tokio::test]
    async fn model_visible_subagent_tool_uses_native_controller_for_foreground_and_background() {
        let store_path =
            std::env::temp_dir().join(format!("nac_subagent_native_{}.db", uuid::Uuid::new_v4()));
        let controller = Arc::new(FakeController {
            starts: Mutex::new(Vec::new()),
        });
        crate::traditional_children::register_controller(store_path.clone(), controller.clone());
        let mut runtime = crate::tools::test_runtime();
        runtime.store_path = store_path;
        runtime.session_id = Some("parent-1".to_string());
        runtime.allowed_tools = Some(Arc::new(
            crate::tools::DIRECT_TOOL_NAMES
                .into_iter()
                .map(str::to_string)
                .collect(),
        ));
        let client = crate::model::ModelClient::new_for_test();

        let foreground = crate::tools::execute_tool(
            "subagent",
            json!({
                "profile": "general",
                "description": "review store",
                "prompt": "inspect persistence",
                "background": false
            }),
            &runtime,
            &client,
        )
        .await;
        assert!(!foreground.is_error, "{}", foreground.content);
        let foreground: TraditionalChildRecord = serde_json::from_str(
            foreground
                .content
                .as_text()
                .expect("text foreground outcome"),
        )
        .unwrap();
        assert_eq!(foreground.status, TraditionalChildStatus::Completed);

        let background = crate::tools::execute_tool(
            "subagent",
            json!({
                "profile": "general",
                "description": "review store",
                "prompt": "inspect in background",
                "background": true
            }),
            &runtime,
            &client,
        )
        .await;
        assert!(!background.is_error, "{}", background.content);
        let background: serde_json::Value = serde_json::from_str(
            background
                .content
                .as_text()
                .expect("text background handle"),
        )
        .unwrap();
        assert_eq!(background["status"], "running");
        assert!(background["message"]
            .as_str()
            .unwrap()
            .contains("do not poll"));

        let starts = controller.starts.lock().unwrap();
        assert_eq!(starts.len(), 2);
        assert_eq!(
            starts[0].execution_mode,
            TraditionalChildExecutionMode::Foreground
        );
        assert_eq!(
            starts[1].execution_mode,
            TraditionalChildExecutionMode::Background
        );
    }

    #[tokio::test]
    async fn native_status_and_cancel_hide_foreign_child_ownership() {
        let root =
            std::env::temp_dir().join(format!("nac_subagent_opaque_{}", uuid::Uuid::new_v4()));
        let store_path = root.join("store.db");
        crate::store::initialize(&store_path).unwrap();
        for session_id in ["parent-a", "parent-b", "child-a"] {
            crate::store::insert_test_session(&store_path, session_id);
        }
        let connection = crate::store::open_runtime_connection(&store_path).unwrap();
        connection
            .execute(
                "UPDATE sessions SET behavior = 'direct' WHERE session_id IN ('parent-a', 'parent-b', 'child-a')",
                [],
            )
            .unwrap();
        crate::store::create_traditional_child_relationship(
            &store_path,
            "parent-a",
            "child-a",
            GENERAL_CHILD_PROFILE,
            "review ownership",
        )
        .unwrap();
        let controller = Arc::new(FakeController {
            starts: Mutex::new(Vec::new()),
        });
        crate::traditional_children::register_controller(store_path.clone(), controller);
        let mut runtime = crate::tools::test_runtime();
        runtime.store_path = store_path.clone();
        runtime.session_id = Some("parent-b".to_string());
        runtime.allowed_tools = Some(Arc::new(
            crate::tools::DIRECT_TOOL_NAMES
                .into_iter()
                .map(str::to_string)
                .collect(),
        ));
        let client = crate::model::ModelClient::new_for_test();

        for tool in ["subagent_status", "subagent_cancel"] {
            let foreign = crate::tools::execute_tool(
                tool,
                json!({"child_session_id": "child-a"}),
                &runtime,
                &client,
            )
            .await;
            let missing = crate::tools::execute_tool(
                tool,
                json!({"child_session_id": "missing"}),
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
                Some("Error: traditional child was not found")
            );
        }

        let _ = std::fs::remove_dir_all(root);
    }
}
