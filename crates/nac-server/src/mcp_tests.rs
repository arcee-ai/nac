use super::*;
use rmcp::model::{ClientCapabilities, ClientConfig, ProtocolVersion};

#[test]
fn create_session_schema_exposes_optional_project_id() {
    let schema = serde_json::to_value(schemars::schema_for!(CreateSessionParams)).unwrap();
    let properties = schema["properties"].as_object().unwrap();
    assert!(properties.contains_key("project_id"));
    assert!(properties.contains_key("cwd"));
    assert!(!schema["required"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|field| field == "project_id"));
}

#[test]
fn inbound_mcp_identity_uses_injected_product_version() {
    let info = mcp_server_info_for_version("9.8.7");

    assert_eq!(info.server_info.name, "nac_server");
    assert_eq!(info.server_info.version, "9.8.7");
    assert!(info.capabilities.tools.is_some());
    assert_eq!(info.instructions.as_deref(), Some(NAC_MCP_INSTRUCTIONS));
    assert_eq!(info.protocol_version, ProtocolVersion::LATEST);
    assert!(!info.protocol_version.has_initialize());
}

#[test]
fn inbound_mcp_router_preserves_orchestration_and_adds_passive_product_tools() {
    let names = NacMcpService::tool_router()
        .list_all()
        .into_iter()
        .map(|tool| tool.name.into_owned())
        .collect::<Vec<_>>();

    assert_eq!(
        names,
        vec![
            "create_session",
            "get_messages",
            "get_product_context",
            "get_session_status",
            "get_thread_episodes",
            "get_thread_events",
            "list_models",
            "list_sessions",
            "resolve_product_destination",
            "send_message",
            "session_action",
            "steer",
            "update_session",
        ]
    );
}

#[test]
fn rmcp_versions_separate_legacy_initialization_from_current_discovery() {
    let request = ClientConfig::new(
        ClientCapabilities::default(),
        Implementation::new("compatibility-test", "1.0.0"),
    )
    .with_protocol_version(ProtocolVersion::LATEST_WITH_INITIALIZE);

    assert!(request.protocol_version.has_initialize());
    assert_eq!(request.protocol_version, ProtocolVersion::V_2025_11_25);
    assert_eq!(ProtocolVersion::LATEST, ProtocolVersion::V_2026_07_28);
    assert!(!ProtocolVersion::LATEST.has_initialize());
}
