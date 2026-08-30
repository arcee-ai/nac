use std::sync::Arc;

use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::json;

use crate::orchestration_control::{ManagedOrchestratorReadKind, ManagedOrchestratorStartRequest};
use crate::store::{
    SessionAssignmentChildBehavior, TraditionalChildExecutionMode, TraditionalChildRecord,
    TraditionalChildStatus, GENERAL_CHILD_PROFILE,
};
use crate::traditional_children::TraditionalChildStartRequest;
use crate::types::{FunctionDef, ToolDefinition};

use super::kernel::{NativeTool, PermissionResource, ToolAdmission, ToolCallContext, ToolServices};
use super::ToolResult;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpawnInput {
    behavior: SessionAssignmentChildBehavior,
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

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SteerInput {
    child_session_id: String,
    instruction: String,
    #[serde(default)]
    thread_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReadInput {
    child_session_id: String,
    kind: String,
    #[serde(default = "default_limit")]
    limit: usize,
}

fn default_limit() -> usize {
    24
}

pub struct SessionSpawnTool;
pub struct SessionStatusTool;
pub struct SessionSteerTool;
pub struct SessionReadTool;
pub struct SessionWaitTool;
pub struct SessionCancelTool;

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

fn parent_session_id(services: ToolServices<'_>) -> Result<String, ToolResult> {
    services.runtime.session_id.clone().ok_or_else(|| {
        ToolResult::text(
            "Error: session controls require a persistent parent session",
            true,
        )
    })
}

fn owned_assignment(
    services: ToolServices<'_>,
    parent_session_id: &str,
    child_session_id: &str,
) -> Result<crate::store::SessionAssignmentRecord, ToolResult> {
    crate::store::load_session_assignment_for_parent(
        &services.runtime.store_path,
        parent_session_id,
        child_session_id,
    )
    .map_err(|error| ToolResult::text(format!("Error: {error:#}"), true))?
    .ok_or_else(|| ToolResult::text("Error: session assignment was not found", true))
}

#[expect(
    clippy::expect_used,
    reason = "assignment and child records contain only JSON-representable fields"
)]
fn json_result<T: serde::Serialize>(value: T, is_error: bool) -> ToolResult {
    ToolResult::text(
        serde_json::to_string(&value).expect("session assignment outcome serializes"),
        is_error,
    )
}

fn child_is_error(status: TraditionalChildStatus) -> bool {
    matches!(
        status,
        TraditionalChildStatus::Failed
            | TraditionalChildStatus::Cancelled
            | TraditionalChildStatus::Interrupted
    )
}

fn child_result(child: TraditionalChildRecord) -> ToolResult {
    json_result(child.clone(), child_is_error(child.status))
}

async fn wait_for_child(
    services: ToolServices<'_>,
    parent_session_id: String,
    child: TraditionalChildRecord,
) -> ToolResult {
    let controller = match crate::traditional_children::controller_for(&services.runtime.store_path)
    {
        Ok(controller) => controller,
        Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
    };
    let child_session_id = child.child_session_id.clone();
    let generation = child.generation;
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
        Ok(outcome) => child_result(outcome),
        Err(error) => ToolResult::text(
            format!("Error: foreground session failed (child_session_id: {child_session_id}): {error:#}"),
            true,
        ),
    }
}

async fn wait_for_orchestrator(
    services: ToolServices<'_>,
    parent_session_id: String,
    started: crate::store::ManagedOrchestratorRecord,
) -> ToolResult {
    let controller =
        match crate::orchestration_control::controller_for(&services.runtime.store_path) {
            Ok(controller) => controller,
            Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
        };
    let session_id = started.orchestrator_session_id.clone();
    let outcome = tokio::select! {
        outcome = controller.wait(&session_id, started.generation) => outcome,
        _ = services.runtime.command_cancellation.cancelled() => {
            let cancel_controller = Arc::clone(&controller);
            let cancel_parent = parent_session_id.clone();
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
        Ok(record) => json_result(record.clone(), child_is_error(record.status)),
        Err(error) => ToolResult::text(
            format!("Error: foreground session failed (child_session_id: {session_id}): {error:#}"),
            true,
        ),
    }
}

impl NativeTool for SessionSpawnTool {
    type Input = SpawnInput;

    fn definition(&self) -> ToolDefinition {
        definition(
            "session_spawn",
            "Launch or continue a durable child session of either type. behavior=direct starts an Agent coding session; behavior=orchestrator starts a NAC planner. Pass null as child_session_id for a fresh session, or an existing child ID to continue or steer that exact assignment. Foreground waits for a structured outcome; background returns immediately and delivers exactly one completion through the parent inbox.",
            json!({
                "behavior": {"type": "string", "enum": ["direct", "orchestrator"], "description": "Child session type. direct is an Agent; orchestrator is NAC."},
                "description": {"type": "string", "minLength": 1, "maxLength": 120, "description": "A short 3-5 word task label shown to the user."},
                "prompt": {"type": "string", "minLength": 1, "description": "Complete task and context for a new child, or steering/continuation text for an existing child."},
                "child_session_id": {"type": ["string", "null"], "minLength": 1, "description": "Pass null to create a fresh child, or an existing child ID to continue or steer it."},
                "background": {"type": "boolean", "description": "Use false to wait for the structured outcome, or true to return immediately and receive completion through the durable inbox."}
            }),
            &["behavior", "description", "prompt", "child_session_id", "background"],
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn decode(&self, input: serde_json::Value) -> Result<Self::Input, ToolResult> {
        decode("session_spawn", input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(vec![PermissionResource::new(
            "session_spawn",
            input
                .child_session_id
                .as_deref()
                .unwrap_or(input.behavior.as_str()),
        )])
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let parent = match parent_session_id(services) {
                Ok(parent) => parent,
                Err(error) => return error,
            };
            match input.behavior {
                SessionAssignmentChildBehavior::Direct => {
                    let controller = match crate::traditional_children::controller_for(
                        &services.runtime.store_path,
                    ) {
                        Ok(controller) => controller,
                        Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
                    };
                    let background = input.background;
                    let started = match controller
                        .start(TraditionalChildStartRequest {
                            parent_session_id: parent.clone(),
                            child_session_id: input.child_session_id,
                            profile: GENERAL_CHILD_PROFILE.to_string(),
                            description: input.description,
                            prompt: input.prompt,
                            execution_mode: if background {
                                TraditionalChildExecutionMode::Background
                            } else {
                                TraditionalChildExecutionMode::Foreground
                            },
                        })
                        .await
                    {
                        Ok(started) => started,
                        Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
                    };
                    if background {
                        return ToolResult::text(
                            json!({
                                "child_session_id": started.child_session_id,
                                "generation": started.generation,
                                "status": "running",
                                "message": "The child is running in the background. Completion will be delivered automatically; do not poll or duplicate its work."
                            })
                            .to_string(),
                            false,
                        );
                    }
                    wait_for_child(services, parent, started).await
                }
                SessionAssignmentChildBehavior::Orchestrator => {
                    let controller = match crate::orchestration_control::controller_for(
                        &services.runtime.store_path,
                    ) {
                        Ok(controller) => controller,
                        Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
                    };
                    let background = input.background;
                    let started = match controller
                        .start(ManagedOrchestratorStartRequest {
                            parent_session_id: parent.clone(),
                            orchestrator_session_id: input.child_session_id,
                            description: input.description,
                            prompt: input.prompt,
                            execution_mode: if background {
                                crate::store::ManagedOrchestratorExecutionMode::Background
                            } else {
                                crate::store::ManagedOrchestratorExecutionMode::Foreground
                            },
                        })
                        .await
                    {
                        Ok(started) => started,
                        Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
                    };
                    if background {
                        return ToolResult::text(
                            json!({
                                "child_session_id": started.orchestrator_session_id,
                                "orchestrator_session_id": started.orchestrator_session_id,
                                "generation": started.generation,
                                "status": "running",
                                "message": "The orchestrator is running in the background. Completion will be delivered automatically; do not poll or duplicate its work."
                            })
                            .to_string(),
                            false,
                        );
                    }
                    wait_for_orchestrator(services, parent, started).await
                }
            }
        })
    }
}

impl NativeTool for SessionStatusTool {
    type Input = ChildIdInput;

    fn definition(&self) -> ToolDefinition {
        definition(
            "session_status",
            "Read durable status and the latest structured outcome for one assignment owned by this session. Background completion is delivered automatically; use this only when current status is genuinely needed, not to poll.",
            json!({"child_session_id": {"type": "string", "minLength": 1}}),
            &["child_session_id"],
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn decode(&self, input: serde_json::Value) -> Result<Self::Input, ToolResult> {
        decode("session_status", input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(vec![PermissionResource::new(
            "session_status",
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
            let parent = match parent_session_id(services) {
                Ok(parent) => parent,
                Err(error) => return error,
            };
            match owned_assignment(services, &parent, &input.child_session_id) {
                Ok(record) => json_result(record.clone(), child_is_error(record.status)),
                Err(error) => error,
            }
        })
    }
}

impl NativeTool for SessionSteerTool {
    type Input = SteerInput;

    fn definition(&self) -> ToolDefinition {
        definition(
            "session_steer",
            "Steer a running assignment. For a NAC child, instruction is queued as orchestrator or worker-thread steering. For an Agent child, the instruction continues the current generation.",
            json!({
                "child_session_id": {"type": "string", "minLength": 1},
                "instruction": {"type": "string", "minLength": 1},
                "thread_name": {"type": "string", "minLength": 1}
            }),
            &["child_session_id", "instruction"],
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn decode(&self, input: serde_json::Value) -> Result<Self::Input, ToolResult> {
        decode("session_steer", input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(vec![PermissionResource::new(
            "session_steer",
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
            let parent = match parent_session_id(services) {
                Ok(parent) => parent,
                Err(error) => return error,
            };
            let assignment = match owned_assignment(services, &parent, &input.child_session_id) {
                Ok(assignment) => assignment,
                Err(error) => return error,
            };
            match assignment.child_behavior {
                SessionAssignmentChildBehavior::Direct => {
                    if input.thread_name.is_some() {
                        return ToolResult::text(
                            "Error: thread_name is only valid for NAC assignments",
                            true,
                        );
                    }
                    let controller = match crate::traditional_children::controller_for(
                        &services.runtime.store_path,
                    ) {
                        Ok(controller) => controller,
                        Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
                    };
                    match controller
                        .start(TraditionalChildStartRequest {
                            parent_session_id: parent,
                            child_session_id: Some(input.child_session_id),
                            profile: GENERAL_CHILD_PROFILE.to_string(),
                            description: assignment.description,
                            prompt: input.instruction,
                            execution_mode: TraditionalChildExecutionMode::Background,
                        })
                        .await
                    {
                        Ok(child) => child_result(child),
                        Err(error) => ToolResult::text(format!("Error: {error:#}"), true),
                    }
                }
                SessionAssignmentChildBehavior::Orchestrator => {
                    let controller = match crate::orchestration_control::controller_for(
                        &services.runtime.store_path,
                    ) {
                        Ok(controller) => controller,
                        Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
                    };
                    match controller
                        .steer(
                            &parent,
                            &input.child_session_id,
                            &input.instruction,
                            input.thread_name.as_deref(),
                        )
                        .await
                    {
                        Ok(record) => json_result(record.clone(), child_is_error(record.status)),
                        Err(error) => ToolResult::text(format!("Error: {error:#}"), true),
                    }
                }
            }
        })
    }
}

impl NativeTool for SessionReadTool {
    type Input = ReadInput;

    fn definition(&self) -> ToolDefinition {
        definition(
            "session_read",
            "Read a slice of a child assignment. kind=messages copies transcript prose. episodes and events are NAC-only worker views.",
            json!({
                "child_session_id": {"type": "string", "minLength": 1},
                "kind": {"type": "string", "enum": ["messages", "episodes", "events"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 24}
            }),
            &["child_session_id", "kind"],
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn decode(&self, input: serde_json::Value) -> Result<Self::Input, ToolResult> {
        decode("session_read", input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(vec![PermissionResource::new(
            "session_read",
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
            if !(1..=200).contains(&input.limit) {
                return ToolResult::text("Error: limit must be 1-200", true);
            }
            let parent = match parent_session_id(services) {
                Ok(parent) => parent,
                Err(error) => return error,
            };
            let assignment = match owned_assignment(services, &parent, &input.child_session_id) {
                Ok(assignment) => assignment,
                Err(error) => return error,
            };
            match assignment.child_behavior {
                SessionAssignmentChildBehavior::Direct => {
                    if input.kind != "messages" {
                        return ToolResult::text(
                            "Error: Agent assignments only support kind=messages",
                            true,
                        );
                    }
                    match crate::sessions::load_session(
                        &services.runtime.store_path,
                        &input.child_session_id,
                    ) {
                        Ok(snapshot) => {
                            let start = snapshot.messages.len().saturating_sub(input.limit);
                            json_result(&snapshot.messages[start..], false)
                        }
                        Err(error) => ToolResult::text(format!("Error: {error:#}"), true),
                    }
                }
                SessionAssignmentChildBehavior::Orchestrator => {
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
                    let controller = match crate::orchestration_control::controller_for(
                        &services.runtime.store_path,
                    ) {
                        Ok(controller) => controller,
                        Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
                    };
                    match controller
                        .read(&parent, &input.child_session_id, kind, input.limit)
                        .await
                    {
                        Ok(value) => ToolResult::text(value.to_string(), false),
                        Err(error) => ToolResult::text(format!("Error: {error:#}"), true),
                    }
                }
            }
        })
    }
}

impl NativeTool for SessionWaitTool {
    type Input = ChildIdInput;

    fn definition(&self) -> ToolDefinition {
        definition(
            "session_wait",
            "Wait for the active generation of one assignment owned by this session and return its durable outcome.",
            json!({"child_session_id": {"type": "string", "minLength": 1}}),
            &["child_session_id"],
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Exclusive
    }

    fn decode(&self, input: serde_json::Value) -> Result<Self::Input, ToolResult> {
        decode("session_wait", input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(vec![PermissionResource::new(
            "session_wait",
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
            let parent = match parent_session_id(services) {
                Ok(parent) => parent,
                Err(error) => return error,
            };
            let assignment = match owned_assignment(services, &parent, &input.child_session_id) {
                Ok(assignment) => assignment,
                Err(error) => return error,
            };
            match assignment.child_behavior {
                SessionAssignmentChildBehavior::Direct => {
                    let controller = match crate::traditional_children::controller_for(
                        &services.runtime.store_path,
                    ) {
                        Ok(controller) => controller,
                        Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
                    };
                    match controller
                        .wait(&input.child_session_id, assignment.generation)
                        .await
                    {
                        Ok(child) => child_result(child),
                        Err(error) => ToolResult::text(format!("Error: {error:#}"), true),
                    }
                }
                SessionAssignmentChildBehavior::Orchestrator => {
                    let controller = match crate::orchestration_control::controller_for(
                        &services.runtime.store_path,
                    ) {
                        Ok(controller) => controller,
                        Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
                    };
                    match controller
                        .wait(&input.child_session_id, assignment.generation)
                        .await
                    {
                        Ok(record) => json_result(record.clone(), child_is_error(record.status)),
                        Err(error) => ToolResult::text(format!("Error: {error:#}"), true),
                    }
                }
            }
        })
    }
}

impl NativeTool for SessionCancelTool {
    type Input = ChildIdInput;

    fn definition(&self) -> ToolDefinition {
        definition(
            "session_cancel",
            "Cancel the active generation of one assignment owned by this session.",
            json!({"child_session_id": {"type": "string", "minLength": 1}}),
            &["child_session_id"],
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Exclusive
    }

    fn decode(&self, input: serde_json::Value) -> Result<Self::Input, ToolResult> {
        decode("session_cancel", input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(vec![PermissionResource::new(
            "session_cancel",
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
            let parent = match parent_session_id(services) {
                Ok(parent) => parent,
                Err(error) => return error,
            };
            let assignment = match owned_assignment(services, &parent, &input.child_session_id) {
                Ok(assignment) => assignment,
                Err(error) => return error,
            };
            match assignment.child_behavior {
                SessionAssignmentChildBehavior::Direct => {
                    let controller = match crate::traditional_children::controller_for(
                        &services.runtime.store_path,
                    ) {
                        Ok(controller) => controller,
                        Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
                    };
                    match controller.cancel(&parent, &input.child_session_id).await {
                        Ok(child) => child_result(child),
                        Err(error) => ToolResult::text(format!("Error: {error:#}"), true),
                    }
                }
                SessionAssignmentChildBehavior::Orchestrator => {
                    let controller = match crate::orchestration_control::controller_for(
                        &services.runtime.store_path,
                    ) {
                        Ok(controller) => controller,
                        Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
                    };
                    match controller.cancel(&parent, &input.child_session_id).await {
                        Ok(record) => json_result(record.clone(), child_is_error(record.status)),
                        Err(error) => ToolResult::text(format!("Error: {error:#}"), true),
                    }
                }
            }
        })
    }
}
