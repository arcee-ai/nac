use super::*;

#[tokio::test]
async fn oauth_callback_listener_accepts_localhost_on_both_ip_families() {
    let listeners = OAuthCallbackListeners::bind(0).await.unwrap();
    let port = listeners.ipv4.local_addr().unwrap().port();

    let ipv4 = TcpStream::connect(("127.0.0.1", port));
    let (connected, accepted) = tokio::join!(ipv4, listeners.accept());
    connected.unwrap();
    accepted.unwrap();

    if listeners.ipv6.is_some() {
        let ipv6 = TcpStream::connect(("::1", port));
        let (connected, accepted) = tokio::join!(ipv6, listeners.accept());
        connected.unwrap();
        accepted.unwrap();
    }
}

#[test]
fn oauth_callback_target_rejects_unrelated_and_malformed_requests() {
    assert_eq!(
        oauth_callback_request_target(
            b"GET /mcp_library/oauth/callback?code=test&state=test HTTP/1.1\r\nHost: localhost\r\n\r\n"
        ),
        Some("/mcp_library/oauth/callback?code=test&state=test")
    );
    assert_eq!(
        oauth_callback_request_target(b"GET / HTTP/1.1\r\n\r\n"),
        None
    );
    assert_eq!(
        oauth_callback_request_target(b"POST /mcp_library/oauth/callback HTTP/1.1\r\n\r\n"),
        None
    );
    assert_eq!(oauth_callback_request_target(b"not http"), None);
}

#[test]
fn recoverable_publication_conflicts_remain_http_conflicts() {
    let error: ApiError = McpServerConfigurationStoreError::RecoveryRequired {
        config: PathBuf::from("/tmp/config.toml"),
        preserved: PathBuf::from("/tmp/config.toml.saved.tmp"),
    }
    .into();
    assert_eq!(error.status, StatusCode::CONFLICT);
    assert!(error.message.contains("removes the preserved file"));
    assert!(error.message.contains("byte-identical"));
}

#[test]
fn references_pass_through_and_literals_are_masked() {
    assert_eq!(redact_value("${GITHUB_TOKEN}"), "${GITHUB_TOKEN}");
    assert_eq!(redact_value("Bearer ${GITHUB_TOKEN}"), "****");
    assert_eq!(redact_value("sk-secret${odd"), "****");
    assert_eq!(redact_value("sk-1234567890abcdef"), "****cdef");
    assert_eq!(redact_value("short"), "****");
}

#[test]
fn create_request_allows_omitted_tool_policy_fields() {
    let request: CreateMcpServerRequest = serde_json::from_value(serde_json::json!({
        "name": "example",
        "transport": MCP_TRANSPORT_STDIO,
        "command": "example"
    }))
    .unwrap();

    assert!(request.allowed_tools.is_none());
    assert!(request.denied_tools.is_empty());
    assert_eq!(request.approval, McpToolApproval::Ask);
    assert!(request.tool_approvals.is_empty());
    assert_eq!(request.protocol, McpProtocolSelection::Legacy);
}

#[test]
fn create_request_and_view_preserve_an_explicit_protocol_mode() {
    let request: CreateMcpServerRequest = serde_json::from_value(serde_json::json!({
        "name": "current",
        "protocol": "current",
        "transport": MCP_TRANSPORT_STREAMABLE_HTTP,
        "url": "https://example.test/mcp"
    }))
    .unwrap();
    assert_eq!(request.protocol, McpProtocolSelection::Current);

    let record = McpServerConfigurationRecord {
        name: request.name,
        protocol: request.protocol,
        transport: request.transport,
        url: request.url,
        ..McpServerConfigurationRecord::default()
    };
    assert_eq!(view(record).protocol, McpProtocolSelection::Current);
}

#[test]
fn update_approval_null_resets_to_ask_and_omission_keeps_stored_value() {
    let cleared: UpdateMcpServerRequest =
        serde_json::from_value(serde_json::json!({ "approval": null })).unwrap();
    assert_eq!(
        approval_update(cleared.approval, McpToolApproval::Allow),
        McpToolApproval::Ask
    );

    let omitted: UpdateMcpServerRequest = serde_json::from_value(serde_json::json!({})).unwrap();
    assert_eq!(
        approval_update(omitted.approval, McpToolApproval::Allow),
        McpToolApproval::Allow
    );
}

#[test]
fn merge_map_keeps_stored_values_for_null_entries() {
    let stored = BTreeMap::from([("Authorization".to_string(), "Bearer real".to_string())]);
    let sent = BTreeMap::from([
        ("Authorization".to_string(), None),
        ("X-Extra".to_string(), Some("literal".to_string())),
    ]);
    let merged = merge_map(sent, &stored).unwrap();
    assert_eq!(merged.get("Authorization").unwrap(), "Bearer real");
    assert_eq!(merged.get("X-Extra").unwrap(), "literal");

    let missing = BTreeMap::from([("Unknown".to_string(), None)]);
    assert!(merge_map(missing, &stored).is_err());
}

#[test]
fn header_helper_environment_is_redacted_in_views() {
    let record = McpServerConfigurationRecord {
        name: "remote".to_string(),
        enabled: true,
        transport: MCP_TRANSPORT_STREAMABLE_HTTP.to_string(),
        url: Some("https://example.com/mcp".to_string()),
        header_helper: Some(McpHeaderHelperConfig {
            command: "refresh".to_string(),
            env: BTreeMap::from([
                ("TOKEN".to_string(), "literal-super-secret".to_string()),
                ("REFERENCE".to_string(), "${SAFE_REFERENCE}".to_string()),
            ]),
            ..McpHeaderHelperConfig::default()
        }),
        ..McpServerConfigurationRecord::default()
    };
    let helper = view(record).header_helper.unwrap();
    assert_eq!(helper.env["TOKEN"], "****cret");
    assert_eq!(helper.env["REFERENCE"], "${SAFE_REFERENCE}");
}

#[test]
fn borrowed_http_credentials_are_bound_to_the_stored_origin() {
    let record = McpServerConfigurationRecord {
        name: "remote".to_string(),
        enabled: true,
        transport: MCP_TRANSPORT_STREAMABLE_HTTP.to_string(),
        url: Some("https://trusted.example/mcp".to_string()),
        ..McpServerConfigurationRecord::default()
    };

    require_stored_http_origin(true, Some(&record), "https://trusted.example/mcp").unwrap();
    assert!(require_stored_http_origin(true, Some(&record), "https://other.example/mcp").is_err());
    assert!(require_stored_http_origin(true, None, "https://trusted.example/mcp").is_err());
    require_stored_http_origin(false, Some(&record), "https://other.example/mcp").unwrap();
}

#[test]
fn remote_oauth_callback_uses_only_the_configured_origin() {
    assert_eq!(
        remote_callback_uri("https://nac.example.test", "team/slack").unwrap(),
        "https://nac.example.test/mcp_library/servers/team%2Fslack/oauth/callback"
    );
    for rejected in [
        "http://nac.example.test",
        "https://user@nac.example.test",
        "https://nac.example.test/prefix",
        "https://nac.example.test?forwarded=evil.example",
    ] {
        assert!(
            remote_callback_uri(rejected, "slack").is_err(),
            "{rejected}"
        );
    }
}
