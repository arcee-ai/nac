use super::*;
use crate::tests::{seed_direct_session, test_manager};

#[tokio::test]
async fn passive_context_is_sanitized_scoped_and_does_not_attach() {
    let root = std::env::temp_dir().join(format!("nac-context-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let _env = crate::tests::ScopedModelEnv::isolated(&root.join("nac-home"), None);
    seed_direct_session(&root, "current");
    let path = root.join("store.db");
    let mut snapshot = sessions::load_session(&path, "current").unwrap();
    snapshot.api_key_env = Some("secret-selector-canary".into());
    snapshot
        .extra_headers
        .insert("Authorization".into(), "credential-canary".into());
    snapshot.base_url = "https://secret-endpoint-canary.example/v1".into();
    snapshot.model = "private-model-canary".into();
    sessions::update_session_config(&path, &snapshot).unwrap();
    let manager = test_manager(&root);
    let app = ProductContextApplication::new(manager.clone());
    let before = sessions::load_session(&path, "current").unwrap();
    let context = app.read(Some("current")).await.unwrap();
    let json = serde_json::to_string(&context).unwrap();
    for secret in [
        "secret-selector-canary",
        "credential-canary",
        "secret-endpoint-canary",
        "private-model-canary",
    ] {
        assert!(!json.contains(secret));
    }
    assert!(!json.contains(root.to_str().unwrap()));
    let session = context.session.unwrap();
    assert_eq!(session.behavior, sessions::SessionBehavior::Direct);
    assert_eq!(session.execution_backend, ProductExecutionBackend::Local);
    assert_eq!(session.skills.availability, ProductAvailability::Unknown);
    assert!(manager.inner.active_sessions.read().await.is_empty());
    let request = ProductNavigationRequest {
        destination: ProductDestination::McpSettings,
        session_id: Some("current".into()),
        expected_build_id: context.build.build_id,
    };
    let resolution = app.resolve(request.clone()).await.unwrap();
    assert!(!resolution.opened);
    assert_eq!(
        resolution.target.availability,
        ProductAvailability::Available
    );
    assert!(manager.inner.active_sessions.read().await.is_empty());
    let after = sessions::load_session(&path, "current").unwrap();
    assert_eq!(before.config_version, after.config_version);
    assert_eq!(before.updated_at, after.updated_at);
    assert_eq!(before.messages.len(), after.messages.len());
    assert!(app.read(Some("other-owner")).await.is_err());
    let mut stale = request;
    stale.expected_build_id = "old-build".into();
    assert!(app.resolve(stale).await.is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn selected_backends_and_availability_keep_distinct_meanings() {
    assert_eq!(
        execution_backend(false, false),
        ProductExecutionBackend::Local
    );
    assert_eq!(execution_backend(false, true), ProductExecutionBackend::Ssh);
    assert_eq!(
        execution_backend(true, false),
        ProductExecutionBackend::Podman
    );
    assert_eq!(observed(None).availability, ProductAvailability::Unknown);
    assert_eq!(
        observed(Some(0)).availability,
        ProductAvailability::Disabled
    );
    assert_eq!(
        observed(Some(2)).availability,
        ProductAvailability::Available
    );
}

#[test]
fn arbitrary_urls_selectors_and_mutation_fields_are_not_navigation() {
    for destination in [
        "https://evil.example",
        "nac://settings",
        "#mcp",
        "save-key",
        "launch-session",
    ] {
        let value = serde_json::json!({"destination": destination, "session_id": null, "expected_build_id": "build"});
        assert!(serde_json::from_value::<ProductNavigationRequest>(value).is_err());
    }
    let value = serde_json::json!({"destination": "mcp-settings", "session_id": null,
        "expected_build_id": "build", "human": true});
    assert!(serde_json::from_value::<ProductNavigationRequest>(value).is_err());
}

#[tokio::test]
async fn persisted_backend_facts_do_not_probe_or_resume_local_ssh_or_podman() {
    let root = std::env::temp_dir().join(format!("nac-context-backends-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let _env = crate::tests::ScopedModelEnv::isolated(&root.join("nac-home"), None);
    let path = root.join("store.db");
    for (id, backend) in [
        ("local", ProductExecutionBackend::Local),
        ("ssh", ProductExecutionBackend::Ssh),
        ("podman", ProductExecutionBackend::Podman),
    ] {
        let mut snapshot = sessions::new_snapshot(
            id.into(),
            root.clone(),
            "model".into(),
            "https://api.openai.com/v1".into(),
            nac_core::model::BackendKind::OpenAiResponses,
            None,
            if backend == ProductExecutionBackend::Podman {
                Some(Default::default())
            } else {
                None
            },
            if backend == ProductExecutionBackend::Ssh {
                Some(nac_core::runtime::SshConnection::new(
                    "inaccessible-host-canary",
                ))
            } else {
                None
            },
            Vec::new(),
            None,
            std::collections::BTreeMap::new(),
        );
        snapshot.behavior = sessions::SessionBehavior::Direct;
        sessions::create_session(&path, &snapshot).unwrap();
    }
    let manager = test_manager(&root);
    let app = ProductContextApplication::new(manager.clone());
    for (id, expected) in [
        ("local", ProductExecutionBackend::Local),
        ("ssh", ProductExecutionBackend::Ssh),
        ("podman", ProductExecutionBackend::Podman),
    ] {
        let context = app.read(Some(id)).await.unwrap();
        assert!(!serde_json::to_string(&context)
            .unwrap()
            .contains("inaccessible-host-canary"));
        assert_eq!(context.session.unwrap().execution_backend, expected);
    }
    assert!(manager.inner.active_sessions.read().await.is_empty());
    drop(app);
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}
