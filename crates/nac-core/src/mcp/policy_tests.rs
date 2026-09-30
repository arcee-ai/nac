use super::*;

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
