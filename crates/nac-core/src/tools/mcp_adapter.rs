use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;

use super::{kernel, ToolResult};
use crate::mcp::McpRegistry;
use crate::types::ToolDefinition;

struct McpTool {
    definition: ToolDefinition,
    registry: Arc<McpRegistry>,
    image_results: bool,
    execution_timeout: Duration,
}

impl kernel::NativeTool for McpTool {
    type Input = Value;

    fn definition(&self) -> ToolDefinition {
        self.definition.clone()
    }

    fn admission(&self) -> kernel::ToolAdmission {
        // Imported tools do not declare concurrency semantics. Keep the
        // conservative direct-session scheduling behavior.
        kernel::ToolAdmission::Exclusive
    }

    fn timeout(
        &self,
        _input: &mut Value,
        requested: Option<Duration>,
    ) -> Result<kernel::ToolTimeout, ToolResult> {
        Ok(kernel::ToolTimeout {
            duration: requested.unwrap_or(self.execution_timeout),
            disposition: kernel::ToolTimeoutDisposition::Bounded,
            remote_outcome_uncertain: true,
        })
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        match input {
            Value::Object(_) | Value::Null => Ok(input),
            _ => Err(ToolResult::text(
                format!(
                    "Error: MCP tool '{}' requires object arguments",
                    self.definition.function.name
                ),
                true,
            )),
        }
    }

    fn permission_resources(
        &self,
        _input: &Self::Input,
        _services: kernel::ToolServices<'_>,
    ) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
        Ok(vec![kernel::PermissionResource::new(
            "mcp_call",
            self.definition.function.name.clone(),
        )])
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        _services: kernel::ToolServices<'a>,
        _context: &'a kernel::ToolCallContext,
    ) -> futures_util::future::BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            self.registry
                .call_tool(&self.definition.function.name, input, self.image_results)
                .await
        })
    }
}

struct McpCapabilityTool {
    definition: ToolDefinition,
    registry: Arc<McpRegistry>,
}

impl kernel::NativeTool for McpCapabilityTool {
    type Input = Value;

    fn definition(&self) -> ToolDefinition {
        self.definition.clone()
    }

    fn admission(&self) -> kernel::ToolAdmission {
        kernel::ToolAdmission::Parallel
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        if input.is_object() {
            Ok(input)
        } else {
            Err(ToolResult::text(
                format!(
                    "Error: {} requires object arguments",
                    self.definition.function.name
                ),
                true,
            ))
        }
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        _services: kernel::ToolServices<'_>,
    ) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
        self.registry
            .capability_permission_resource(&self.definition.function.name, input)
            .map(|resource| vec![resource])
    }

    fn bind_authorized_resources(
        &self,
        input: &mut Self::Input,
        resources: &[kernel::PermissionResource],
        _services: kernel::ToolServices<'_>,
    ) -> Result<(), ToolResult> {
        let rebound = self
            .registry
            .capability_permission_resource(&self.definition.function.name, input)?;
        if resources != [rebound] {
            return Err(ToolResult::text(
                "Error: authorized MCP capability target changed before execution",
                true,
            ));
        }
        Ok(())
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        _services: kernel::ToolServices<'a>,
        _context: &'a kernel::ToolCallContext,
    ) -> futures_util::future::BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            self.registry
                .call_capability(&self.definition.function.name, input)
                .await
        })
    }
}

pub(super) async fn invoke(
    registry: Arc<McpRegistry>,
    name: &str,
    input: Value,
    services: kernel::ToolServices<'_>,
    context: &kernel::ToolCallContext,
) -> ToolResult {
    let Some(definition) = registry.tool_definition(name) else {
        return ToolResult::text(format!("Error: unknown MCP tool '{name}'"), true);
    };
    let snapshot = if registry.is_capability_tool(name) {
        capability_snapshot(definition, registry)
    } else {
        snapshot(
            definition,
            registry
                .execution_timeout(name)
                .unwrap_or(kernel::DEFAULT_TOOL_TIMEOUT),
            registry,
            services.client.supports_image_tool_results(),
        )
    };
    snapshot.invoke(name, input, services, context).await
}

#[expect(
    clippy::expect_used,
    reason = "a one-element MCP capability registry cannot collide or omit its element"
)]
fn capability_snapshot(
    definition: ToolDefinition,
    registry: Arc<McpRegistry>,
) -> kernel::ToolSnapshot {
    let name = definition.function.name.clone();
    kernel::ToolRegistry::builder()
        .register(McpCapabilityTool {
            definition,
            registry,
        })
        .finish()
        .expect("one MCP capability is collision-free")
        .snapshot([name.as_str()])
        .expect("the MCP capability was just registered")
}

#[expect(
    clippy::expect_used,
    reason = "a one-element imported capability registry cannot collide or omit its element"
)]
fn snapshot(
    definition: ToolDefinition,
    execution_timeout: Duration,
    registry: Arc<McpRegistry>,
    image_results: bool,
) -> kernel::ToolSnapshot {
    let name = definition.function.name.clone();
    kernel::ToolRegistry::builder()
        .register(McpTool {
            definition,
            registry,
            image_results,
            execution_timeout,
        })
        .finish()
        .expect("one imported MCP capability is collision-free")
        .snapshot([name.as_str()])
        .expect("the imported MCP capability was just registered")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::FunctionDef;

    #[tokio::test]
    async fn imported_tool_is_denied_by_policy_before_transport_execution() {
        let directory = std::env::temp_dir().join(format!(
            "nac-mcp-adapter-permission-{}",
            uuid::Uuid::new_v4()
        ));
        let store_path = directory.join("store.db");
        crate::store::initialize(&store_path).unwrap();
        crate::store::insert_test_session(&store_path, "session-a");
        let broker = Arc::new(crate::permissions::PermissionBroker::new(
            store_path.clone(),
            "session-a".to_string(),
            crate::permissions::PermissionBackend::Local,
            0,
            [crate::permissions::PermissionRule::new(
                "mcp_call",
                "mcp__fake__echo",
                crate::permissions::PermissionEffect::Deny,
            )],
        ));
        let mut runtime = crate::tools::test_runtime();
        runtime.store_path = store_path;
        runtime.session_id = Some("session-a".to_string());
        runtime.permission_broker = Some(broker);
        let client = crate::model::ModelClient::new_for_test();
        let snapshot = snapshot(
            ToolDefinition {
                def_type: "function".to_string(),
                function: FunctionDef {
                    name: "mcp__fake__echo".to_string(),
                    description: "test".to_string(),
                    parameters: serde_json::json!({"type":"object"}),
                },
            },
            kernel::DEFAULT_TOOL_TIMEOUT,
            Arc::new(McpRegistry::empty_for_test()),
            false,
        );
        let result = snapshot
            .invoke(
                "mcp__fake__echo",
                serde_json::json!({}),
                kernel::ToolServices {
                    runtime: &runtime,
                    client: &client,
                },
                &kernel::ToolCallContext::default(),
            )
            .await;

        assert!(result.is_error);
        assert!(result.content.to_string().contains("permission denied"));
        assert!(!result.content.to_string().contains("unknown MCP tool"));
        let _ = std::fs::remove_dir_all(directory);
    }

    #[tokio::test]
    async fn resource_read_is_denied_before_server_lookup_or_transport() {
        let directory = std::env::temp_dir().join(format!(
            "nac-mcp-resource-permission-{}",
            uuid::Uuid::new_v4()
        ));
        let store_path = directory.join("store.db");
        crate::store::initialize(&store_path).unwrap();
        crate::store::insert_test_session(&store_path, "session-a");
        let broker = Arc::new(crate::permissions::PermissionBroker::new(
            store_path.clone(),
            "session-a".to_string(),
            crate::permissions::PermissionBackend::Local,
            0,
            [crate::permissions::PermissionRule::new(
                "mcp_resource_read",
                "mcp:docs:resource:doc://private",
                crate::permissions::PermissionEffect::Deny,
            )],
        ));
        let mut runtime = crate::tools::test_runtime();
        runtime.store_path = store_path;
        runtime.session_id = Some("session-a".to_string());
        runtime.permission_broker = Some(broker);
        let client = crate::model::ModelClient::new_for_test();
        let registry = Arc::new(McpRegistry::empty_for_test());
        let definition = registry
            .tool_definition(crate::mcp::capabilities::READ_RESOURCE_TOOL)
            .expect("resource definition");
        let snapshot = capability_snapshot(definition, registry);
        let result = snapshot
            .invoke(
                crate::mcp::capabilities::READ_RESOURCE_TOOL,
                serde_json::json!({"server": "docs", "uri": "doc://private"}),
                kernel::ToolServices {
                    runtime: &runtime,
                    client: &client,
                },
                &kernel::ToolCallContext::default(),
            )
            .await;

        assert!(result.is_error);
        assert!(result.content.to_string().contains("permission denied"));
        assert!(!result.content.to_string().contains("unavailable"));
        let _ = std::fs::remove_dir_all(directory);
    }
}
