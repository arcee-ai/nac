//! Prepared model/native reads over a construction-bound product port.
use super::kernel::{NativeTool, PermissionResource, ToolAdmission, ToolCallContext, ToolServices};
use super::ToolResult;
use crate::product_context::{ProductContextPort, ProductDestination};
use crate::types::{FunctionDef, ToolDefinition};
use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ReadInput {}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ResolveInput {
    destination: ProductDestination,
    expected_build_id: String,
}
pub(crate) struct ReadTool;
pub(crate) struct ResolveTool;

fn definition(
    name: &str,
    description: &str,
    properties: Value,
    required: &[&str],
) -> ToolDefinition {
    ToolDefinition {
        def_type: "function".into(),
        function: FunctionDef {
            name: name.into(),
            description: description.into(),
            parameters: json!({
                "type": "object", "properties": properties, "required": required, "additionalProperties": false,
            }),
        },
    }
}
fn port(services: ToolServices<'_>) -> Result<&dyn ProductContextPort, ToolResult> {
    services
        .runtime
        .product_context
        .as_deref()
        .ok_or_else(|| ToolResult::text("Product context is unavailable in this runtime.", true))
}
fn resource(services: ToolServices<'_>, action: &str) -> Vec<PermissionResource> {
    let mut resource = PermissionResource::new(
        action,
        services
            .runtime
            .session_id
            .as_deref()
            .unwrap_or("unpersisted"),
    );
    resource.save_resource = None;
    if services.runtime.product_context.is_none() {
        resource.hard_denial = Some("Product context is unavailable in this runtime.".into());
    }
    if services.runtime.permission_broker.is_none() {
        use crate::permissions::{PermissionBackend, PermissionEffect, PermissionPolicy};
        let policy = PermissionPolicy::for_backend(
            PermissionBackend::from_execution_backend(services.runtime.backend.as_ref()),
            services.runtime.permission_rules.iter().cloned(),
        );
        match policy.evaluate(std::slice::from_ref(&resource), &[]).effect {
            PermissionEffect::Allow => {}
            PermissionEffect::Deny => resource.hard_denial = Some("Product context is denied by permission policy.".into()),
            PermissionEffect::Ask => resource.hard_denial = Some("Product context requires interactive approval, but this runtime has no approval broker.".into()),
        }
    }
    vec![resource]
}
fn result<T: serde::Serialize>(result: anyhow::Result<T>) -> ToolResult {
    match result.and_then(|value| Ok(serde_json::to_string(&value)?)) {
        Ok(value) => ToolResult::text(value, false),
        Err(_) => ToolResult::text("Product context or destination unavailable; inspect the current product context again.", true),
    }
}
impl NativeTool for ReadTool {
    type Input = ReadInput;
    fn definition(&self) -> ToolDefinition {
        definition("get_product_context", "Read sanitized NAC build, current-session behavior, selected execution backend and capability availability. Passive: never attaches, recovers or starts work. Availability is not authorization.", json!({}), &[])
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }
    fn decode(&self, input: Value) -> Result<ReadInput, ToolResult> {
        serde_json::from_value(input)
            .map_err(|_| ToolResult::text("Invalid product-context arguments.", true))
    }
    fn permission_resources(
        &self,
        _: &ReadInput,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(resource(services, "product_context_read"))
    }
    fn execute<'a>(
        &'a self,
        _: ReadInput,
        services: ToolServices<'a>,
        _: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            match port(services) {
                Ok(port) => result(port.read().await),
                Err(error) => error,
            }
        })
    }
}
impl NativeTool for ResolveTool {
    type Input = ResolveInput;
    fn definition(&self) -> ToolDefinition {
        definition("resolve_product_destination", "On an explicit navigation request, resolve a typed destination for this session/build. Returns a logical target and steps; no browser is attached to this tool, so it never claims to open one. Does not submit forms or start work. Answer text and Markdown do not execute navigation.", json!({
            "destination": {"type": "string", "enum": ProductDestination::ALL},
            "expected_build_id": {"type": "string", "description": "build_id returned by get_product_context"},
        }), &["destination", "expected_build_id"])
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }
    fn decode(&self, input: Value) -> Result<ResolveInput, ToolResult> {
        serde_json::from_value(input)
            .map_err(|_| ToolResult::text("Invalid product-destination arguments.", true))
    }
    fn permission_resources(
        &self,
        _: &ResolveInput,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        Ok(resource(services, "product_destination_read"))
    }
    fn execute<'a>(
        &'a self,
        input: ResolveInput,
        services: ToolServices<'a>,
        _: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            match port(services) {
                Ok(port) => result(
                    port.resolve(input.destination, input.expected_build_id)
                        .await,
                ),
                Err(error) => error,
            }
        })
    }
}
