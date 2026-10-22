use super::*;
use crate::application::managed_locations::tests::Fixture;
use nac_core::{
    model_configurations::NewModelConfiguration,
    projects::{NewProject, ProjectPatch},
};

fn serving_fixture() -> Fixture {
    let mut f = Fixture::new();
    // Resource retention requires the actual managed replacement identity.
    // Legacy configuration deliberately has none and must remain refused.
    f.config.version = nac_managed::MANAGED_CONFIG_VERSION;
    f.config.managed_control_bind = Some("127.0.0.1:3211".into());
    f.config.managed_control_issuer = Some("https://control.example.test".into());
    f.config.managed_control_jwks_file = Some(f.root.join("unused-controller-jwks.json"));
    f.manager = SessionManager::new_unowned_fixture(crate::ServerOptions {
        root_cwd: f.root.clone(),
        store_path: Some(f.root.join("store.db")),
        worker_executable: None,
        managed_host: Some(f.config.clone()),
    })
    .unwrap();
    f
}

fn model(name: &str) -> NewModelConfiguration {
    NewModelConfiguration {
        name: name.into(),
        backend: "openai-responses".into(),
        model: "source-model".into(),
        base_url: "https://model.invalid/v1".into(),
        allow_insecure_http: false,
        api_key_env: None,
        reasoning_effort: Some("low".into()),
        extra_headers: Default::default(),
        orchestrator_compaction_threshold: None,
        initial_prompt: None,
        light_model: None,
    }
}
fn request() -> PublicCreateCurrentness {
    PublicCreateCurrentness {
        request_id: "original-request".into(),
        if_match: Some("\"context-one\"".into()),
    }
}
fn command() -> PublicSessionCreationCommand {
    PublicSessionCreationCommand {
        context: PublicCreationContext::Project("project".into()),
        model_config_id: None,
        reasoning_effort: Field::Unchanged,
        behavior: SessionBehavior::Direct,
        first_chat: false,
        first_chat_same_behavior: false,
    }
}
async fn capture(f: &Fixture) -> CapturedPublicCreateSource {
    nac_core::store::initialize(&f.root.join("store.db")).unwrap();
    let path = &f.root.join("store.db");
    let model =
        model_configurations::insert_model_configuration(path, "model-a", model("A")).unwrap();
    projects::insert_project(
        path,
        NewProject {
            project_id: "project".into(),
            name: Some("Project".into()),
            description: None,
            cwd: f.config.repository_root.clone(),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: Some("model-a".into()),
        },
    )
    .unwrap();
    CapturedPublicCreateSource {
        request: request(),
        project: projects::load_project_launch_context(path, "project").unwrap(),
        model,
        location: f
            .manager
            .managed_location_fact(ManagedLocationSelector::RegisteredProject {
                project_id: "project".into(),
            })
            .await
            .unwrap(),
    }
}
#[tokio::test]
async fn public_create_source_maps_real_private_defaults_and_preserves_effort_without_effects() {
    let f = serving_fixture();
    let captured = capture(&f).await;
    let resolved = resolve_captured_source(&f.manager, command(), &request(), captured)
        .await
        .unwrap();
    assert_eq!(resolved.command.cwd, None);
    assert_eq!(resolved.command.project_id.as_deref(), Some("project"));
    assert!(matches!(resolved.command.model,Field::Set(ref value) if value=="source-model"));
    assert!(matches!(resolved.command.reasoning_effort,Field::Set(ref value) if value=="low"));
    assert!(resolved.command.ssh_host.is_none());
    assert!(!resolved.command.sandbox.enabled);
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&f.root.join("store.db")).is_err()
    );
    resolved.location.check_outside_store(&f.manager).unwrap();
    assert!(nac_core::sessions::list_sessions(&f.root.join("store.db"))
        .unwrap()
        .is_empty());
}
#[tokio::test]
async fn public_create_source_rejects_changed_default_even_without_presentation_revision_change() {
    let f = serving_fixture();
    let captured = capture(&f).await;
    let old = captured.project.project.presentation_version;
    model_configurations::insert_model_configuration(
        &f.root.join("store.db"),
        "model-b",
        model("B"),
    )
    .unwrap();
    let changed = projects::update_project(
        &f.root.join("store.db"),
        "project",
        ProjectPatch {
            default_model_config_id: Some(Some("model-b".into())),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(changed.presentation_version, old);
    assert!(matches!(
        resolve_captured_source(&f.manager, command(), &request(), captured).await,
        Err(PublicCreationError::SourceChanged)
    ));
}
#[tokio::test]
async fn public_create_source_rejects_changed_model_and_original_request() {
    let f = serving_fixture();
    let captured = capture(&f).await;
    let mut different = request();
    different.if_match = Some("\"other-context\"".into());
    assert!(matches!(
        resolve_captured_source(&f.manager, command(), &different, captured).await,
        Err(PublicCreationError::SourceChanged)
    ));
    let project =
        projects::load_project_launch_context(&f.root.join("store.db"), "project").unwrap();
    let location = f
        .manager
        .managed_location_fact(ManagedLocationSelector::RegisteredProject {
            project_id: "project".into(),
        })
        .await
        .unwrap();
    let captured = CapturedPublicCreateSource {
        request: request(),
        location,
        model: project.default_model_config.clone().unwrap(),
        project,
    };
    let mut changed = model("A");
    changed.model = "changed-model".into();
    model_configurations::update_model_configuration(&f.root.join("store.db"), "model-a", changed)
        .unwrap();
    assert!(matches!(
        resolve_captured_source(&f.manager, command(), &request(), captured).await,
        Err(PublicCreationError::SourceChanged)
    ));
}

#[tokio::test]
async fn public_create_source_refuses_legacy_identity_and_replaced_directory() {
    let mut f = Fixture::new();
    let captured = capture(&f).await;
    assert!(matches!(
        resolve_captured_source(&f.manager, command(), &request(), captured).await,
        Err(PublicCreationError::SourceChanged)
    ));
    // Retain the captured fact, then replace its actual original directory.
    // No replacement fact or equivalent cwd string can rescue this request.
    f.config.version = nac_managed::MANAGED_CONFIG_VERSION;
    f.config.managed_control_bind = Some("127.0.0.1:3211".into());
    f.config.managed_control_issuer = Some("https://control.example.test".into());
    f.config.managed_control_jwks_file = Some(f.root.join("unused-controller-jwks.json"));
    f.manager = SessionManager::new_unowned_fixture(crate::ServerOptions {
        root_cwd: f.root.clone(),
        store_path: Some(f.root.join("store.db")),
        worker_executable: None,
        managed_host: Some(f.config.clone()),
    })
    .unwrap();
    let project =
        projects::load_project_launch_context(&f.root.join("store.db"), "project").unwrap();
    let captured = CapturedPublicCreateSource {
        request: request(),
        location: f
            .manager
            .managed_location_fact(ManagedLocationSelector::RegisteredProject {
                project_id: "project".into(),
            })
            .await
            .unwrap(),
        model: project.default_model_config.clone().unwrap(),
        project,
    };
    std::fs::rename(
        &f.config.repository_root,
        f.root.join("original-repository"),
    )
    .unwrap();
    std::fs::create_dir(&f.config.repository_root).unwrap();
    assert!(matches!(
        resolve_captured_source(&f.manager, command(), &request(), captured).await,
        Err(PublicCreationError::SourceChanged)
    ));
    assert!(nac_core::sessions::list_sessions(&f.root.join("store.db"))
        .unwrap()
        .is_empty());
}
