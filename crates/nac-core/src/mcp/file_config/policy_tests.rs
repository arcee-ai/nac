use super::*;

fn temp_config() -> PathBuf {
    crate::mcp::test_support::unique_temp_dir("nac-mcp-file-config-policy").join("config.toml")
}

fn http_server(name: &str) -> McpServerConfigurationRecord {
    McpServerConfigurationRecord {
        name: name.to_string(),
        enabled: true,
        transport: MCP_TRANSPORT_STREAMABLE_HTTP.to_string(),
        url: Some("https://mcp.example.com/mcp".to_string()),
        headers: BTreeMap::from([(
            "Authorization".to_string(),
            "Bearer secret-token".to_string(),
        )]),
        library_id: Some("example".to_string()),
        allowed_tools: Some(vec!["read".to_string(), "publish".to_string()]),
        denied_tools: vec!["publish".to_string()],
        approval: McpToolApproval::Allow,
        tool_approvals: BTreeMap::from([("read".to_string(), McpToolApproval::Ask)]),
        ..McpServerConfigurationRecord::default()
    }
}

#[test]
fn crud_roundtrip_preserves_tool_policy() {
    let path = temp_config();

    let created = insert_mcp_server_configuration(&path, http_server("example")).unwrap();
    assert_eq!(created.name, "example");
    assert_eq!(created.url.as_deref(), Some("https://mcp.example.com/mcp"));
    assert!(created.enabled);
    assert_eq!(
        created.allowed_tools.as_deref(),
        Some(&["read".to_string(), "publish".to_string()][..])
    );
    assert_eq!(created.approval, McpToolApproval::Allow);
    assert_eq!(created.tool_approvals["read"], McpToolApproval::Ask);

    let listed = list_mcp_server_configurations(&path).unwrap();
    assert_eq!(listed, vec![created.clone()]);

    let mut edited = http_server("renamed");
    edited.enabled = false;
    let updated = update_mcp_server_configuration(&path, "example", edited).unwrap();
    assert_eq!(updated.name, "renamed");
    assert!(!updated.enabled);
    assert_eq!(
        load_mcp_server_configuration(&path, "renamed").unwrap(),
        updated
    );

    assert!(delete_mcp_server_configuration(&path, "renamed").unwrap());
    assert!(list_mcp_server_configurations(&path).unwrap().is_empty());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
