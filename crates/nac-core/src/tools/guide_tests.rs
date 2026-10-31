use super::*;

#[tokio::test]
async fn guide_reads_are_offline_bound_and_policy_checked() {
    let client = crate::model::ModelClient::new_for_test();
    let mut runtime = crate::tools::test_runtime();
    runtime.workspace_cwd = "/a/workspace/that/does/not/exist".into();
    runtime.config_cwd = runtime.workspace_cwd.clone();
    let result = crate::tools::execute_tool(
        NAME,
        json!({"operation":"read","document_id":"mcp","section_id":"add-a-server"}),
        &runtime,
        &client,
    )
    .await;
    assert!(!result.is_error, "{}", result.content);
    let value: Value = serde_json::from_str(result.content.as_text().unwrap()).unwrap();
    assert!(value["result"]["text"]
        .as_str()
        .unwrap()
        .contains("mcp_servers"));
    assert_eq!(
        value["build_identity"]["product_version"],
        nac_contracts::PRODUCT_VERSION
    );
    assert_eq!(value["provenance"], "first-party bundled NAC Guide");
    // Unreachable descriptors prove retrieval never connects to the selected
    // backend. This tests portability, not live SSH/Podman infrastructure.
    for backend in [
        crate::sandbox::ExecutionBackend::Ssh(crate::sandbox::SshBackend::new(
            "unreachable.invalid".into(),
            "/remote/not-mounted".into(),
        )),
        crate::sandbox::ExecutionBackend::Sandbox(crate::sandbox::SandboxSession::new_for_test(
            crate::sandbox::SandboxSpec::default(),
        )),
    ] {
        runtime.backend = std::sync::Arc::new(backend);
        let remote = crate::tools::execute_tool(
            NAME,
            json!({"operation":"read","document_id":"skills","section_id":"discovery"}),
            &runtime,
            &client,
        )
        .await;
        assert!(!remote.is_error, "{}", remote.content);
        assert!(remote.content.contains(".nac/skills"));
    }
    for effect in [
        crate::permissions::PermissionEffect::Deny,
        crate::permissions::PermissionEffect::Ask,
    ] {
        runtime.permission_rules =
            std::sync::Arc::new(vec![crate::permissions::PermissionRule::new(
                NAME, "*", effect,
            )]);
        let denied =
            crate::tools::execute_tool(NAME, json!({"operation":"manifest"}), &runtime, &client)
                .await;
        assert!(denied.is_error);
        assert!(denied.content.contains("without a broker"));
    }
}

#[test]
fn stale_refs_unknown_topics_and_invalid_arguments_are_bounded() {
    let stale = retrieve(GuideInput::Manifest {
        expected_fingerprint: Some("0".repeat(64)),
    })
    .unwrap();
    assert_eq!(stale["status"], "version_mismatch");
    let unknown = retrieve(GuideInput::Index {
        query: Some("quux_unpublished_feature".into()),
        limit: None,
        expected_fingerprint: None,
    })
    .unwrap();
    assert_eq!(unknown["result"]["status"], "unknown_topic");
    for input in [
        json!({"operation":"read","document_id":"../../secret"}),
        json!({"operation":"index","query":"x".repeat(513)}),
        json!({"operation":"manifest","url":"https://example.com"}),
        json!({"operation":"index","limit":0}),
    ] {
        assert!(GuideTool.decode(input).is_err());
    }
    let outline = retrieve(GuideInput::Read {
        document_id: "mcp".into(),
        section_id: None,
        offset: None,
        max_bytes: None,
        expected_fingerprint: None,
    })
    .unwrap();
    assert!(outline["result"]["sections"].as_array().unwrap().len() > 1);
    assert!(outline["result"].get("text").is_none());
}
