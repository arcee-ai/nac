use super::test_support::start_partial_catalog_http_mcp_server;
use super::*;

#[tokio::test]
async fn probe_keeps_required_tools_when_optional_catalogs_fail() {
    let (url, server) = start_partial_catalog_http_mcp_server();
    let config = McpServerConfig {
        enabled: true,
        library_id: None,
        required: false,
        startup_timeout_ms: None,
        catalog_timeout_ms: None,
        execution_timeout_ms: None,
        allowed_tools: None,
        denied_tools: Vec::new(),
        approval: McpToolApproval::Ask,
        tool_approvals: BTreeMap::new(),
        transport: McpTransportConfig::StreamableHttp {
            url,
            headers: BTreeMap::from([("Authorization".into(), "Bearer partial-secret".into())]),
            env_headers: BTreeMap::new(),
            bearer_token_env_var: None,
            header_helper: None,
        },
    };

    let result = probe_mcp_server(
        "partial",
        &config,
        &McpDefaults::default(),
        Path::new("/tmp"),
    )
    .await
    .unwrap();

    assert_eq!(result.tools.len(), 1);
    assert_eq!(result.tools[0].name, "echo");
    assert_eq!(
        result.instructions.as_deref(),
        Some("Use [REDACTED] for requests")
    );
    assert_eq!(result.prompt_count, 0);
    assert_eq!(result.resource_count, 0);
    assert_eq!(result.resource_template_count, 0);
    assert_eq!(
        result.catalog_warnings,
        [
            "prompt listing failed",
            "resource listing failed",
            "resource-template listing failed"
        ]
    );
    server.join().unwrap();
}

#[test]
fn probe_errors_redact_configured_values() {
    let redactor = McpRedactor::new(vec!["secret-value".to_string()]);
    let error = redacted_probe_error(
        &redactor,
        anyhow::anyhow!("connection rejected secret-value"),
    );

    assert_eq!(error.to_string(), "connection rejected [REDACTED]");
}

#[test]
fn no_roots_policy_advertises_no_file_roots_for_tilde_remote_cwd() {
    let roots = mcp_roots_for_policy(Path::new("~"), None, McpRootPolicy::None).unwrap();
    assert!(roots.is_empty());
}

#[test]
fn workspace_roots_preserve_existing_local_file_root_behavior() {
    let cwd = std::env::current_dir().unwrap();
    let roots = mcp_roots_for_policy(&cwd, None, McpRootPolicy::Workspace).unwrap();
    assert_eq!(roots.len(), 1);
    assert!(roots[0].uri.starts_with("file://"));
    assert_eq!(
        roots[0].name.as_deref(),
        cwd.file_name()
            .and_then(|value| value.to_str())
            .or(Some("workspace"))
    );
}
