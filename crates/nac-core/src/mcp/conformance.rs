//! Official MCP client-conformance driver.
//!
//! This is feature-gated test support, not a user-facing client. It deliberately
//! exercises the same handler, lifecycle selection, transport, catalog parsing,
//! and high-level tool invocation path used by configured NAC sessions.

use super::*;

/// Runs the behavior requested by the official conformance runner.
pub async fn run_mcp_conformance_client(server_url: String) -> Result<()> {
    let scenario =
        env::var("MCP_CONFORMANCE_SCENARIO").context("MCP_CONFORMANCE_SCENARIO is required")?;
    if scenario.starts_with("auth/") {
        bail!("OAuth client conformance is owned outside ALL-131");
    }
    if scenario == "elicitation-sep1034-client-defaults" {
        bail!("interactive elicitation is not implemented by NAC's outbound MCP client");
    }

    let protocol = match env::var("MCP_CONFORMANCE_PROTOCOL_VERSION").as_deref() {
        Ok("2026-07-28") => McpProtocolSelection::Current,
        Ok(_) | Err(_) => McpProtocolSelection::Legacy,
    };
    let config = McpServerConfig {
        enabled: true,
        library_id: None,
        required: true,
        startup_timeout_ms: Some(30_000),
        catalog_timeout_ms: Some(30_000),
        execution_timeout_ms: Some(30_000),
        protocol,
        allowed_tools: None,
        denied_tools: Vec::new(),
        approval: McpToolApproval::Allow,
        tool_approvals: BTreeMap::new(),
        transport: McpTransportConfig::StreamableHttp {
            url: server_url,
            headers: BTreeMap::new(),
            env_headers: BTreeMap::new(),
            bearer_token_env_var: None,
            header_helper: None,
        },
    };
    let handler = NacMcpClientHandler::unbound(Vec::new());
    let mut service = connect_server(
        "official-conformance",
        &config,
        &handler,
        Path::new("."),
        Duration::from_secs(30),
    )
    .await?;

    let outcome = run_scenario(&service, &scenario).await;
    close_mcp_service(&mut service).await;
    outcome
}

async fn run_scenario(service: &McpService, scenario: &str) -> Result<()> {
    let tools = service.list_all_tools().await?;
    match scenario {
        "request-metadata" | "json-schema-ref-no-deref" => Ok(()),
        "http-custom-headers" => call_context_tools(service).await,
        "http-invalid-tool-headers" => {
            call_tool(
                service,
                "valid_tool",
                serde_json::json!({"region": "us-west1"}),
            )
            .await
        }
        "sep-2322-client-request-state" => {
            for name in [
                "test_mrtr_echo_state",
                "test_mrtr_unrelated",
                "test_mrtr_no_state",
                "test_mrtr_no_result_type",
            ] {
                call_tool(service, name, serde_json::json!({})).await?;
            }
            Ok(())
        }
        "http-standard-headers" => call_tool(service, "test_headers", serde_json::json!({})).await,
        "sse-retry" => call_tool(service, "test_reconnection", serde_json::json!({})).await,
        "initialize" => Ok(()),
        "tools_call" | "tools-call" => {
            call_tool(service, "add_numbers", serde_json::json!({"a": 2, "b": 3})).await
        }
        other => {
            let names = tools
                .iter()
                .map(|tool| tool.name.as_ref())
                .collect::<Vec<_>>()
                .join(", ");
            bail!("unsupported conformance scenario '{other}' (listed tools: {names})")
        }
    }
}

async fn call_context_tools(service: &McpService) -> Result<()> {
    let context = env::var("MCP_CONFORMANCE_CONTEXT")
        .context("MCP_CONFORMANCE_CONTEXT is required for custom-header coverage")?;
    let context: Value = serde_json::from_str(&context).context("invalid conformance context")?;
    let calls = context
        .get("toolCalls")
        .and_then(Value::as_array)
        .context("conformance context has no toolCalls array")?;
    for call in calls {
        let name = call
            .get("name")
            .and_then(Value::as_str)
            .context("conformance tool call has no name")?;
        let arguments = call
            .get("arguments")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        call_tool(service, name, arguments).await?;
    }
    Ok(())
}

async fn call_tool(service: &McpService, name: &str, arguments: Value) -> Result<()> {
    let arguments = arguments
        .as_object()
        .cloned()
        .context("conformance tool arguments must be an object")?;
    service
        .call_tool(CallToolRequestParams::new(name.to_string()).with_arguments(arguments))
        .await
        .with_context(|| format!("conformance tool call '{name}' failed"))?;
    Ok(())
}
