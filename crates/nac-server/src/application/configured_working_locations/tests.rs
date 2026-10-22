use super::*;
use crate::application::managed_locations::tests::Fixture;
use nac_core::{
    model_configurations::NewModelConfiguration,
    sessions::{HostMaintenanceLease, SessionBehavior},
};
use std::os::{fd::AsRawFd, unix::fs::MetadataExt};

fn fixture() -> Fixture {
    let mut f = Fixture::new();
    f.config.version = nac_managed::MANAGED_CONFIG_VERSION;
    f.config.managed_control_bind = Some("127.0.0.1:3211".into());
    f.config.managed_control_issuer = Some("https://control.example.test".into());
    f.config.managed_control_jwks_file = Some(f.root.join("unused-jwks.json"));
    f.manager = SessionManager::new_unowned_fixture(crate::ServerOptions {
        root_cwd: f.root.clone(),
        store_path: Some(f.root.join("store.db")),
        worker_executable: None,
        managed_host: Some(f.config.clone()),
    })
    .unwrap();
    nac_core::store::initialize(&f.manager.inner.store_path).unwrap();
    model_configurations::insert_model_configuration(
        &f.manager.inner.store_path,
        "configured-model",
        model(),
    )
    .unwrap();
    f
}
fn model() -> NewModelConfiguration {
    NewModelConfiguration {
        name: "Configured".into(),
        backend: "openai-responses".into(),
        model: "actual-model".into(),
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
fn command(id: &str) -> PublicSessionCreationCommand {
    PublicSessionCreationCommand {
        context: PublicCreationContext::WorkingLocation(id.into()),
        model_config_id: None,
        reasoning_effort: Field::Unchanged,
        behavior: SessionBehavior::Direct,
        first_chat: false,
        first_chat_same_behavior: false,
    }
}
async fn registry(f: &Fixture) -> ConfiguredWorkingLocations {
    ConfiguredWorkingLocations::capture(
        &f.manager,
        vec![ConfiguredWorkingLocation {
            public_id: "opaque-location".into(),
            default_model_config_id: Some("configured-model".into()),
        }],
    )
    .await
    .unwrap()
}
fn descriptor_is_original(fd: i32, inode: u64) {
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    // SAFETY: fstat initializes the output on success, asserted before reading.
    assert_eq!(unsafe { libc::fstat(fd, stat.as_mut_ptr()) }, 0);
    assert_eq!(unsafe { stat.assume_init() }.st_ino, inode);
}
#[tokio::test]
async fn configured_location_resolves_actual_root_default_and_retains_original_owner_after_drop() {
    let f = fixture();
    let registry = registry(&f).await;
    let entry = registry.entries.get("opaque-location").unwrap();
    let fd = entry.location.directory_handle().as_raw_fd();
    let inode = entry.location.directory_handle().metadata().unwrap().ino();
    let revision = registry.revision("opaque-location").unwrap();
    let resolved = registry
        .resolve(&f.manager, command("opaque-location"), revision)
        .await
        .unwrap();
    assert_eq!(
        resolved.command.cwd.as_deref(),
        Some(f.config.repository_root.as_path())
    );
    assert_eq!(resolved.command.project_id, None);
    assert!(matches!(resolved.command.model,Field::Set(ref v) if v=="actual-model"));
    assert!(matches!(resolved.command.reasoning_effort,Field::Set(ref v) if v=="low"));
    assert!(resolved.command.ssh_host.is_none());
    assert!(HostMaintenanceLease::try_acquire(&f.manager.inner.store_path).is_err());
    resolved.location.check_outside_store(&f.manager).unwrap();
    drop(registry); // Revocation vetoes; the original allocation remains owned.
    assert!(resolved.location.check_denial().is_err());
    descriptor_is_original(fd, inode);
    assert!(HostMaintenanceLease::try_acquire(&f.manager.inner.store_path).is_err());
    assert!(
        nac_core::sessions::list_sessions(&f.manager.inner.store_path)
            .unwrap()
            .is_empty()
    );
}
#[tokio::test]
async fn configured_location_never_interprets_browser_paths_billing_ids_or_changed_revision() {
    let f = fixture();
    let registry = registry(&f).await;
    for id in [
        "/tmp",
        "workspace-id",
        f.config.repository_root.to_str().unwrap(),
    ] {
        assert!(matches!(
            registry.resolve(&f.manager, command(id), [1; 32]).await,
            Err(PublicCreationError::WorkingLocationUnavailable)
        ));
    }
    assert!(matches!(
        registry
            .resolve(&f.manager, command("opaque-location"), [0; 32])
            .await,
        Err(PublicCreationError::SourceChanged)
    ));
    assert!(HostMaintenanceLease::try_acquire(&f.manager.inner.store_path).is_ok());
    assert!(ConfiguredWorkingLocations::capture(
        &f.manager,
        vec![
            ConfiguredWorkingLocation {
                public_id: "same".into(),
                default_model_config_id: None
            },
            ConfiguredWorkingLocation {
                public_id: "same".into(),
                default_model_config_id: None
            },
        ]
    )
    .await
    .is_err());
}
#[tokio::test]
async fn configured_location_per_operation_denial_is_scoped_but_registry_revocation_retains_resources(
) {
    let f = fixture();
    let mut registry = registry(&f).await;
    let revision = registry.revision("opaque-location").unwrap();
    let first = registry
        .resolve(&f.manager, command("opaque-location"), revision)
        .await
        .unwrap();
    first.location.deny();
    assert!(first.location.check_denial().is_err());
    let second = registry
        .resolve(&f.manager, command("opaque-location"), revision)
        .await
        .unwrap();
    second.location.check_denial().unwrap();
    registry.revoke("opaque-location");
    assert!(second.location.check_denial().is_err());
    assert!(HostMaintenanceLease::try_acquire(&f.manager.inner.store_path).is_err());
    assert!(matches!(
        registry
            .resolve(&f.manager, command("opaque-location"), revision)
            .await,
        Err(PublicCreationError::SourceChanged)
    ));
}
#[tokio::test]
async fn configured_location_directory_replacement_is_sticky_even_after_original_name_returns() {
    let f = fixture();
    let registry = registry(&f).await;
    let revision = registry.revision("opaque-location").unwrap();
    let moved = f.root.join("original-root");
    std::fs::rename(&f.config.repository_root, &moved).unwrap();
    std::fs::create_dir(&f.config.repository_root).unwrap();
    assert!(matches!(
        registry
            .resolve(&f.manager, command("opaque-location"), revision)
            .await,
        Err(PublicCreationError::SourceChanged)
    ));
    std::fs::remove_dir(&f.config.repository_root).unwrap();
    std::fs::rename(moved, &f.config.repository_root).unwrap();
    assert!(matches!(
        registry
            .resolve(&f.manager, command("opaque-location"), revision)
            .await,
        Err(PublicCreationError::SourceChanged)
    ));
}
#[tokio::test]
async fn configured_location_model_source_changes_refuse_and_missing_default_never_uses_ambient_model(
) {
    let f = fixture();
    let registry = registry(&f).await;
    let revision = registry.revision("opaque-location").unwrap();
    let mut changed = model();
    changed.model = "changed-model".into();
    model_configurations::update_model_configuration(
        &f.manager.inner.store_path,
        "configured-model",
        changed,
    )
    .unwrap();
    assert!(matches!(
        registry
            .resolve(&f.manager, command("opaque-location"), revision)
            .await,
        Err(PublicCreationError::SourceChanged)
    ));
    let no_default = ConfiguredWorkingLocations::capture(
        &f.manager,
        vec![ConfiguredWorkingLocation {
            public_id: "no-default".into(),
            default_model_config_id: None,
        }],
    )
    .await
    .unwrap();
    let revision = no_default.revision("no-default").unwrap();
    assert!(matches!(
        no_default
            .resolve(&f.manager, command("no-default"), revision)
            .await,
        Err(PublicCreationError::ModelUnavailable)
    ));
    for effort in [Field::Clear, Field::Set("high".into())] {
        let mut explicit = command("no-default");
        explicit.model_config_id = Some("configured-model".into());
        explicit.reasoning_effort = effort.clone();
        let resolved = no_default
            .resolve(&f.manager, explicit, revision)
            .await
            .unwrap();
        assert_eq!(resolved.command.reasoning_effort, effort);
    }
}

#[tokio::test]
async fn configured_location_equal_host_and_store_data_cannot_replace_the_original_manager() {
    let f = fixture();
    let registry = registry(&f).await;
    let revision = registry.revision("opaque-location").unwrap();
    let replacement = SessionManager::new_unowned_fixture(crate::ServerOptions {
        root_cwd: f.root.clone(),
        store_path: Some(f.manager.inner.store_path.clone()),
        worker_executable: None,
        managed_host: Some(f.config.clone()),
    })
    .unwrap();
    assert_eq!(
        replacement.managed_location_binding().unwrap(),
        f.manager.managed_location_binding().unwrap()
    );
    assert!(matches!(
        registry
            .resolve(&replacement, command("opaque-location"), revision)
            .await,
        Err(PublicCreationError::SourceChanged)
    ));
    assert!(
        matches!(
            registry
                .resolve(&f.manager, command("opaque-location"), revision)
                .await,
            Err(PublicCreationError::SourceChanged)
        ),
        "matching data cannot revive original source denial"
    );
}

#[tokio::test]
async fn configured_location_selected_override_change_denies_only_its_original_resolution() {
    let f = fixture();
    let mut original = model();
    original.name = "Explicit override".into();
    original.model = "explicit-selected".into();
    model_configurations::insert_model_configuration(
        &f.manager.inner.store_path,
        "explicit-model",
        original.clone(),
    )
    .unwrap();
    let registry = registry(&f).await;
    let revision = registry.revision("opaque-location").unwrap();
    let default_resolution = registry
        .resolve(&f.manager, command("opaque-location"), revision)
        .await
        .unwrap();
    let mut explicit = command("opaque-location");
    explicit.model_config_id = Some("explicit-model".into());
    let resolved = registry
        .resolve(&f.manager, explicit.clone(), revision)
        .await
        .unwrap();
    assert!(matches!(resolved.command.model,Field::Set(ref value) if value=="explicit-selected"));
    let entry = registry.entries.get("opaque-location").unwrap();
    let fd = entry.location.directory_handle().as_raw_fd();
    let inode = entry.location.directory_handle().metadata().unwrap().ino();
    let mut changed = original.clone();
    changed.model = "replacement-selected".into();
    model_configurations::update_model_configuration(
        &f.manager.inner.store_path,
        "explicit-model",
        changed,
    )
    .unwrap();
    // The bounded veto still observes the local latch while another connection
    // holds a writer transaction. WAL readers remain possible; the physical
    // selected-row recheck runs separately after this transaction ends.
    let writer = rusqlite::Connection::open(&f.manager.inner.store_path).unwrap();
    writer.execute_batch("BEGIN EXCLUSIVE").unwrap();
    resolved.location.check_denial().unwrap();
    writer.execute_batch("ROLLBACK").unwrap();
    assert!(resolved.location.check_outside_store(&f.manager).is_err());
    assert!(resolved.location.check_denial().is_err());
    default_resolution
        .location
        .check_outside_store(&f.manager)
        .unwrap();
    // The changed record is a valid new resolution, but cannot revive the old
    // operation or revoke the shared configured entry's independent default.
    let fresh = registry
        .resolve(&f.manager, explicit, revision)
        .await
        .unwrap();
    assert!(matches!(fresh.command.model,Field::Set(ref value) if value=="replacement-selected"));
    fresh.location.check_outside_store(&f.manager).unwrap();
    model_configurations::update_model_configuration(
        &f.manager.inner.store_path,
        "explicit-model",
        original,
    )
    .unwrap();
    assert!(resolved.location.check_outside_store(&f.manager).is_err());
    assert!(resolved.location.check_denial().is_err());
    descriptor_is_original(fd, inode);
    assert!(HostMaintenanceLease::try_acquire(&f.manager.inner.store_path).is_err());
    assert!(
        nac_core::sessions::list_sessions(&f.manager.inner.store_path)
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn configured_location_selected_override_deletion_keeps_custody_and_default_usable() {
    let f = fixture();
    let mut explicit_model = model();
    explicit_model.name = "Explicit override".into();
    model_configurations::insert_model_configuration(
        &f.manager.inner.store_path,
        "explicit-model",
        explicit_model,
    )
    .unwrap();
    let registry = registry(&f).await;
    let revision = registry.revision("opaque-location").unwrap();
    let mut explicit = command("opaque-location");
    explicit.model_config_id = Some("explicit-model".into());
    let resolved = registry
        .resolve(&f.manager, explicit.clone(), revision)
        .await
        .unwrap();
    assert!(model_configurations::delete_model_configuration(
        &f.manager.inner.store_path,
        "explicit-model",
    )
    .unwrap());
    assert!(resolved.location.check_outside_store(&f.manager).is_err());
    assert!(resolved.location.check_denial().is_err());
    assert!(matches!(
        registry.resolve(&f.manager, explicit, revision).await,
        Err(PublicCreationError::ModelUnavailable)
    ));
    let default_resolution = registry
        .resolve(&f.manager, command("opaque-location"), revision)
        .await
        .unwrap();
    assert!(
        matches!(default_resolution.command.model,Field::Set(ref value) if value=="actual-model")
    );
    default_resolution
        .location
        .check_outside_store(&f.manager)
        .unwrap();
    assert!(HostMaintenanceLease::try_acquire(&f.manager.inner.store_path).is_err());
}
