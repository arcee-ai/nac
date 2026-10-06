use super::*;
use std::path::PathBuf;

const KEY: &str = "static-native-key-canary";

struct Fixture {
    root: PathBuf,
    store: ManagedHostKeyStore,
    capability: TrustedManagedHostKey,
}

impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("nac-host-key-client-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let binding = ManagedHostKeyBinding {
            bootstrap_id: "4712bc5e-30d5-421a-b416-8291d9f7d8f9".into(),
            managed_host_id: "21856443-8ed8-40ab-9036-72e837c99f27".into(),
            host_incarnation_id: "cr-uid-1".into(),
            pvc_uid: "pvc-uid-1".into(),
            organization_id: "11670cb3-ea82-4f66-96ca-d5b6542f8c2a".into(),
            owner_epoch: 1,
            key_generation: 1,
            local_key_id: "00d61e35-4d17-4949-888f-5f153b03a53b".into(),
            key_id: "provider-key-1".into(),
            clerk_instance_id: "instance-test".into(),
            inference_origin: "https://api.arcee.ai".into(),
        };
        let mut wire = serde_json::to_value(&binding).unwrap();
        wire["version"] = json!(3);
        wire["credential_kind"] = json!("clerk_api_key");
        wire["scopes"] = json!(["managed:inference"]);
        wire["api_key"] = json!(KEY);
        let input = root.join("bootstrap.json");
        nac_credential_store::write_auth_string_to_path(&input, &wire.to_string()).unwrap();
        let store = ManagedHostKeyStore::new(&root);
        store.import(&binding, &input).unwrap();
        std::fs::remove_file(input).unwrap();
        let capability = TrustedManagedHostKey::new(&root, binding).unwrap();
        Self {
            root,
            store,
            capability,
        }
    }

    fn settings(&self) -> EffectiveModelSettings {
        let mut settings = EffectiveModelSettings::new(
            BackendKind::ArceeApi,
            "trinity-large-thinking".into(),
            "https://api.arcee.ai".into(),
            None,
            None,
            Default::default(),
        )
        .unwrap();
        settings.api_key_env = None;
        settings
            .with_trusted_managed_host_key(Some(self.capability.clone()))
            .unwrap()
    }

    fn client(&self) -> ModelClient {
        ModelClient::from_effective_settings(self.settings()).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[test]
fn managed_host_key_capability_does_not_escape_into_debug_or_worker_arguments() {
    let fixture = Fixture::new();
    let client = fixture.client();
    assert!(!format!("{client:?}").contains(KEY));
    assert!(!format!("{:?}", fixture.settings()).contains(KEY));
    let args = crate::tools::thread::worker_model_arguments_for_test(&client);
    assert!(!args.join(" ").contains(KEY));
    assert!(!args.join(" ").contains(fixture.root.to_str().unwrap()));
    assert!(!args
        .iter()
        .any(|arg| arg == "--managed-api-key-file" || arg == "--api-key-env"));
    let index = args
        .iter()
        .position(|arg| arg == "--managed-host-key-binding")
        .unwrap();
    let binding: ManagedHostKeyBinding = serde_json::from_str(&args[index + 1]).unwrap();
    assert_eq!(&binding, fixture.capability.binding());
}

#[test]
fn managed_host_key_client_rejects_modified_route_or_competing_selector() {
    let fixture = Fixture::new();
    for case in 0..5 {
        let mut settings = fixture.settings();
        match case {
            0 => settings.backend = BackendKind::OpenAiChatCompletions,
            1 => settings.base_url.push_str("/api/v1"),
            2 => settings.api_key_env = Some("ARCEE_API_KEY".into()),
            3 => settings.trusted_api_key_file = Some(fixture.root.join("other")),
            _ => settings.allow_insecure_http = true,
        }
        assert!(ModelClient::from_effective_settings(settings).is_err());
    }
}

#[tokio::test]
async fn managed_host_key_client_checks_revocation_and_corruption_before_each_request() {
    for corrupt in [false, true] {
        let fixture = Fixture::new();
        let mut client = fixture.client();
        let server = ScriptedServer::start_unexpected_request_server(Duration::from_millis(150));
        // Test-only loopback replaces the approved origin after real construction.
        client.base_url = server.base_url.clone();
        if corrupt {
            nac_credential_store::write_auth_string_to_path(
                &fixture.root.join("managed_host_key.json"),
                "{",
            )
            .unwrap();
        } else {
            fixture
                .store
                .record_revocation(fixture.capability.binding())
                .unwrap();
        }
        let error = client
            .send_turn(
                vec![Message::User {
                    content: "hello".into(),
                }],
                vec![],
            )
            .await
            .unwrap_err()
            .to_string();
        assert!(!error.contains(KEY));
        assert!(server.finish().is_empty());
    }
}

#[tokio::test]
async fn managed_host_key_http_failures_and_truncated_streams_are_not_replayed() {
    for response in [
        ScriptedResponse::json("503 Service Unavailable", KEY),
        ScriptedResponse::json("401 Unauthorized", KEY),
        ScriptedResponse::json("200 OK", "").drop_connection(),
    ] {
        let fixture = Fixture::new();
        let client = fixture.client();
        let server = ScriptedServer::start(vec![response]);
        let error = client
            .post_arcee_api_chat(
                &server.base_url,
                json!({"messages": []}),
                "reasoning_content",
                None,
            )
            .await
            .unwrap_err()
            .to_string();
        assert!(!error.contains(KEY), "{error}");
        let requests = server.finish();
        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0].headers["authorization"],
            format!("Bearer {KEY}")
        );
    }
    let fixture = Fixture::new();
    let client = fixture.client();
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        "data: {\"usage\":{}}\n\n",
    )
    .with_header("Content-Type", "text/event-stream")]);
    let sink = |_delta: ModelStreamDelta| {};
    assert!(client
        .post_arcee_api_chat(
            &server.base_url,
            json!({"messages": []}),
            "reasoning_content",
            Some(&sink)
        )
        .await
        .is_err());
    assert_eq!(server.finish().len(), 1);
}

#[test]
fn managed_host_key_new_session_resolution_carry_only_ephemeral_capability() {
    let fixture = Fixture::new();
    let options = crate::runtime::ModelOptions {
        backend: Some(BackendKind::ArceeApi),
        api_model: Some("trinity-large-thinking".into()),
        api_base_url: Some("https://api.arcee.ai".into()),
        trusted_managed_host_key: Some(fixture.capability.clone()),
        ..Default::default()
    };
    let settings =
        crate::runtime::effective_model_settings(&options, &crate::runtime::NacConfig::default())
            .unwrap();
    let client = ModelClient::from_effective_settings(settings).unwrap();
    assert_eq!(
        client.managed_host_key_binding(),
        Some(fixture.capability.binding())
    );
    let mut explicit = options;
    explicit.api_key_env = crate::runtime::OptionalModelOption::Value("ARCEE_API_KEY".into());
    assert!(crate::runtime::effective_model_settings(
        &explicit,
        &crate::runtime::NacConfig::default()
    )
    .is_err());
}

#[tokio::test]
#[expect(
    clippy::await_holding_lock,
    reason = "runtime construction reads process-wide config while other tests change its environment"
)]
async fn managed_host_key_survives_resume_without_serializing_or_replaying_secret() {
    use crate::runtime::*;
    let _guard = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let store_path = fixture.root.join("store.db");
    let config = NacConfig::default();
    let light = crate::light_model::TrustedLightCredential {
        backend: BackendKind::ArceeApi,
        base_url: "https://api.arcee.ai".into(),
        path: fixture.root.join("removed-bootstrap"),
        managed_host_key: Some(fixture.capability.clone()),
    };
    let created = build_run_config(
        RunOptions {
            workspace_cwd: fixture.root.clone(),
            config_cwd: None,
            worker_executable: None,
            store: StoreOptions {
                store_path: Some(store_path.clone()),
            },
            model: ModelOptions {
                backend: Some(BackendKind::ArceeApi),
                api_model: Some("trinity-large-thinking".into()),
                api_base_url: Some("https://api.arcee.ai".into()),
                trusted_managed_host_key: Some(fixture.capability.clone()),
                trusted_light_credential: Some(light.clone()),
                light_model: Some(crate::light_model::LightModelSettings {
                    model: "trinity-large-thinking".into(),
                    backend: Some(BackendKind::ArceeApi),
                    base_url: Some("https://api.arcee.ai".into()),
                    api_key_env: None,
                    reasoning_effort: None,
                }),
                ..Default::default()
            },
            orchestrator_compaction_threshold: None,
            sandbox: Default::default(),
            ssh: Default::default(),
        },
        &config,
    )
    .await
    .unwrap();
    let session_id = created.session.session_id().unwrap().to_string();
    assert_eq!(
        created.client.managed_host_key_binding(),
        Some(fixture.capability.binding())
    );
    assert!(created.agent.has_light_client_for_test());
    let resolved_light = crate::light_model::resolve_light_client_with_http_policy(
        &crate::light_model::LightModelSettings {
            model: "trinity-large-thinking".into(),
            backend: Some(BackendKind::ArceeApi),
            base_url: Some("https://api.arcee.ai".into()),
            api_key_env: None,
            reasoning_effort: None,
        },
        &Default::default(),
        Some(&light),
        false,
    )
    .unwrap();
    assert_eq!(
        resolved_light.managed_host_key_binding(),
        Some(fixture.capability.binding())
    );
    let snapshot = crate::sessions::load_session(&store_path, &session_id).unwrap();
    assert!(snapshot.api_key_env.is_none());
    assert!(!format!("{snapshot:?}").contains(KEY));
    for file in [store_path.clone(), store_path.with_extension("db-wal")] {
        if let Ok(bytes) = std::fs::read(file) {
            assert!(!String::from_utf8_lossy(&bytes).contains(KEY));
        }
    }
    drop(created);
    let options = ResumeModelOptions {
        trusted_managed_host_key: Some(fixture.capability.clone()),
        trusted_light_credential: Some(light),
        ..Default::default()
    };
    let resumed = build_resume_config_for_session(
        store_path.clone(),
        &session_id,
        &config,
        fixture.root.clone(),
        None,
        options.clone(),
    )
    .await
    .unwrap();
    assert_eq!(
        resumed.client.managed_host_key_binding(),
        Some(fixture.capability.binding())
    );
    assert!(resumed.agent.has_light_client_for_test());
    drop(resumed);
    fixture
        .store
        .record_revocation(fixture.capability.binding())
        .unwrap();
    assert!(build_resume_config_for_session(
        store_path,
        &session_id,
        &config,
        fixture.root.clone(),
        None,
        options
    )
    .await
    .is_err());
}
