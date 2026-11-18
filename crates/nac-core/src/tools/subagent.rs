use std::sync::Arc;
use std::time::Duration;

use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::json;

use crate::store::{
    TraditionalChildExecutionMode, TraditionalChildRecord, TraditionalChildStatus,
    GENERAL_CHILD_PROFILE,
};
use crate::traditional_children::TraditionalChildStartRequest;
use crate::types::{FunctionDef, ToolDefinition};

use super::kernel::{
    NativeTool, PermissionResource, ToolAdmission, ToolCallContext, ToolServices, ToolTimeout,
    ToolTimeoutDisposition,
};
use super::ToolResult;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubagentInput {
    profile: String,
    /// Required to launch; continuation resolves the immutable stored label.
    #[serde(default)]
    description: Option<String>,
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
            "Launch or continue a durable traditional child session. New children have fresh context and inherit the parent model/backend/workspace ceiling. Pass null as child_session_id with a description to launch a new child; a string continues that exact child and steers its current generation when it is running. A child's description is immutable: pass null description when continuing or steering, or repeat the original exactly. Foreground waits for a structured outcome; background returns immediately and delivers exactly one completion through the parent inbox. Available profiles:\n- general: general coding work with the eight native coding tools plus native web_search/web_fetch inherited when available to the parent; nesting, goals, and orchestrator control are disabled.",
            json!({
                "profile": {"type": "string", "enum": [GENERAL_CHILD_PROFILE], "description": "The immutable child profile."},
                "description": {"type": ["string", "null"], "minLength": 1, "maxLength": 120, "description": "A short 3-5 word task label shown to the user. Required to launch a new child. Pass null when continuing or steering an existing child to keep its immutable original label; a different label is rejected."},
                "prompt": {"type": "string", "minLength": 1, "description": "Complete task and context for a new child, or steering/continuation text for an existing child."},
                "child_session_id": {"type": ["string", "null"], "minLength": 1, "description": "Pass null to create a fresh child conversation, or an existing child ID to continue or steer it."},
                "background": {"type": "boolean", "description": "Use false to wait for the structured outcome, or true to return immediately and receive completion through the durable inbox."}
            }),
            &["profile", "description", "prompt", "child_session_id", "background"],
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn timeout(
        &self,
        input: &mut serde_json::Value,
        requested: Option<Duration>,
    ) -> Result<ToolTimeout, ToolResult> {
        let background = input
            .get("background")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        Ok(ToolTimeout {
            duration: requested.unwrap_or(if background {
                super::kernel::DEFAULT_TOOL_TIMEOUT
            } else {
                super::kernel::MAX_TOOL_TIMEOUT
            }),
            // Admission is a durable mutation: once a generation is accepted,
            // its canonical running record must win a simultaneous deadline.
            disposition: ToolTimeoutDisposition::Settle,
            remote_outcome_uncertain: false,
        })
    }

    fn certifies_delegation_summary(&self) -> bool {
        true
    }

    fn decode(&self, input: serde_json::Value) -> Result<Self::Input, ToolResult> {
        let input: SubagentInput = serde_json::from_value(input).map_err(|error| {
            ToolResult::text(format!("Error: invalid subagent input: {error}"), true)
        })?;
        // A launch has no stored label to resolve; reject it before policy.
        if input.child_session_id.is_none() {
            crate::traditional_children::description_for_new_child(input.description.as_deref())
                .map_err(|error| {
                    ToolResult::text(format!("Error: invalid subagent input: {error}"), true)
                })?;
        }
        Ok(input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        let mut resource =
            PermissionResource::new("subagent", &input.profile).with_save_resource(&input.profile);
        if services.runtime.heartbeat_execution && input.child_session_id.is_none() {
            resource = resource
                .with_hard_denial("an existing-chat heartbeat cannot create a new conversation");
        }
        Ok(vec![resource])
    }

    #[expect(
        clippy::expect_used,
        reason = "the background acknowledgement is constructed entirely from JSON values"
    )]
    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            let mut result = async {
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
            let continuing = input.child_session_id.is_some();
            if let Some(call_id) = context.call_id.as_ref() {
                let intent = match (background, continuing) {
                    (true, false) => crate::events::DelegationIntent::BackgroundLaunch,
                    (true, true) => crate::events::DelegationIntent::BackgroundContinuation,
                    (false, _) => crate::events::DelegationIntent::Foreground,
                };
                services
                    .runtime
                    .event_sink
                    .emit_async(crate::events::AgentEvent::ToolCallStarted {
                        thread_name: context.thread_name.clone(),
                        call_id: call_id.clone(),
                        name: "subagent".to_string(),
                        args_preview: String::new(),
                        key_arg_preview: context.presentation_key_arg.clone(),
                        args_detail: None,
                        delegation_intent: Some(intent),
                        delegation_summary_verified: true,
                    })
                    .await;
            }
            let started = controller
                .start(TraditionalChildStartRequest {
                    parent_session_id: parent_session_id.clone(),
                    child_session_id: input.child_session_id,
                    profile: input.profile,
                    description: input.description,
                    prompt: input.prompt,
                    origin: crate::store::InputOrigin::Automation,
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
                let mut result = ToolResult::text(
                    serde_json::to_string(&json!({
                        "child_session_id": started.child_session_id,
                        "generation": started.generation,
                        "status": "running",
                        "message": "The child is running in the background. Completion will be delivered automatically; do not poll or duplicate its work."
                    }))
                    .expect("subagent background output serializes"),
                    false,
                );
                result.delegation_outcome = Some(if continuing {
                    crate::events::DelegationOutcome::BackgroundContinued
                } else {
                    crate::events::DelegationOutcome::BackgroundStarted
                });
                return result;
            }

            let child_session_id = started.child_session_id.clone();
            let generation = started.generation;
            let outcome = tokio::select! {
                outcome = controller.wait(&child_session_id, generation) => outcome,
                _ = context.cancellation(services.runtime).cancelled() => {
                    let cancel_controller = Arc::clone(&controller);
                    let cancel_parent = parent_session_id.clone();
                    let cancel_child = child_session_id.clone();
                    let cancellation = tokio::spawn(async move {
                        cancel_controller
                            .cancel(&cancel_parent, &cancel_child, generation)
                            .await
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
            }.await;
            result.delegation_summary = context.presentation_key_arg.clone();
            result
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
            match owned_child(services.runtime, parent_session_id, &input.child_session_id).await {
                Ok(child) => control_result(child),
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

    fn timeout(
        &self,
        _input: &mut serde_json::Value,
        requested: Option<Duration>,
    ) -> Result<ToolTimeout, ToolResult> {
        Ok(ToolTimeout {
            duration: requested.unwrap_or(super::kernel::DEFAULT_TOOL_TIMEOUT),
            disposition: ToolTimeoutDisposition::Settle,
            remote_outcome_uncertain: false,
        })
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
            let child = match owned_child(
                services.runtime,
                &parent_session_id,
                &input.child_session_id,
            )
            .await
            {
                Ok(child) => child,
                Err(error) => return ToolResult::text(format!("Error: {error:#}"), true),
            };
            match controller
                .cancel(
                    &parent_session_id,
                    &input.child_session_id,
                    child.generation,
                )
                .await
            {
                Ok(child) => control_result(child),
                Err(error) => ToolResult::text(format!("Error: {error:#}"), true),
            }
        })
    }
}

async fn owned_child(
    runtime: &super::ToolRuntime,
    parent_session_id: &str,
    child_session_id: &str,
) -> anyhow::Result<TraditionalChildRecord> {
    let path = runtime.store_path.clone();
    let parent = parent_session_id.to_owned();
    let child = child_session_id.to_owned();
    crate::store::call_legacy_store(&runtime.store_path, move || {
        crate::store::load_traditional_child_for_parent(&path, &parent, &child)?
            .ok_or_else(|| anyhow::anyhow!("traditional child was not found"))
    })
    .await?
}

/// A successful status or cancel operation reports a child outcome without
/// turning that outcome into a failure of the operation itself.
fn control_result(child: TraditionalChildRecord) -> ToolResult {
    let mut result = outcome_result(child);
    result.is_error = false;
    result
}

#[expect(
    clippy::expect_used,
    reason = "traditional child records contain only JSON-representable fields"
)]
fn outcome_result(child: TraditionalChildRecord) -> ToolResult {
    let is_error = matches!(
        child.status,
        TraditionalChildStatus::Failed
            | TraditionalChildStatus::Cancelled
            | TraditionalChildStatus::Interrupted
    );
    let outcome = match child.status {
        TraditionalChildStatus::Completed => Some(crate::events::DelegationOutcome::Completed),
        TraditionalChildStatus::Failed => Some(crate::events::DelegationOutcome::Failed),
        TraditionalChildStatus::Cancelled => Some(crate::events::DelegationOutcome::Cancelled),
        TraditionalChildStatus::Interrupted => Some(crate::events::DelegationOutcome::Interrupted),
        _ => None,
    };
    let mut result = ToolResult::text(
        serde_json::to_string(&child).expect("traditional child outcome serializes"),
        is_error,
    );
    result.delegation_outcome = outcome;
    result
}

#[cfg(test)]
#[path = "subagent_tests.rs"]
mod tests;
