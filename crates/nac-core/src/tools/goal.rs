use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::store::GoalStatus;
use crate::tools::kernel::{
    NativeTool, PermissionResource, ToolAdmission, ToolCallContext, ToolServices,
};
use crate::tools::mutation::argument_error;
use crate::tools::ToolResult;
use crate::types::{FunctionDef, ToolDefinition};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct CreateGoalInput {
    objective: String,
    token_budget: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct GetGoalInput {}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct UpdateGoalInput {
    goal_id: String,
    status: GoalStatus,
}

fn definition(name: &str, description: &str, parameters: Value) -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: name.to_string(),
            description: description.to_string(),
            parameters,
        },
    }
}

fn goal_runtime(services: ToolServices<'_>) -> Result<&crate::goals::GoalRuntime, ToolResult> {
    services
        .runtime
        .goal_runtime
        .as_deref()
        .ok_or_else(|| ToolResult::text("Error: durable goals are unavailable", true))
}

fn result(value: impl serde::Serialize) -> ToolResult {
    match serde_json::to_string(&value) {
        Ok(value) => ToolResult::text(value, false),
        Err(error) => ToolResult::text(format!("Error: failed to serialize goal: {error}"), true),
    }
}

fn error(error: anyhow::Error) -> ToolResult {
    ToolResult::text(format!("Error: {error:#}"), true)
}

pub(crate) struct CreateGoalTool;

impl NativeTool for CreateGoalTool {
    type Input = CreateGoalInput;

    fn definition(&self) -> ToolDefinition {
        definition(
            "create_goal",
            "Create and activate a durable multi-turn goal only when the user explicitly requested one. Do not infer goals from ordinary tasks. A session may have only one unfinished goal.",
            json!({
                "type": "object",
                "properties": {
                    "objective": { "type": "string", "minLength": 1 },
                    "token_budget": { "type": "integer", "minimum": 1, "description": "Optional total billable-token budget. Omit unless explicitly requested." }
                },
                "required": ["objective"],
                "additionalProperties": false
            }),
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Exclusive
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        serde_json::from_value(input)
            .map_err(|error| argument_error(format!("invalid create_goal arguments: {error}")))
    }

    fn permission_resources(
        &self,
        _input: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(vec![PermissionResource::new(
            "goal_create",
            services
                .runtime
                .session_id
                .as_deref()
                .unwrap_or("unpersisted"),
        )])
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            match goal_runtime(services).and_then(|runtime| {
                runtime
                    .create(&input.objective, input.token_budget)
                    .map_err(error)
            }) {
                Ok(goal) => result(goal),
                Err(error) => error,
            }
        })
    }
}

pub(crate) struct GetGoalTool;

impl NativeTool for GetGoalTool {
    type Input = GetGoalInput;

    fn definition(&self) -> ToolDefinition {
        definition(
            "get_goal",
            "Read the current durable goal, including status, accounting, and remaining optional token budget.",
            json!({ "type": "object", "properties": {}, "additionalProperties": false }),
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        serde_json::from_value(input)
            .map_err(|error| argument_error(format!("invalid get_goal arguments: {error}")))
    }

    fn permission_resources(
        &self,
        _input: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(vec![PermissionResource::new(
            "goal_read",
            services
                .runtime
                .session_id
                .as_deref()
                .unwrap_or("unpersisted"),
        )])
    }

    fn execute<'a>(
        &'a self,
        _input: Self::Input,
        services: ToolServices<'a>,
        _context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            match goal_runtime(services).and_then(|runtime| runtime.get().map_err(error)) {
                Ok(goal) => result(goal),
                Err(error) => error,
            }
        })
    }
}

pub(crate) struct UpdateGoalTool;

impl NativeTool for UpdateGoalTool {
    type Input = UpdateGoalInput;

    fn definition(&self) -> ToolDefinition {
        definition(
            "update_goal",
            "Mark the current goal complete only when its objective is genuinely achieved with no required work remaining, or blocked only at a genuine impasse. The model cannot pause, resume, or limit a goal.",
            json!({
                "type": "object",
                "properties": {
                    "goal_id": { "type": "string", "minLength": 1 },
                    "status": { "type": "string", "enum": ["complete", "blocked"] }
                },
                "required": ["goal_id", "status"],
                "additionalProperties": false
            }),
        )
    }

    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Exclusive
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        let input: UpdateGoalInput = serde_json::from_value(input)
            .map_err(|error| argument_error(format!("invalid update_goal arguments: {error}")))?;
        if !matches!(input.status, GoalStatus::Complete | GoalStatus::Blocked) {
            return Err(argument_error("'status' must be 'complete' or 'blocked'"));
        }
        Ok(input)
    }

    fn permission_resources(
        &self,
        _input: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(vec![PermissionResource::new(
            "goal_update",
            services
                .runtime
                .session_id
                .as_deref()
                .unwrap_or("unpersisted"),
        )])
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        services: ToolServices<'a>,
        _context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            match goal_runtime(services).and_then(|runtime| {
                runtime
                    .update_model(&input.goal_id, input.status)
                    .map_err(error)
            }) {
                Ok(goal) => result(goal),
                Err(error) => error,
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    #[tokio::test]
    async fn model_boundary_create_get_and_update_share_durable_goal_state() {
        let path = std::env::temp_dir()
            .join(format!("nac-goal-tool-{}", uuid::Uuid::new_v4()))
            .join("store.db");
        crate::store::initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "direct");
        let connection = crate::store::open_runtime_connection(&path).unwrap();
        connection
            .execute(
                "UPDATE sessions SET behavior = 'direct' WHERE session_id = 'direct'",
                [],
            )
            .unwrap();
        drop(connection);

        let mut runtime = crate::tools::test_runtime();
        runtime.store_path = path.clone();
        runtime.session_id = Some("direct".to_string());
        let goals = Arc::new(crate::goals::GoalRuntime::new(
            path.clone(),
            "direct".to_string(),
        ));
        goals.begin_run("run-1");
        runtime.goal_runtime = Some(goals);
        runtime.allowed_tools = None;
        let client = crate::model::ModelClient::new_for_test();

        let created = crate::tools::execute_tool(
            "create_goal",
            json!({"objective":"explicit objective"}),
            &runtime,
            &client,
        )
        .await;
        assert!(!created.is_error, "{:?}", created.content.as_text());
        let created: crate::store::SessionGoalRecord =
            serde_json::from_str(created.content.as_text().unwrap()).unwrap();
        assert_eq!(created.status, GoalStatus::Active);

        let read = crate::tools::execute_tool("get_goal", json!({}), &runtime, &client).await;
        let read: Option<crate::store::SessionGoalRecord> =
            serde_json::from_str(read.content.as_text().unwrap()).unwrap();
        assert_eq!(read.unwrap().goal_id, created.goal_id);

        let blocked = crate::tools::execute_tool(
            "update_goal",
            json!({"goal_id":created.goal_id,"status":"blocked"}),
            &runtime,
            &client,
        )
        .await;
        assert!(!blocked.is_error);
        let blocked: crate::store::SessionGoalRecord =
            serde_json::from_str(blocked.content.as_text().unwrap()).unwrap();
        assert_eq!(blocked.status, GoalStatus::Blocked);
        assert!(
            crate::tools::execute_tool(
                "update_goal",
                json!({"goal_id":blocked.goal_id,"status":"paused"}),
                &runtime,
                &client,
            )
            .await
            .is_error
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
